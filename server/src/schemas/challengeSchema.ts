/**
 * Validation of raw model output. Everything the model says is treated as
 * untrusted text: parsed defensively, checked against the allowlist and
 * shape-validated before it can reach the game.
 */
import {
  findUngroundedNumbers,
  groundedNumbers,
  humanizeRuleIds,
  isMutationId,
  modelAnalysisSchema,
  modelChallengeSchema,
  type AnalysisText,
  type ChallengeRecommendation,
  type MutationId,
  type PerformanceSummary,
  type RunSummary,
} from '../../../shared/challenges';

export type Validated<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Extracts the first JSON object from model text (tolerates code fences / chatter). */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object found');
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export function validateChallenge(
  raw: string,
  allowed: readonly MutationId[],
  summary?: PerformanceSummary,
): Validated<Omit<ChallengeRecommendation, 'source'> & { reasonGrounded: boolean }> {
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  const parsed = modelChallengeSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: `schema: ${parsed.error.issues[0]?.path.join('.') || 'shape'}` };
  const { mutationId, reason, instruction, intensity, taunt } = parsed.data;
  if (!isMutationId(mutationId)) return { ok: false, reason: `unknown-mutation: ${String(mutationId).slice(0, 40)}` };
  if (!allowed.includes(mutationId)) return { ok: false, reason: `mutation-not-allowed: ${mutationId}` };
  const reasonGrounded = !summary || findUngroundedNumbers(reason, groundedNumbers(summary)).length === 0;
  return {
    ok: true,
    value: {
      reasonGrounded,
      mutationId,
      reason: humanizeRuleIds(reason),
      instruction: instruction.toUpperCase(),
      intensity: intensity as 1 | 2 | 3,
      taunt: humanizeRuleIds(taunt),
    },
  };
}

export interface AnalysisValidation {
  ok: boolean;
  reason?: string;
  value?: AnalysisText;
  /** Field names whose text cited numbers that are not in the recorded stats. */
  ungrounded: Array<keyof AnalysisText>;
}

export function validateAnalysis(raw: string, run: RunSummary): AnalysisValidation {
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch {
    return { ok: false, reason: 'invalid-json', ungrounded: [] };
  }
  const parsed = modelAnalysisSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: `schema: ${parsed.error.issues[0]?.path.join('.') || 'shape'}`, ungrounded: [] };
  }
  const allowed = groundedNumbers(run);
  const ungrounded = (Object.keys(parsed.data) as Array<keyof AnalysisText>).filter(
    (k) =>
      findUngroundedNumbers(parsed.data[k], allowed).length > 0 ||
      // Taunts are flavor, not statistics: any number there is treated as invented.
      (k === 'taunt' && /\d/.test(parsed.data[k])),
  );
  const value = Object.fromEntries(
    Object.entries(parsed.data).map(([k, v]) => [k, humanizeRuleIds(v)]),
  ) as AnalysisText;
  return { ok: true, value, ungrounded };
}
