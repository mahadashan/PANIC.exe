/**
 * The game engine owns every timer, every state transition and all scoring.
 * It is driven by `tick(now)` from a single animation-frame loop, plus
 * `input(slot, now)` for clicks and keys, so it is fully deterministic and
 * testable with fake timestamps. AI calls are fire-and-forget: their results
 * are cached and only consumed at round boundaries.
 */
import {
  allowedMutationsFor,
  fallbackAnalysis,
  fallbackChallenge,
  maxIntensityFor,
  MUTATIONS,
  type ChallengeRecommendation,
  type ColorId,
  type MutationId,
  type PerformanceSummary,
  type RunAnalysis,
  type RunSummary,
} from '../../../shared/challenges';
import type { ActiveMutation, FeedbackKind, GameEvent, GameState, RoundRecord } from './gameTypes';
import { baseRulesForLevel, buildBaseRule, buildMutationRound } from './mutations';
import { mulberry32, pick, type Rng } from './rng';
import {
  CONFIG,
  comboMultiplier,
  gapMs,
  levelFromProgress,
  mutationPhaseLength,
  pointsForHit,
  progressAfterMiss,
  responseWindowMs,
  roundsBetweenMutations,
  targetCountFor,
} from './scoring';
import { buildPerformanceSummary, buildRunSummary } from './stats';

export interface AiPort {
  requestChallenge(
    summary: PerformanceSummary,
    allowed: MutationId[],
    signal: AbortSignal,
  ): Promise<ChallengeRecommendation>;
  requestAnalysis(run: RunSummary, signal: AbortSignal): Promise<RunAnalysis>;
}

export interface ScoreStore {
  loadBest(): number;
  saveBest(score: number): void;
}

export interface EngineOptions {
  ai?: AiPort | null;
  store?: ScoreStore;
  seed?: number;
  /** Override the win condition (tests use Infinity to exercise the timer). */
  winMutationClears?: number;
}

const memoryStore = (): ScoreStore => {
  let best = 0;
  return { loadBest: () => best, saveBest: (s) => void (best = s) };
};

function initialState(bestScore: number, winTarget: number): GameState {
  return {
    status: 'MENU',
    statusUntil: 0,
    countdown: 0,
    score: 0,
    lives: CONFIG.startingLives,
    combo: 0,
    bestCombo: 0,
    multiplier: 1,
    level: CONFIG.minLevel,
    levelProgress: 0,
    roundIndex: 0,
    round: null,
    roundActive: false,
    nextRoundAt: 0,
    taps: 0,
    feedback: null,
    mutation: null,
    announcing: null,
    nextMutationAtRound: CONFIG.firstMutationRound,
    mutationHistory: [],
    mutationsSurvived: 0,
    winTarget,
    winBonus: 0,
    runStartedAt: 0,
    runEndsAt: 0,
    timeLeftMs: CONFIG.runDurationMs,
    runDurationMs: CONFIG.runDurationMs,
    records: [],
    bestScore,
    isNewBest: false,
    aiState: 'idle',
    aiCached: null,
    finalSummary: null,
    analysis: null,
    analysisStatus: 'idle',
  };
}

export class GameEngine {
  private s: GameState;
  private dirty = false;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: GameEvent) => void>();
  private ai: AiPort | null;
  private store: ScoreStore;
  private rng: Rng;
  private lastTick = 0;
  private feedbackId = 0;

  /** Incremented on every start/menu so late AI responses from old runs are ignored. */
  private runId = 0;
  private phaseCounter = 0;
  private aiRequestedForPhase = -1;
  private aiCachedForPhase = -1;
  private graceRoundsUsed = 0;
  private aiController: AbortController | null = null;
  private analysisController: AbortController | null = null;
  private memoryColor: ColorId | null = null;
  private readonly winTarget: number;

  constructor(opts: EngineOptions = {}) {
    this.ai = opts.ai ?? null;
    this.store = opts.store ?? memoryStore();
    this.rng = opts.seed !== undefined ? mulberry32(opts.seed) : Math.random;
    this.winTarget = opts.winMutationClears ?? CONFIG.winMutationClears;
    this.s = initialState(this.store.loadBest(), this.winTarget);
  }

  // -------------------------------------------------------------------------
  // Store plumbing (useSyncExternalStore compatible)
  // -------------------------------------------------------------------------

  getState = (): GameState => this.s;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  onEvent(fn: (e: GameEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  private set(patch: Partial<GameState>) {
    this.s = { ...this.s, ...patch };
    this.dirty = true;
  }

  private commit() {
    if (!this.dirty) return;
    this.dirty = false;
    for (const fn of this.listeners) fn();
  }

  private emit(e: GameEvent) {
    for (const fn of this.eventListeners) fn(e);
  }

  // -------------------------------------------------------------------------
  // Public commands
  // -------------------------------------------------------------------------

  start(now: number) {
    this.abortAll();
    this.runId++;
    this.phaseCounter = 0;
    this.aiRequestedForPhase = -1;
    this.aiCachedForPhase = -1;
    this.graceRoundsUsed = 0;
    this.memoryColor = null;
    this.lastTick = now;
    this.s = {
      ...initialState(this.s.bestScore, this.winTarget),
      status: 'COUNTDOWN',
      statusUntil: now + CONFIG.countdownMs,
      countdown: 3,
    };
    this.dirty = true;
    this.emit({ type: 'start' });
    this.emit({ type: 'countdown', value: 3 });
    this.commit();
  }

  toMenu() {
    this.abortAll();
    this.runId++;
    this.s = initialState(this.s.bestScore, this.winTarget);
    this.dirty = true;
    this.commit();
  }

  /** Same entry point for mouse, touch and keyboard. */
  input(slot: number, now: number) {
    const { status, round, roundActive } = this.s;
    if (status !== 'PLAYING' || !round || !roundActive) return;
    const target = round.targets[slot];
    if (!target) return;
    if (now > round.deadline) {
      this.resolveMiss(null, true, now);
    } else if (target.correct) {
      if (round.clicksRequired === 2 && this.s.taps === 0) {
        this.set({ taps: 1, feedback: this.feedback('progress', slot, 0, 'AGAIN!', now) });
        this.emit({ type: 'progress', slot });
      } else {
        this.resolveHit(slot, now);
      }
    } else {
      this.resolveMiss(slot, false, now);
    }
    this.commit();
  }

  tick(now: number) {
    if (this.lastTick && now - this.lastTick > 400) {
      // Tab was hidden or the thread stalled: freeze time instead of punishing the player.
      this.shiftTimers(now - this.lastTick - 16);
    }
    this.lastTick = now;
    const s = this.s;

    switch (s.status) {
      case 'COUNTDOWN': {
        const remaining = s.statusUntil - now;
        if (remaining <= 0) {
          this.set({
            status: 'PLAYING',
            countdown: 0,
            runStartedAt: now,
            runEndsAt: now + CONFIG.runDurationMs,
            timeLeftMs: CONFIG.runDurationMs,
          });
          this.beginNextRound(now);
        } else {
          const value = Math.ceil(remaining / (CONFIG.countdownMs / 3));
          if (value !== s.countdown) {
            this.set({ countdown: value });
            this.emit({ type: 'countdown', value });
          }
        }
        break;
      }
      case 'PLAYING': {
        const timeLeftMs = Math.max(0, s.runEndsAt - now);
        if (Math.floor(timeLeftMs / 100) !== Math.floor(s.timeLeftMs / 100)) this.set({ timeLeftMs });
        if (timeLeftMs <= 0) {
          this.endGame('time', now);
          break;
        }
        if (s.roundActive && s.round && now >= s.round.deadline) {
          this.resolveMiss(null, true, now);
        } else if (!s.roundActive && now >= s.nextRoundAt) {
          this.beginNextRound(now);
        }
        break;
      }
      case 'MUTATION_TRANSITION':
        if (now >= s.statusUntil) {
          this.set({ status: 'PLAYING', announcing: null });
          this.startRound(now);
        }
        break;
      case 'GAME_OVER':
        if (now >= s.statusUntil) this.set({ status: 'AI_ANALYSIS' });
        break;
      default:
        break;
    }
    this.commit();
  }

  dispose() {
    this.abortAll();
    this.listeners.clear();
    this.eventListeners.clear();
  }

  /** Current compact summary (also what the AI receives). */
  summary(): PerformanceSummary {
    const s = this.s;
    return buildPerformanceSummary(s.records, {
      combo: s.combo,
      bestCombo: s.bestCombo,
      mutationHistory: s.mutationHistory,
      level: s.level,
      lives: s.lives,
      score: s.score,
    });
  }

  // -------------------------------------------------------------------------
  // Round flow
  // -------------------------------------------------------------------------

  private beginNextRound(now: number) {
    const completed = this.s.records.length;
    if (!this.s.mutation) {
      if (completed >= this.s.nextMutationAtRound - CONFIG.aiLeadRounds) this.requestAiChallenge();
      if (completed >= this.s.nextMutationAtRound) {
        const waitingForAi = this.s.aiState === 'thinking' && this.aiCachedForPhase !== this.phaseCounter;
        if (waitingForAi && this.graceRoundsUsed < CONFIG.aiGraceRounds) {
          this.graceRoundsUsed++;
        } else {
          this.graceRoundsUsed = 0;
          this.announceMutation(now);
          return;
        }
      }
    }
    this.startRound(now);
  }

  private startRound(now: number) {
    const s = this.s;
    const active = s.mutation;
    const mutationId = active?.rec.mutationId ?? null;
    const ctx = {
      rng: this.rng,
      targetCount: targetCountFor(s.level),
      level: s.level,
      memoryColor: this.memoryColor,
      firstOfPhase: !!active && active.roundsLeft === active.totalRounds,
    };
    const bp = mutationId
      ? buildMutationRound(mutationId, ctx)
      : buildBaseRule(pick(this.rng, baseRulesForLevel(s.level)), ctx);

    let scale = mutationId ? MUTATIONS[mutationId].windowScale : 1;
    if (!mutationId && bp.clicksRequired === 2) scale *= 1.15;
    const windowMs = responseWindowMs(s.level, scale, active?.rec.intensity ?? 1);

    this.set({
      round: {
        ...bp,
        index: s.roundIndex + 1,
        ruleKey: mutationId ?? bp.ruleKind,
        mutationId,
        windowMs,
        startedAt: now,
        deadline: now + windowMs,
      },
      roundIndex: s.roundIndex + 1,
      roundActive: true,
      taps: 0,
    });
    this.emit({ type: 'roundStart' });
  }

  private resolveHit(slot: number, now: number) {
    const s = this.s;
    const round = s.round!;
    const reactionMs = Math.max(0, now - round.startedAt);
    const points = pointsForHit(reactionMs, round.windowMs, s.combo);
    const combo = s.combo + 1;
    const levelProgress = s.levelProgress + 1;
    const level = levelFromProgress(levelProgress);

    this.set({
      score: s.score + points,
      combo,
      bestCombo: Math.max(s.bestCombo, combo),
      multiplier: comboMultiplier(combo),
      levelProgress,
      level,
      feedback: this.feedback('correct', slot, points, `+${points}`, now),
    });
    this.pushRecord({
      ruleKey: round.ruleKey,
      mutationId: round.mutationId,
      correct: true,
      timeout: false,
      reactionMs,
      wrongTarget: null,
    });
    this.emit({ type: 'correct', slot, points, combo });
    if (level > s.level) this.emit({ type: 'levelUp', level });
    this.finishRound(now, false);
  }

  private resolveMiss(slot: number | null, timeout: boolean, now: number) {
    const s = this.s;
    const round = s.round!;
    const wrong = slot !== null ? round.targets[slot] : null;
    const lives = s.lives - 1;
    const levelProgress = progressAfterMiss(s.levelProgress);

    this.set({
      lives,
      combo: 0,
      multiplier: 1,
      levelProgress,
      level: levelFromProgress(levelProgress),
      mutation: s.mutation ? { ...s.mutation, hadMiss: true } : null,
      feedback: this.feedback(timeout ? 'timeout' : 'wrong', slot, 0, timeout ? 'TOO SLOW' : 'WRONG', now),
    });
    this.pushRecord({
      ruleKey: round.ruleKey,
      mutationId: round.mutationId,
      correct: false,
      timeout,
      reactionMs: null,
      wrongTarget: wrong ? { color: wrong.color, symbol: wrong.symbol } : null,
    });
    this.emit({ type: 'wrong', slot, timeout });

    if (lives <= 0) {
      this.set({ roundActive: false });
      this.endGame('lives', now);
      return;
    }
    this.finishRound(now, true);
  }

  private finishRound(now: number, missed: boolean) {
    const s = this.s;
    this.memoryColor = s.round!.memoryColor;
    // After a miss, hold a little longer so the correct target can be shown.
    const gap = gapMs(s.level) + (missed ? 380 : 0);
    this.set({ roundActive: false, nextRoundAt: now + gap });

    if (s.mutation) {
      const roundsLeft = s.mutation.roundsLeft - 1;
      if (roundsLeft > 0) {
        this.set({ mutation: { ...s.mutation, roundsLeft } });
      } else {
        const flawless = !s.mutation.hadMiss;
        const bonus = flawless ? CONFIG.mutationClearBonus * s.mutation.rec.intensity : 0;
        const mutationsSurvived = s.mutationsSurvived + (flawless ? 1 : 0);
        this.set({
          mutation: null,
          score: this.s.score + bonus,
          mutationsSurvived,
          nextMutationAtRound: s.records.length + roundsBetweenMutations(s.level),
          aiCached: null,
          aiState: 'idle',
        });
        if (flawless) this.emit({ type: 'mutationCleared', bonus });
        if (mutationsSurvived >= this.winTarget) this.endGame('win', now);
      }
    }
  }

  private pushRecord(r: RoundRecord) {
    this.set({ records: [...this.s.records, r] });
  }

  private feedback(kind: FeedbackKind, slot: number | null, points: number, text: string, at: number) {
    return { id: ++this.feedbackId, kind, slot, points, text, at };
  }

  // -------------------------------------------------------------------------
  // Mutations + AI
  // -------------------------------------------------------------------------

  private requestAiChallenge() {
    const phase = this.phaseCounter;
    if (!this.ai || this.aiRequestedForPhase === phase) return;
    this.aiRequestedForPhase = phase;

    const summary = this.summary();
    const allowed = allowedMutationsFor(summary);
    const runId = this.runId;
    this.aiController?.abort();
    const controller = new AbortController();
    this.aiController = controller;
    this.set({ aiState: 'thinking' });

    this.ai
      .requestChallenge(summary, allowed, controller.signal)
      .then((rec) => {
        if (runId !== this.runId || phase !== this.phaseCounter) return;
        this.aiCachedForPhase = phase;
        this.set({ aiCached: rec, aiState: rec.source === 'ai' ? 'ready' : 'failed' });
        this.commit();
      })
      .catch(() => {
        if (runId !== this.runId || phase !== this.phaseCounter) return;
        this.set({ aiState: 'failed' });
        this.commit();
      });
  }

  private announceMutation(now: number) {
    const summary = this.summary();
    const cached = this.aiCachedForPhase === this.phaseCounter ? this.s.aiCached : null;
    const pendingReason = this.s.aiState === 'thinking' ? 'ai-still-thinking' : this.ai ? 'ai-failed' : 'ai-disabled';
    let rec = this.applySafety(cached ?? fallbackChallenge(summary, allowedMutationsFor(summary), pendingReason), summary);
    // The deciding mutation is a boss fight: never gentler than the configured minimum.
    const isFinal = this.s.mutationsSurvived === this.winTarget - 1;
    if (isFinal && rec.intensity < CONFIG.finalMutationMinIntensity) {
      rec = { ...rec, intensity: CONFIG.finalMutationMinIntensity as 1 | 2 | 3 };
    }

    // Anything still in flight is now obsolete.
    this.aiController?.abort();
    this.aiController = null;
    this.phaseCounter++;

    const length = mutationPhaseLength(rec.intensity);
    const active: ActiveMutation = {
      rec,
      roundsLeft: length,
      totalRounds: length,
      hadMiss: false,
      phaseId: this.phaseCounter,
      isFinal,
    };
    this.set({
      status: 'MUTATION_TRANSITION',
      statusUntil: now + CONFIG.mutationTransitionMs,
      // The run clock pauses while the mutation is announced.
      runEndsAt: this.s.runEndsAt + CONFIG.mutationTransitionMs,
      mutation: active,
      announcing: active,
      mutationHistory: [...this.s.mutationHistory, rec.mutationId],
      round: null,
      aiState: rec.source === 'ai' ? 'ready' : this.s.aiState,
    });
    this.emit({ type: 'mutation', mutationId: rec.mutationId, source: rec.source });
  }

  /**
   * Engine-side safety net, applied regardless of what the model said:
   * never repeat the last mutation back-to-back, and cap intensity to what
   * the player's current state can handle.
   */
  applySafety(rec: ChallengeRecommendation, summary: PerformanceSummary): ChallengeRecommendation {
    const last = this.s.mutationHistory[this.s.mutationHistory.length - 1];
    if (!MUTATIONS[rec.mutationId] || rec.mutationId === last) {
      return { ...fallbackChallenge(summary, allowedMutationsFor(summary), 'safety-repeat'), source: 'fallback' };
    }
    const intensity = Math.max(1, Math.min(rec.intensity, maxIntensityFor(summary))) as 1 | 2 | 3;
    return intensity === rec.intensity ? rec : { ...rec, intensity };
  }

  // -------------------------------------------------------------------------
  // Game over
  // -------------------------------------------------------------------------

  private endGame(reason: 'lives' | 'time' | 'win', now: number) {
    this.aiController?.abort();
    this.aiController = null;
    const timeLeftMs = reason === 'time' ? 0 : Math.max(0, this.s.runEndsAt - now);
    const winBonus = reason === 'win' ? Math.ceil(timeLeftMs / 1000) * CONFIG.winTimeBonusPerSec : 0;
    if (winBonus) this.set({ score: this.s.score + winBonus, winBonus });
    const s = this.s;
    const isNewBest = s.score > s.bestScore;
    const bestScore = Math.max(s.bestScore, s.score);
    if (isNewBest) this.store.saveBest(bestScore);

    const run = buildRunSummary(
      s.records,
      {
        combo: s.combo,
        bestCombo: s.bestCombo,
        mutationHistory: s.mutationHistory,
        level: s.level,
        lives: s.lives,
        score: s.score,
      },
      {
        durationSec: Math.max(0, (Math.min(now, s.runEndsAt) - s.runStartedAt) / 1000),
        endReason: reason,
        mutationsSurvived: s.mutationsSurvived,
      },
    );

    this.set({
      status: 'GAME_OVER',
      statusUntil: now + CONFIG.gameOverSplashMs,
      round: null,
      roundActive: false,
      mutation: null,
      announcing: null,
      timeLeftMs,
      bestScore,
      isNewBest,
      finalSummary: run,
      analysis: null,
      analysisStatus: 'loading',
    });
    this.emit({ type: 'gameOver', won: reason === 'win' });
    this.requestAnalysis(run);
  }

  private requestAnalysis(run: RunSummary) {
    const runId = this.runId;
    if (!this.ai) {
      this.set({ analysis: fallbackAnalysis(run, 'ai-disabled'), analysisStatus: 'done' });
      return;
    }
    const controller = new AbortController();
    this.analysisController = controller;
    this.ai
      .requestAnalysis(run, controller.signal)
      .catch(() => fallbackAnalysis(run, 'ai-failed'))
      .then((analysis) => {
        if (runId !== this.runId) return;
        this.set({ analysis, analysisStatus: 'done' });
        this.commit();
      });
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  private shiftTimers(delta: number) {
    const s = this.s;
    this.set({
      statusUntil: s.statusUntil + delta,
      runEndsAt: s.runEndsAt + delta,
      nextRoundAt: s.nextRoundAt + delta,
      round: s.round ? { ...s.round, startedAt: s.round.startedAt + delta, deadline: s.round.deadline + delta } : null,
    });
  }

  private abortAll() {
    this.aiController?.abort();
    this.analysisController?.abort();
    this.aiController = null;
    this.analysisController = null;
  }
}
