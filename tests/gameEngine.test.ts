import { describe, expect, it } from 'vitest';
import {
  COLOR_SWAP,
  MUTATION_IDS,
  type ChallengeRecommendation,
  type MutationId,
} from '../shared/challenges';
import { GameEngine, type AiPort, type EngineOptions } from '../client/src/game/gameEngine';
import { buildMutationRound, buildBaseRule, type BuildContext } from '../client/src/game/mutations';
import { mulberry32 } from '../client/src/game/rng';
import {
  CONFIG,
  comboMultiplier,
  levelFromProgress,
  responseWindowMs,
  progressAfterMiss,
} from '../client/src/game/scoring';
import { keyToSlot } from '../client/src/game/input';

function playing(seed = 1, ai: AiPort | null = null, opts: EngineOptions = {}) {
  const engine = new GameEngine({ seed, ai, ...opts });
  let now = 1000;
  engine.start(now);
  const until = now + CONFIG.countdownMs;
  while (now < until) engine.tick((now = Math.min(until, now + 16)));
  expect(engine.getState().status).toBe('PLAYING');
  return {
    engine,
    get now() {
      return now;
    },
    advance(ms: number) {
      // Step in small increments like a real frame loop.
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + 16);
        engine.tick(now);
      }
    },
    /** Waits until a round is active (skipping gaps and mutation transitions). */
    waitForRound() {
      const over = () => ['GAME_OVER', 'AI_ANALYSIS'].includes(engine.getState().status);
      for (let i = 0; i < 1000 && !engine.getState().roundActive && !over(); i++) this.advance(16);
      if (!over()) expect(engine.getState().roundActive).toBe(true);
    },
    hitCorrect() {
      this.waitForRound();
      if (!engine.getState().roundActive) return;
      const r = engine.getState().round!;
      this.advance(100);
      for (let i = 0; i < r.clicksRequired; i++) engine.input(r.correctSlot, now);
    },
    hitWrong() {
      this.waitForRound();
      const r = engine.getState().round!;
      const wrong = r.targets.find((t) => !t.correct)!;
      engine.input(wrong.slot, now);
    },
  };
}

describe('scoring', () => {
  it('correct action increases score by at least the base points', () => {
    const g = playing();
    g.hitCorrect();
    const s = g.engine.getState();
    expect(s.score).toBeGreaterThanOrEqual(CONFIG.basePoints);
    expect(s.score).toBeLessThanOrEqual(CONFIG.basePoints + CONFIG.maxSpeedBonus);
    expect(s.combo).toBe(1);
    expect(s.feedback?.kind).toBe('correct');
  });

  it('incorrect action loses a life and resets the combo', () => {
    const g = playing();
    g.hitCorrect();
    g.hitCorrect();
    expect(g.engine.getState().combo).toBe(2);
    g.hitWrong();
    const s = g.engine.getState();
    expect(s.lives).toBe(CONFIG.startingLives - 1);
    expect(s.combo).toBe(0);
    expect(s.multiplier).toBe(1);
  });

  it('timeouts cost a life', () => {
    const g = playing();
    g.waitForRound();
    g.advance(CONFIG.maxWindowMs * 1.3);
    expect(g.engine.getState().lives).toBe(CONFIG.startingLives - 1);
    expect(g.engine.getState().records[0].timeout).toBe(true);
  });

  it('combo multiplier grows in steps and is capped', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(4)).toBe(1);
    expect(comboMultiplier(5)).toBe(1.5);
    expect(comboMultiplier(10)).toBe(2);
    expect(comboMultiplier(1000)).toBe(CONFIG.maxMultiplier);
  });

  it('applies the multiplier to hits during a streak', () => {
    const g = playing(3);
    for (let i = 0; i < 6; i++) g.hitCorrect();
    const s = g.engine.getState();
    expect(s.combo).toBeGreaterThanOrEqual(6);
    expect(s.multiplier).toBe(1.5);
    expect(s.score).toBeGreaterThan(6 * CONFIG.basePoints);
  });

  it('game ends when lives run out and best score is kept', () => {
    const g = playing();
    g.hitCorrect();
    for (let i = 0; i < CONFIG.startingLives; i++) g.hitWrong();
    const s = g.engine.getState();
    expect(s.status).toBe('GAME_OVER');
    expect(s.bestScore).toBe(s.score);
    expect(s.finalSummary?.endReason).toBe('lives');
    g.advance(CONFIG.gameOverSplashMs + 50);
    expect(g.engine.getState().status).toBe('AI_ANALYSIS');
    expect(g.engine.getState().analysis?.source).toBe('fallback');
  });

  it('game ends when the run timer expires, excluding mutation announcements', () => {
    // Unreachable win target so a perfect player runs out the clock.
    const g = playing(9, null, { winMutationClears: Infinity });
    const started = g.now;
    while (g.engine.getState().status !== 'GAME_OVER') g.hitCorrect();
    const s = g.engine.getState();
    const transitions = s.mutationHistory.length;
    expect(s.finalSummary?.endReason).toBe('time');
    expect(s.lives).toBe(CONFIG.startingLives);
    expect(transitions).toBeGreaterThan(1);
    const elapsed = g.now - started;
    expect(elapsed).toBeGreaterThanOrEqual(CONFIG.runDurationMs + transitions * CONFIG.mutationTransitionMs - 50);
    expect(s.finalSummary!.durationSec).toBeLessThanOrEqual(CONFIG.runDurationMs / 1000 + transitions * CONFIG.mutationTransitionMs / 1000 + 0.1);
  });
});

describe('win condition', () => {
  /** Plays perfectly, except it misses the first round of every mutation listed in `failPhases` (1-based). */
  function playRun(seed: number, failPhases: number[] = []) {
    const g = playing(seed);
    const missedPhases = new Set<number>();
    for (let i = 0; i < 400 && !['GAME_OVER', 'AI_ANALYSIS'].includes(g.engine.getState().status); i++) {
      g.waitForRound();
      const s = g.engine.getState();
      if (!s.roundActive) break;
      const phase = s.mutationHistory.length;
      if (s.mutation && failPhases.includes(phase) && !missedPhases.has(phase)) {
        missedPhases.add(phase);
        g.hitWrong();
      } else {
        g.hitCorrect();
      }
    }
    return g;
  }

  it('clearing the target number of mutations flawlessly wins before the clock runs out', () => {
    const g = playRun(21);
    const s = g.engine.getState();
    expect(s.status).toBe('GAME_OVER');
    expect(s.finalSummary?.endReason).toBe('win');
    expect(s.mutationsSurvived).toBe(CONFIG.winMutationClears);
    expect(s.mutationHistory).toHaveLength(CONFIG.winMutationClears);
    expect(s.timeLeftMs).toBeGreaterThan(0);
    // Time bonus is paid per remaining second and included in the score.
    expect(s.winBonus).toBe(Math.ceil(s.timeLeftMs / 1000) * CONFIG.winTimeBonusPerSec);
    expect(s.finalSummary!.score).toBe(s.score);
  });

  it('a single miss inside a mutation does not count toward the override', () => {
    const g = playRun(21, [1]);
    const s = g.engine.getState();
    expect(s.mutationHistory.length).toBeGreaterThan(CONFIG.winMutationClears);
    expect(s.finalSummary?.endReason).toBe('win');
    expect(s.lives).toBe(CONFIG.startingLives - 1);
  });

  it('the deciding mutation is flagged as final and is never gentler than the minimum intensity', () => {
    const g = playing(21);
    let finalSeen: { isFinal: boolean; intensity: number } | null = null;
    for (let i = 0; i < 400 && !['GAME_OVER', 'AI_ANALYSIS'].includes(g.engine.getState().status); i++) {
      g.waitForRound();
      const s = g.engine.getState();
      if (s.mutation) {
        if (s.mutationsSurvived === CONFIG.winMutationClears - 1) {
          finalSeen = { isFinal: s.mutation.isFinal, intensity: s.mutation.rec.intensity };
        } else {
          expect(s.mutation.isFinal).toBe(false);
        }
      }
      g.hitCorrect();
    }
    expect(finalSeen).toMatchObject({ isFinal: true });
    expect(finalSeen!.intensity).toBeGreaterThanOrEqual(CONFIG.finalMutationMinIntensity);
  });
});

describe('difficulty', () => {
  it('levels stay within limits', () => {
    expect(levelFromProgress(0)).toBe(CONFIG.minLevel);
    expect(levelFromProgress(10_000)).toBe(CONFIG.maxLevel);
    expect(progressAfterMiss(2)).toBe(0);
  });

  it('response window shrinks with level and never goes below the hard floor', () => {
    expect(responseWindowMs(1)).toBe(CONFIG.maxWindowMs);
    expect(responseWindowMs(5)).toBeLessThan(responseWindowMs(1));
    for (let lvl = 1; lvl <= 10; lvl++) {
      expect(responseWindowMs(lvl, 0.68, 3)).toBeGreaterThanOrEqual(CONFIG.hardMinWindowMs);
    }
  });

  it('level increases with streaks and drops one step after a miss', () => {
    const g = playing(7);
    for (let i = 0; i < 8; i++) g.hitCorrect();
    const before = g.engine.getState().level;
    expect(before).toBeGreaterThan(1);
    g.hitWrong();
    expect(g.engine.getState().level).toBe(before - 1);
  });
});

describe('restart', () => {
  it('clears all transient run state', () => {
    const g = playing();
    g.hitCorrect();
    g.hitWrong();
    g.engine.start(g.now + 10);
    const s = g.engine.getState();
    expect(s.status).toBe('COUNTDOWN');
    expect(s.score).toBe(0);
    expect(s.lives).toBe(CONFIG.startingLives);
    expect(s.combo).toBe(0);
    expect(s.records).toHaveLength(0);
    expect(s.mutation).toBeNull();
    expect(s.round).toBeNull();
    expect(s.bestScore).toBe(0); // only persisted when a run actually ends
  });

  it('ignores input outside of PLAYING', () => {
    const engine = new GameEngine({ seed: 1 });
    engine.input(0, 0);
    expect(engine.getState().status).toBe('MENU');
    engine.start(0);
    engine.input(0, 10);
    expect(engine.getState().records).toHaveLength(0);
  });
});

describe('input mapping', () => {
  it('keyboard keys map to the same slots as clicks', () => {
    expect(keyToSlot('1')).toBe(0);
    expect(keyToSlot('4')).toBe(3);
    expect(keyToSlot('a')).toBe(0);
    expect(keyToSlot('F')).toBe(3);
    expect(keyToSlot('x')).toBeNull();
  });

  it('keyboard and mouse input go through the same rule check', () => {
    const g = playing(11);
    g.waitForRound();
    const r = g.engine.getState().round!;
    const key = String(r.correctSlot + 1);
    for (let i = 0; i < r.clicksRequired; i++) g.engine.input(keyToSlot(key)!, g.now + 50);
    expect(g.engine.getState().records[0].correct).toBe(true);
  });

  it('double-tap rounds need two taps on the correct target', () => {
    for (let seed = 1; seed < 200; seed++) {
      const ctx: BuildContext = { rng: mulberry32(seed), targetCount: 4, level: 5, memoryColor: 'red', firstOfPhase: false };
      const bp = buildMutationRound('doubleTap', ctx);
      expect(bp.clicksRequired).toBe(2);
    }
  });
});

describe('round builders', () => {
  const ctxFor = (seed: number, targetCount: 3 | 4 = 4): BuildContext => ({
    rng: mulberry32(seed),
    targetCount,
    level: 6,
    memoryColor: 'lime',
    firstOfPhase: seed % 2 === 0,
  });

  it('every base rule and mutation yields exactly one correct target', () => {
    for (let seed = 1; seed < 300; seed++) {
      for (const n of [3, 4] as const) {
        for (const kind of ['tapColor', 'avoidColor', 'tapSymbol', 'previousColor', 'doubleTap', 'ignoreTarget'] as const) {
          const bp = buildBaseRule(kind, ctxFor(seed, n));
          expect(bp.targets.filter((t) => t.correct)).toHaveLength(1);
          expect(bp.targets).toHaveLength(n);
        }
        for (const id of MUTATION_IDS) {
          const bp = buildMutationRound(id, ctxFor(seed, n));
          expect(bp.targets.filter((t) => t.correct)).toHaveLength(1);
        }
      }
    }
  });

  it('reverseColors: the correct target is the swap color of the named one', () => {
    for (let seed = 1; seed < 200; seed++) {
      const bp = buildMutationRound('reverseColors', ctxFor(seed));
      const named = bp.instruction.find((p) => p.kind === 'color')!;
      const correct = bp.targets[bp.correctSlot];
      const namedId = (['red', 'cyan', 'lime', 'amber'] as const).find((c) => c.toUpperCase() === named.text)!;
      expect(correct.color).toBe(COLOR_SWAP[namedId]);
      expect(bp.targets.some((t) => t.color === namedId)).toBe(true);
    }
  });

  it('symbolOverride: the symbol wins and the named color is a decoy', () => {
    for (let seed = 1; seed < 200; seed++) {
      const bp = buildMutationRound('symbolOverride', ctxFor(seed));
      const glyph = bp.instruction.find((p) => p.kind === 'symbol')!.text;
      const colorName = bp.instruction.find((p) => p.kind === 'color')!.text;
      const correct = bp.targets[bp.correctSlot];
      expect(['●', '▲', '■', '★'][['circle', 'triangle', 'square', 'star'].indexOf(correct.symbol)]).toBe(glyph);
      expect(correct.color.toUpperCase()).not.toBe(colorName);
      expect(bp.targets.some((t) => t.color.toUpperCase() === colorName)).toBe(true);
    }
  });

  it('ignoreTarget: a same-color star decoy exists and is never correct', () => {
    for (let seed = 1; seed < 200; seed++) {
      const bp = buildMutationRound('ignoreTarget', ctxFor(seed));
      const correct = bp.targets[bp.correctSlot];
      const decoy = bp.targets.find((t) => t.symbol === 'star')!;
      expect(decoy.correct).toBe(false);
      expect(decoy.color).toBe(correct.color);
      expect(correct.symbol).not.toBe('star');
    }
  });

  it('previousColor: the correct target is the carried color, and a new color is carried forward', () => {
    for (let seed = 1; seed < 200; seed++) {
      const bp = buildMutationRound('previousColor', ctxFor(seed));
      expect(bp.targets[bp.correctSlot].color).toBe('lime');
      const shown = bp.instruction.find((p) => p.kind === 'color')!.text.toLowerCase();
      expect(bp.memoryColor).toBe(shown);
      expect(shown).not.toBe('lime');
    }
  });

  it('reverseInstruction: TAP means avoid and AVOID means tap', () => {
    for (let seed = 1; seed < 200; seed++) {
      const bp = buildMutationRound('reverseInstruction', ctxFor(seed));
      const verbText = bp.instruction[0].text;
      const named = bp.instruction.find((p) => p.kind === 'color')!.text.toLowerCase();
      const correct = bp.targets[bp.correctSlot];
      if (verbText === 'TAP') expect(correct.color).not.toBe(named);
      else expect(correct.color).toBe(named);
    }
  });

  it('colorBlind: rounds are monochrome and symbol-driven', () => {
    for (let seed = 1; seed < 100; seed++) {
      const bp = buildMutationRound('colorBlind', ctxFor(seed));
      expect(bp.monochrome).toBe(true);
      expect(bp.instruction.some((p) => p.kind === 'symbol')).toBe(true);
    }
  });

  it('speedSurge: shortens the response window', () => {
    expect(responseWindowMs(3, 0.68)).toBeLessThan(responseWindowMs(3));
  });
});

// ---------------------------------------------------------------------------
// AI integration at the engine level
// ---------------------------------------------------------------------------

function fakeAi(
  behaviour: 'never' | 'instant' | 'reject',
  rec: Partial<ChallengeRecommendation> = {},
): AiPort & { calls: number; lastAllowed: MutationId[] } {
  const port = {
    calls: 0,
    lastAllowed: [] as MutationId[],
    requestChallenge(_summary: unknown, allowed: MutationId[]) {
      port.calls++;
      port.lastAllowed = allowed;
      if (behaviour === 'never') return new Promise<ChallengeRecommendation>(() => {});
      if (behaviour === 'reject') return Promise.reject(new Error('down'));
      return Promise.resolve({
        mutationId: allowed[0],
        reason: 'test reason',
        instruction: 'TEST INSTRUCTION',
        intensity: 1,
        taunt: 'test taunt',
        source: 'ai',
        ...rec,
      } as ChallengeRecommendation);
    },
    requestAnalysis() {
      return new Promise<never>(() => {});
    },
  };
  return port;
}

async function playUntilMutation(g: ReturnType<typeof playing>) {
  for (let i = 0; i < 20 && g.engine.getState().status !== 'MUTATION_TRANSITION'; i++) {
    g.hitCorrect();
    await Promise.resolve();
    await Promise.resolve();
    g.advance(CONFIG.maxGapMs + 50);
  }
  expect(g.engine.getState().status).toBe('MUTATION_TRANSITION');
}

describe('AI scheduling', () => {
  it('requests a challenge ahead of time and applies a valid AI recommendation', async () => {
    const ai = fakeAi('instant', { mutationId: 'doubleTap', instruction: 'TAP TWICE, HUMAN' });
    const g = playing(5, ai);
    await playUntilMutation(g);
    const s = g.engine.getState();
    expect(ai.calls).toBe(1);
    expect(s.announcing?.rec.source).toBe('ai');
    expect(s.announcing?.rec.mutationId).toBe('doubleTap');
    expect(s.announcing?.rec.instruction).toBe('TAP TWICE, HUMAN');
    g.waitForRound();
    expect(g.engine.getState().round!.mutationId).toBe('doubleTap');
  });

  it('a slow model never blocks gameplay: fallback is used immediately', async () => {
    const ai = fakeAi('never');
    const g = playing(5, ai);
    await playUntilMutation(g);
    const rec = g.engine.getState().announcing!.rec;
    expect(rec.source).toBe('fallback');
    // Grace rounds are bounded: the fallback arrives no later than this.
    expect(g.engine.getState().records.length).toBe(CONFIG.firstMutationRound + CONFIG.aiGraceRounds);
    expect(MUTATION_IDS).toContain(rec.mutationId);
    g.waitForRound();
    expect(g.engine.getState().round!.mutationId).toBe(rec.mutationId);
  });

  it('waits up to the grace rounds for a slow model, then uses its answer', async () => {
    let resolve!: (r: ChallengeRecommendation) => void;
    const ai: AiPort = {
      requestChallenge: () => new Promise((r) => (resolve = r)),
      requestAnalysis: () => new Promise(() => {}),
    };
    const g = playing(5, ai);
    // Play exactly up to the scheduled mutation round plus one grace round.
    for (let i = 0; i < CONFIG.firstMutationRound + 1; i++) {
      g.hitCorrect();
      g.advance(CONFIG.maxGapMs + 50);
    }
    expect(g.engine.getState().mutationHistory).toHaveLength(0);
    expect(g.engine.getState().status).toBe('PLAYING');
    resolve({ mutationId: 'previousColor', reason: 'r', instruction: 'REMEMBER', intensity: 1, taunt: 't', source: 'ai' });
    await Promise.resolve();
    await playUntilMutation(g);
    expect(g.engine.getState().announcing!.rec).toMatchObject({ source: 'ai', mutationId: 'previousColor' });
    expect(g.engine.getState().records.length).toBeLessThanOrEqual(CONFIG.firstMutationRound + CONFIG.aiGraceRounds);
  });

  it('a failing AI falls back without crashing', async () => {
    const g = playing(5, fakeAi('reject'));
    await playUntilMutation(g);
    expect(g.engine.getState().announcing!.rec.source).toBe('fallback');
  });

  it('engine caps intensity for a struggling player even if the model asks for 3', async () => {
    const ai = fakeAi('instant', { mutationId: 'doubleTap', intensity: 3 });
    const g = playing(5, ai);
    g.hitWrong();
    g.hitWrong();
    await playUntilMutation(g);
    expect(g.engine.getState().announcing!.rec.intensity).toBe(1);
  });

  it('the model is only offered tier-1 mutations when the player is on their last life', async () => {
    const ai = fakeAi('instant');
    const g = playing(5, ai);
    g.hitWrong();
    g.hitWrong();
    await playUntilMutation(g);
    expect(ai.lastAllowed.sort()).toEqual(['colorBlind', 'doubleTap']);
  });

  it('late AI responses from a previous run are ignored', async () => {
    let resolve!: (r: ChallengeRecommendation) => void;
    const ai: AiPort = {
      requestChallenge: () => new Promise((r) => (resolve = r)),
      requestAnalysis: () => new Promise(() => {}),
    };
    const g = playing(5, ai);
    for (let i = 0; i < 3; i++) g.hitCorrect();
    g.engine.start(g.now);
    resolve({ mutationId: 'reverseColors', reason: 'x', instruction: 'x', intensity: 2, taunt: 'x', source: 'ai' });
    await Promise.resolve();
    expect(g.engine.getState().aiCached).toBeNull();
  });
});
