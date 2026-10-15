/**
 * Compresses per-round records into the compact summary sent to the AI.
 * Individual input events never leave this module.
 */
import {
  MUTATION_IDS,
  RULE_KINDS,
  type MutationId,
  type PerformanceSummary,
  type RuleKey,
  type RunSummary,
} from '../../../shared/challenges';
import type { RoundRecord } from './gameTypes';

const RULE_ORDER: RuleKey[] = [...RULE_KINDS, ...MUTATION_IDS];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export interface LiveCounters {
  combo: number;
  bestCombo: number;
  mutationHistory: MutationId[];
  level: number;
  lives: number;
  score: number;
}

export function buildPerformanceSummary(records: RoundRecord[], live: LiveCounters): PerformanceSummary {
  const correct = records.filter((r) => r.correct).length;
  const timeouts = records.filter((r) => r.timeout).length;
  const reactions = records.filter((r) => r.correct && r.reactionMs !== null).map((r) => r.reactionMs!);

  const recent = reactions.slice(-5);
  const earlier = reactions.slice(0, -5);
  let recentTrend: PerformanceSummary['recentTrend'] = 'unknown';
  if (recent.length >= 3 && earlier.length >= 3) {
    const ratio = mean(recent) / mean(earlier);
    recentTrend = ratio < 0.92 ? 'improving' : ratio > 1.08 ? 'slowing' : 'steady';
  }

  const missedRules: Partial<Record<RuleKey, number>> = {};
  const seenRules: Partial<Record<RuleKey, number>> = {};
  for (const r of records) {
    seenRules[r.ruleKey] = (seenRules[r.ruleKey] ?? 0) + 1;
    if (!r.correct) missedRules[r.ruleKey] = (missedRules[r.ruleKey] ?? 0) + 1;
  }

  let mostMissedRule: RuleKey | null = null;
  for (const key of RULE_ORDER) {
    const m = missedRules[key] ?? 0;
    if (!m) continue;
    if (!mostMissedRule) {
      mostMissedRule = key;
      continue;
    }
    const best = missedRules[mostMissedRule] ?? 0;
    const rate = m / (seenRules[key] ?? 1);
    const bestRate = best / (seenRules[mostMissedRule] ?? 1);
    if (m > best || (m === best && rate > bestRate)) mostMissedRule = key;
  }

  const wrongCounts = new Map<string, number>();
  for (const r of records) {
    if (!r.wrongTarget) continue;
    const key = `${r.wrongTarget.color}:${r.wrongTarget.symbol}`;
    wrongCounts.set(key, (wrongCounts.get(key) ?? 0) + 1);
  }
  let mostSelectedWrongTarget: PerformanceSummary['mostSelectedWrongTarget'] = null;
  for (const [key, count] of wrongCounts) {
    if (!mostSelectedWrongTarget || count > mostSelectedWrongTarget.count) {
      const [color, symbol] = key.split(':') as [never, never];
      mostSelectedWrongTarget = { color, symbol, count };
    }
  }

  return {
    roundsPlayed: records.length,
    correct,
    incorrect: records.length - correct,
    timeouts,
    accuracy: records.length ? Math.round((correct / records.length) * 1000) / 1000 : 0,
    averageReactionMs: Math.round(mean(reactions)),
    recentAverageReactionMs: Math.round(mean(recent)),
    recentTrend,
    missedRules,
    seenRules,
    mostMissedRule,
    mostSelectedWrongTarget,
    currentCombo: live.combo,
    bestCombo: live.bestCombo,
    recentMutations: live.mutationHistory.slice(-5),
    difficulty: Math.min(10, Math.max(1, live.level)),
    livesLeft: Math.max(0, live.lives),
    score: Math.max(0, Math.round(live.score)),
  };
}

export function buildRunSummary(
  records: RoundRecord[],
  live: LiveCounters,
  extra: { durationSec: number; endReason: RunSummary['endReason']; mutationsSurvived: number },
): RunSummary {
  return {
    ...buildPerformanceSummary(records, live),
    durationSec: Math.round(extra.durationSec * 10) / 10,
    endReason: extra.endReason,
    mutationsSurvived: extra.mutationsSurvived,
  };
}
