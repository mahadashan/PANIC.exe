/**
 * Single source of truth for everything the game engine, the backend and the
 * AI prompt need to agree on: colors, symbols, rule kinds, the mutation
 * allowlist, request/response schemas and deterministic fallbacks.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Target vocabulary
// ---------------------------------------------------------------------------

export const COLOR_IDS = ['red', 'cyan', 'lime', 'amber'] as const;
export type ColorId = (typeof COLOR_IDS)[number];

export const COLORS: Record<ColorId, { label: string; hex: string }> = {
  red: { label: 'RED', hex: '#ff3b5c' },
  cyan: { label: 'CYAN', hex: '#2de2ff' },
  lime: { label: 'LIME', hex: '#b6ff3b' },
  amber: { label: 'AMBER', hex: '#ffb020' },
};

export const SYMBOL_IDS = ['circle', 'triangle', 'square', 'star'] as const;
export type SymbolId = (typeof SYMBOL_IDS)[number];

export const SYMBOLS: Record<SymbolId, { label: string; glyph: string }> = {
  circle: { label: 'CIRCLE', glyph: '●' },
  triangle: { label: 'TRIANGLE', glyph: '▲' },
  square: { label: 'SQUARE', glyph: '■' },
  star: { label: 'STAR', glyph: '★' },
};

/** Base rules used outside of mutation phases. */
export const RULE_KINDS = [
  'tapColor',
  'avoidColor',
  'tapSymbol',
  'previousColor',
  'doubleTap',
  'ignoreTarget',
] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

// ---------------------------------------------------------------------------
// Mutation allowlist
// ---------------------------------------------------------------------------

export const MUTATION_IDS = [
  'doubleTap',
  'colorBlind',
  'speedSurge',
  'ignoreTarget',
  'previousColor',
  'symbolOverride',
  'reverseColors',
  'reverseInstruction',
] as const;
export type MutationId = (typeof MUTATION_IDS)[number];

export interface MutationDef {
  id: MutationId;
  name: string;
  /** 1 = gentle, 3 = brutal. Used for adaptive selection and safety limits. */
  tier: 1 | 2 | 3;
  /** Exact, canonical rule shown to the player (never AI-generated). */
  rule: string;
  /** Description given to the model so it can choose sensibly. */
  aiHint: string;
  defaultInstruction: string;
  /** Multiplier applied to the response window during this mutation. */
  windowScale: number;
}

export const MUTATIONS: Record<MutationId, MutationDef> = {
  doubleTap: {
    id: 'doubleTap',
    name: 'DOUBLE TAP',
    tier: 1,
    rule: 'Every correct target must be tapped twice.',
    aiHint: 'every correct target needs two taps; punishes rushed single taps',
    defaultInstruction: 'ONE TAP IS NEVER ENOUGH.',
    windowScale: 1.15,
  },
  colorBlind: {
    id: 'colorBlind',
    name: 'COLOR BLINDNESS',
    tier: 1,
    rule: 'Colors are drained. Follow the symbol only.',
    aiHint: 'targets lose their colors and only symbols matter; a gentle reset for players who rely on color',
    defaultInstruction: 'COLOR IS GONE. TRUST THE SHAPE.',
    windowScale: 1,
  },
  speedSurge: {
    id: 'speedSurge',
    name: 'SPEED SURGE',
    tier: 2,
    rule: 'The response window shrinks hard.',
    aiHint: 'much shorter response window; tests raw reaction speed',
    defaultInstruction: 'FASTER. FASTER. FASTER.',
    windowScale: 0.68,
  },
  ignoreTarget: {
    id: 'ignoreTarget',
    name: 'IGNORE THE STAR',
    tier: 2,
    rule: 'Never tap a ★, even when it matches.',
    aiHint: 'a star-shaped decoy always matches the instruction and must be avoided; tests impulse control',
    defaultInstruction: 'THE STAR IS A LIE.',
    windowScale: 1,
  },
  previousColor: {
    id: 'previousColor',
    name: 'PREVIOUS COLOR',
    tier: 2,
    rule: 'Tap the color of the last target you hit.',
    aiHint: 'the correct target is the color the player hit last round; tests short-term memory',
    defaultInstruction: 'REMEMBER WHAT YOU JUST DID.',
    windowScale: 1.1,
  },
  symbolOverride: {
    id: 'symbolOverride',
    name: 'SYMBOL OVERRIDE',
    tier: 3,
    rule: 'Instruction shows a color AND a symbol. The symbol wins.',
    aiHint: 'instructions name a color and a symbol on different targets; only the symbol counts',
    defaultInstruction: 'IGNORE THE COLOR. FOLLOW THE SYMBOL.',
    windowScale: 1.05,
  },
  reverseColors: {
    id: 'reverseColors',
    name: 'REVERSE COLORS',
    tier: 3,
    rule: 'Colors swap: RED ⇄ CYAN, LIME ⇄ AMBER.',
    aiHint: 'named colors swap with their opposite pair; punishes color autopilot',
    defaultInstruction: 'RED MEANS CYAN NOW.',
    windowScale: 1.15,
  },
  reverseInstruction: {
    id: 'reverseInstruction',
    name: 'REVERSE INSTRUCTION',
    tier: 3,
    rule: 'TAP means AVOID. AVOID means TAP.',
    aiHint: 'the action word is inverted; punishes players who react before reading',
    defaultInstruction: 'DO THE OPPOSITE.',
    windowScale: 1.1,
  },
};

export const COLOR_SWAP: Record<ColorId, ColorId> = {
  red: 'cyan',
  cyan: 'red',
  lime: 'amber',
  amber: 'lime',
};

export type RuleKey = RuleKind | MutationId;

export const RULE_LABELS: Record<RuleKey, string> = {
  tapColor: 'tapping the named color',
  avoidColor: 'avoiding a color',
  tapSymbol: 'finding symbols',
  previousColor: 'remembering the previous color',
  doubleTap: 'double-tapping',
  ignoreTarget: 'ignoring decoy targets',
  colorBlind: 'color-blind rounds',
  speedSurge: 'speed surges',
  symbolOverride: 'symbol-over-color rounds',
  reverseColors: 'reversed colors',
  reverseInstruction: 'reversed instructions',
};

export function isMutationId(value: unknown): value is MutationId {
  return typeof value === 'string' && (MUTATION_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ruleKeySchema = z.enum([...RULE_KINDS, ...MUTATION_IDS] as [RuleKey, ...RuleKey[]]);
const countMap = z.partialRecord(ruleKeySchema, z.number().int().min(0).max(10_000));
const ms = z.number().min(0).max(60_000);

export const performanceSummarySchema = z
  .object({
    roundsPlayed: z.number().int().min(0).max(10_000),
    correct: z.number().int().min(0).max(10_000),
    incorrect: z.number().int().min(0).max(10_000),
    timeouts: z.number().int().min(0).max(10_000),
    accuracy: z.number().min(0).max(1),
    averageReactionMs: ms,
    recentAverageReactionMs: ms,
    recentTrend: z.enum(['improving', 'steady', 'slowing', 'unknown']),
    missedRules: countMap,
    seenRules: countMap,
    mostMissedRule: ruleKeySchema.nullable(),
    mostSelectedWrongTarget: z
      .object({ color: z.enum(COLOR_IDS), symbol: z.enum(SYMBOL_IDS), count: z.number().int().min(1).max(10_000) })
      .nullable(),
    currentCombo: z.number().int().min(0).max(10_000),
    bestCombo: z.number().int().min(0).max(10_000),
    recentMutations: z.array(z.enum(MUTATION_IDS)).max(20),
    difficulty: z.number().int().min(1).max(10),
    livesLeft: z.number().int().min(0).max(10),
    score: z.number().int().min(0).max(100_000_000),
  })
  .strict();
export type PerformanceSummary = z.infer<typeof performanceSummarySchema>;

export const runSummarySchema = performanceSummarySchema
  .extend({
    durationSec: z.number().min(0).max(3600),
    endReason: z.enum(['lives', 'time', 'win']),
    mutationsSurvived: z.number().int().min(0).max(1000),
  })
  .strict();
export type RunSummary = z.infer<typeof runSummarySchema>;

const shortText = (max: number) =>
  z
    .string()
    .transform((s) => sanitizeText(s, max))
    .pipe(z.string().min(2).max(max));

/** Raw shape the model must produce for the next challenge. */
export const modelChallengeSchema = z.object({
  mutationId: z.string(),
  reason: shortText(140),
  instruction: shortText(48),
  intensity: z.coerce.number().int().min(1).max(3),
  taunt: shortText(90),
});

export interface ChallengeRecommendation {
  mutationId: MutationId;
  reason: string;
  instruction: string;
  intensity: 1 | 2 | 3;
  taunt: string;
  source: 'ai' | 'fallback';
  /** Why the fallback was used (diagnostics only, never shown mid-game). */
  fallbackReason?: string;
  latencyMs?: number;
}

export const challengeResponseSchema = z.object({
  mutationId: z.enum(MUTATION_IDS),
  reason: z.string().max(200),
  instruction: z.string().max(60),
  intensity: z.number().int().min(1).max(3),
  taunt: z.string().max(120),
  source: z.enum(['ai', 'fallback']),
  fallbackReason: z.string().optional(),
  latencyMs: z.number().optional(),
});

export const modelAnalysisSchema = z.object({
  strongestSkill: shortText(160),
  frequentMistake: shortText(160),
  observation: shortText(200),
  taunt: shortText(120),
  improvement: shortText(160),
});
export type AnalysisText = z.infer<typeof modelAnalysisSchema>;

export interface RunAnalysis extends AnalysisText {
  source: 'ai' | 'fallback' | 'mixed';
  fallbackReason?: string;
  latencyMs?: number;
}

export const analysisResponseSchema = z.object({
  strongestSkill: z.string(),
  frequentMistake: z.string(),
  observation: z.string(),
  taunt: z.string(),
  improvement: z.string(),
  source: z.enum(['ai', 'fallback', 'mixed']),
  fallbackReason: z.string().optional(),
  latencyMs: z.number().optional(),
});

/** Request body for /api/ai/next-challenge. */
export const nextChallengeRequestSchema = z
  .object({ summary: performanceSummarySchema, allowedMutations: z.array(z.enum(MUTATION_IDS)).min(1).max(8) })
  .strict();
export type NextChallengeRequest = z.infer<typeof nextChallengeRequestSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sanitizeText(input: string, max: number): string {
  const cleaned = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>`*_#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

/** Replaces internal rule ids the model may echo (e.g. "speedSurges") with plain English. */
export function humanizeRuleIds(text: string): string {
  return text.replace(/['‘’"]?\b([a-z]+[A-Z][A-Za-z]*?)(s?)\b['‘’"]?/g, (match, id: string) =>
    id in RULE_LABELS ? RULE_LABELS[id as RuleKey] : match,
  );
}

/**
 * Mutations the model may pick: within the safe tier for the player's current
 * state, excluding the one just played. Always returns at least one id.
 */
export function allowedMutationsFor(
  summary: Pick<PerformanceSummary, 'recentMutations' | 'difficulty' | 'accuracy' | 'livesLeft'>,
): MutationId[] {
  const maxTier = maxTierFor(summary);
  const inTier = MUTATION_IDS.filter((id) => MUTATIONS[id].tier <= maxTier);
  // Prefer variety: skip the last two mutations when enough options remain, never the very last one.
  const recentTwo = summary.recentMutations.slice(-2);
  const varied = inTier.filter((id) => !recentTwo.includes(id));
  if (varied.length >= 2) return varied;
  const last = summary.recentMutations[summary.recentMutations.length - 1];
  return inTier.filter((id) => id !== last);
}

/** Highest tier the engine will accept for a given difficulty / accuracy. */
export function maxTierFor(summary: Pick<PerformanceSummary, 'difficulty' | 'accuracy' | 'livesLeft'>): 1 | 2 | 3 {
  if (summary.livesLeft <= 1 || summary.accuracy < 0.55) return 1;
  if (summary.difficulty <= 2 || summary.accuracy < 0.7) return 2;
  return 3;
}

export function maxIntensityFor(summary: Pick<PerformanceSummary, 'difficulty' | 'accuracy' | 'livesLeft'>): 1 | 2 | 3 {
  if (summary.livesLeft <= 1 || summary.accuracy < 0.65 || summary.difficulty <= 2) return 1;
  if (summary.accuracy < 0.85 || summary.difficulty <= 4) return 2;
  return 3;
}

/** Which mutation stresses the weakness behind a given missed rule. */
const WEAKNESS_TO_MUTATION: Record<RuleKey, MutationId> = {
  tapColor: 'reverseColors',
  avoidColor: 'reverseInstruction',
  tapSymbol: 'symbolOverride',
  previousColor: 'previousColor',
  doubleTap: 'doubleTap',
  ignoreTarget: 'ignoreTarget',
  colorBlind: 'colorBlind',
  speedSurge: 'speedSurge',
  symbolOverride: 'symbolOverride',
  reverseColors: 'reverseColors',
  reverseInstruction: 'reverseInstruction',
};

const FALLBACK_TAUNTS = [
  'Your thumbs are writing checks your brain cannot cash.',
  'I have seen screensavers react faster.',
  'Predictable. Deliciously predictable.',
  'Muscle memory is just a habit I can exploit.',
  'Blink and you lose. You blink a lot.',
];

/**
 * Deterministic challenge selection from the same statistics the model sees.
 * Used when Ollama is down, slow, or returns something invalid.
 */
export function fallbackChallenge(
  summary: PerformanceSummary,
  allowed: readonly MutationId[] = allowedMutationsFor(summary),
  fallbackReason = 'ai-unavailable',
): ChallengeRecommendation {
  const pool = allowed.length ? allowed : MUTATION_IDS.filter((id) => id !== 'speedSurge');
  const maxTier = maxTierFor(summary);
  const eligible = pool.filter((id) => MUTATIONS[id].tier <= maxTier);
  const candidates = eligible.length ? eligible : pool;

  let pick: MutationId | undefined;
  let reason: string;
  const missed = summary.mostMissedRule;
  const target = missed ? WEAKNESS_TO_MUTATION[missed] : undefined;

  if (target && candidates.includes(target)) {
    pick = target;
    reason = `Most misses came from ${RULE_LABELS[missed!]}.`;
  } else if (
    summary.averageReactionMs > 0 &&
    summary.averageReactionMs < 650 &&
    candidates.includes('speedSurge') &&
    !summary.recentMutations.includes('speedSurge')
  ) {
    pick = 'speedSurge';
    reason = `Average reaction of ${Math.round(summary.averageReactionMs)} ms is fast; time to squeeze it.`;
  } else {
    // Least recently seen mutation, ties broken by tier then list order.
    const seenCount = (id: MutationId) => summary.recentMutations.filter((m) => m === id).length;
    pick = [...candidates].sort((a, b) => seenCount(a) - seenCount(b) || MUTATIONS[a].tier - MUTATIONS[b].tier)[0];
    reason = `Accuracy is ${Math.round(summary.accuracy * 100)}%, so a fresh rule should test adaptation.`;
  }

  const intensity = Math.min(
    maxIntensityFor(summary),
    summary.accuracy >= 0.85 ? 3 : summary.accuracy >= 0.7 ? 2 : 1,
  ) as 1 | 2 | 3;

  return {
    mutationId: pick!,
    reason,
    instruction: MUTATIONS[pick!].defaultInstruction,
    intensity,
    taunt: FALLBACK_TAUNTS[summary.roundsPlayed % FALLBACK_TAUNTS.length],
    source: 'fallback',
    fallbackReason,
  };
}

function ruleAccuracies(summary: PerformanceSummary) {
  return (Object.keys(summary.seenRules) as RuleKey[])
    .map((key) => {
      const seen = summary.seenRules[key] ?? 0;
      const missed = summary.missedRules[key] ?? 0;
      return { key, seen, missed, acc: seen ? (seen - missed) / seen : 0 };
    })
    .filter((r) => r.seen > 0);
}

/** Deterministic run analysis, built only from recorded numbers. */
export function fallbackAnalysis(run: RunSummary, fallbackReason = 'ai-unavailable'): RunAnalysis {
  const rules = ruleAccuracies(run);
  const best = [...rules].sort((a, b) => b.acc - a.acc || b.seen - a.seen)[0];
  const acc = Math.round(run.accuracy * 100);
  const avg = Math.round(run.averageReactionMs);

  const strongestSkill = best
    ? `${capitalize(RULE_LABELS[best.key])}: ${best.seen - best.missed} of ${best.seen} cleared.`
    : 'Showing up. That is about it.';

  let frequentMistake: string;
  if (run.timeouts > 0 && run.timeouts >= run.incorrect - run.timeouts) {
    frequentMistake = `Hesitation. ${run.timeouts} rounds timed out before you acted.`;
  } else if (run.mostMissedRule) {
    frequentMistake = `${capitalize(RULE_LABELS[run.mostMissedRule])} caused ${run.missedRules[run.mostMissedRule] ?? 0} misses.`;
  } else {
    frequentMistake = 'No repeated mistake. Suspicious.';
  }

  const observation =
    run.endReason === 'win'
      ? `You cleared ${run.mutationsSurvived} mutations without a miss, averaging ${avg} ms at ${acc}% accuracy.`
      : run.recentTrend === 'improving'
      ? `Your reactions sped up late in the run, averaging ${avg} ms overall at ${acc}% accuracy.`
      : run.recentTrend === 'slowing'
        ? `You slowed down as the run went on, averaging ${avg} ms at ${acc}% accuracy.`
        : `You averaged ${avg} ms per reaction at ${acc}% accuracy across ${run.roundsPlayed} rounds.`;

  const improvement = run.mostMissedRule
    ? `Read the instruction fully before moving during ${RULE_LABELS[run.mostMissedRule]}.`
    : 'Push for speed. Your accuracy can afford it.';

  return {
    strongestSkill,
    frequentMistake,
    observation,
    taunt:
      run.endReason === 'win'
        ? 'Fine. You win this time. I am already learning.'
        : FALLBACK_TAUNTS[run.roundsPlayed % FALLBACK_TAUNTS.length],
    improvement,
    source: 'fallback',
    fallbackReason,
  };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Numbers the analysis text is allowed to mention: every recorded statistic
 * in the formats a person (or a model) would naturally write them.
 */
export function groundedNumbers(run: PerformanceSummary | RunSummary): Set<number> {
  const out = new Set<number>();
  const add = (n: number) => {
    if (!Number.isFinite(n)) return;
    out.add(Math.round(n));
    out.add(Math.floor(n));
    out.add(Math.round(n * 10) / 10);
  };
  for (const [key, value] of Object.entries(run)) {
    if (typeof value === 'number') {
      add(value);
      if (key === 'accuracy') {
        add(value * 100);
      }
      if (key.endsWith('Ms')) add(value / 1000);
    }
  }
  for (const v of Object.values(run.missedRules)) add(v ?? 0);
  for (const v of Object.values(run.seenRules)) add(v ?? 0);
  if (run.mostSelectedWrongTarget) add(run.mostSelectedWrongTarget.count);
  // Small counting words ("one more", "2 lives") are always acceptable.
  for (let i = 0; i <= 10; i++) out.add(i);
  out.add(100);
  return out;
}

/** Returns numbers in `text` that do not correspond to any recorded stat. */
export function findUngroundedNumbers(text: string, allowed: Set<number>): number[] {
  const matches = text.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(?:\.\d+)?/g) ?? [];
  return matches
    .map(Number)
    .filter((n) => {
      if (allowed.has(n)) return false;
      // Accept rounding to the nearest 10 ("about 450 ms") for values >= 100.
      for (const a of allowed) if (a >= 100 && Math.abs(a - n) <= 10) return false;
      return true;
    });
}
