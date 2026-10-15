/** All tunable gameplay constants and the pure math built on them. */
export const CONFIG = {
  startingLives: 5,
  runDurationMs: 100_000,
  countdownMs: 2_400,
  mutationTransitionMs: 2_600,
  gameOverSplashMs: 1_700,

  basePoints: 100,
  maxSpeedBonus: 50,
  comboStep: 5,
  multiplierStep: 0.5,
  maxMultiplier: 4,
  mutationClearBonus: 300,

  minLevel: 1,
  maxLevel: 10,
  correctPerLevel: 4,

  maxWindowMs: 2_400,
  minBaseWindowMs: 950,
  windowStepMs: 160,
  /** Absolute floor after mutation and intensity scaling. */
  hardMinWindowMs: 650,

  maxGapMs: 520,
  minGapMs: 260,
  gapStepMs: 30,

  firstMutationRound: 6,
  /** Rounds before a mutation phase at which the AI is asked for it. */
  aiLeadRounds: 4,
  /**
   * If the model is still thinking when a mutation is due, keep playing up to
   * this many normal rounds before using a fallback. Gameplay never pauses.
   */
  aiGraceRounds: 2,

  /** Win condition: clear this many mutations without a single miss inside them. */
  winMutationClears: 3,
  /** The deciding mutation is forced to at least this intensity. */
  finalMutationMinIntensity: 2,
  /** Points per second left on the clock when the player wins. */
  winTimeBonusPerSec: 50,
} as const;

/** Multiplier earned by the current streak (before the hit being scored). */
export function comboMultiplier(combo: number): number {
  const steps = Math.floor(Math.max(0, combo) / CONFIG.comboStep);
  return Math.min(1 + steps * CONFIG.multiplierStep, CONFIG.maxMultiplier);
}

export function speedBonus(reactionMs: number, windowMs: number): number {
  if (windowMs <= 0) return 0;
  const ratio = 1 - reactionMs / windowMs;
  return Math.round(CONFIG.maxSpeedBonus * Math.min(1, Math.max(0, ratio)));
}

export function pointsForHit(reactionMs: number, windowMs: number, comboBefore: number): number {
  return Math.round((CONFIG.basePoints + speedBonus(reactionMs, windowMs)) * comboMultiplier(comboBefore));
}

export function levelFromProgress(progress: number): number {
  const level = CONFIG.minLevel + Math.floor(Math.max(0, progress) / CONFIG.correctPerLevel);
  return Math.min(CONFIG.maxLevel, Math.max(CONFIG.minLevel, level));
}

/** A miss drops the player back by one level so a streak never snowballs into impossible. */
export function progressAfterMiss(progress: number): number {
  return Math.max(0, progress - CONFIG.correctPerLevel);
}

export const INTENSITY_WINDOW_SCALE: Record<1 | 2 | 3, number> = { 1: 1, 2: 0.92, 3: 0.85 };

export function responseWindowMs(level: number, mutationScale = 1, intensity: 1 | 2 | 3 = 1): number {
  const base = Math.max(CONFIG.minBaseWindowMs, CONFIG.maxWindowMs - CONFIG.windowStepMs * (level - 1));
  const scaled = base * mutationScale * INTENSITY_WINDOW_SCALE[intensity];
  return Math.round(Math.min(CONFIG.maxWindowMs * 1.2, Math.max(CONFIG.hardMinWindowMs, scaled)));
}

export function gapMs(level: number): number {
  return Math.max(CONFIG.minGapMs, CONFIG.maxGapMs - CONFIG.gapStepMs * (level - 1));
}

export function targetCountFor(level: number): 3 | 4 {
  return level <= 2 ? 3 : 4;
}

/** Rounds between mutation phases: shrinks as difficulty rises. */
export function roundsBetweenMutations(level: number): number {
  return Math.max(3, 7 - Math.floor(level / 2));
}

export function mutationPhaseLength(intensity: 1 | 2 | 3): number {
  return 3 + intensity;
}
