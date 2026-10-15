import {
  COLORS,
  MUTATIONS,
  RULE_LABELS,
  SYMBOLS,
  type MutationId,
  type PerformanceSummary,
  type RuleKey,
  type RunSummary,
} from '../../../shared/challenges';
import type { ChatMessage } from './ollamaService';

/** JSON schema handed to Ollama so decoding is constrained to the allowlist. */
export function challengeJsonSchema(allowed: MutationId[]) {
  return {
    type: 'object',
    properties: {
      mutationId: { type: 'string', enum: allowed },
      reason: { type: 'string' },
      instruction: { type: 'string' },
      intensity: { type: 'integer', enum: [1, 2, 3] },
      taunt: { type: 'string' },
    },
    required: ['mutationId', 'reason', 'instruction', 'intensity', 'taunt'],
  };
}

export const analysisJsonSchema = {
  type: 'object',
  properties: {
    strongestSkill: { type: 'string' },
    frequentMistake: { type: 'string' },
    observation: { type: 'string' },
    taunt: { type: 'string' },
    improvement: { type: 'string' },
  },
  required: ['strongestSkill', 'frequentMistake', 'observation', 'taunt', 'improvement'],
};

function ruleBreakdown(s: PerformanceSummary): string {
  const keys = Object.keys(s.seenRules) as RuleKey[];
  if (!keys.length) return '  (no rounds yet)';
  return keys
    .map((k) => `  - ${k} (${RULE_LABELS[k]}): seen ${s.seenRules[k] ?? 0}, missed ${s.missedRules[k] ?? 0}`)
    .join('\n');
}

function statsBlock(s: PerformanceSummary): string {
  const wrong = s.mostSelectedWrongTarget
    ? `${COLORS[s.mostSelectedWrongTarget.color].label} ${SYMBOLS[s.mostSelectedWrongTarget.symbol].label} (${s.mostSelectedWrongTarget.count} times)`
    : 'none';
  return [
    `rounds played: ${s.roundsPlayed}`,
    `correct: ${s.correct}, incorrect: ${s.incorrect} (of which timeouts: ${s.timeouts})`,
    `accuracy: ${Math.round(s.accuracy * 100)}%`,
    `average reaction: ${s.averageReactionMs} ms (last 5 hits: ${s.recentAverageReactionMs} ms, trend: ${s.recentTrend})`,
    `most missed rule: ${s.mostMissedRule ?? 'none'}`,
    `most tapped wrong target: ${wrong}`,
    `combo: current ${s.currentCombo}, best ${s.bestCombo}`,
    `difficulty level: ${s.difficulty}/10, lives left: ${s.livesLeft}`,
    `mutations already used (oldest first): ${s.recentMutations.join(', ') || 'none'}`,
    `per-rule results:\n${ruleBreakdown(s)}`,
  ].join('\n');
}

export function challengePrompt(summary: PerformanceSummary, allowed: MutationId[]): ChatMessage[] {
  const options = allowed
    .map((id) => `- ${id} (tier ${MUTATIONS[id].tier}): ${MUTATIONS[id].aiHint}`)
    .join('\n');
  return [
    {
      role: 'system',
      content:
        'You are the adversarial game director inside PANIC.exe, a reflex arcade game. ' +
        'You study a player\'s statistics and pick the next rule mutation that will exploit their habits. ' +
        'You only ever answer with a single JSON object.',
    },
    {
      role: 'user',
      content: `PLAYER STATISTICS
${statsBlock(summary)}

ALLOWED MUTATIONS (choose exactly one id from this list, nothing else):
${options}

RULES FOR YOUR CHOICE
- Target the player's weakness: prefer the mutation that stresses their most missed rule or their habits.
- If accuracy is below 70% or lives left is 1, prefer tier 1 or 2 and intensity 1.
- If accuracy is above 85% and they are fast, be brutal: tier 3 and intensity 2 or 3.
- Avoid repeating mutations they have already seen when a good alternative exists.
- In reason and taunt, describe rules in plain English, never by their camelCase ids.

FIELDS
- mutationId: one id from the allowed list.
- reason: one sentence (max 20 words) citing a statistic above that justifies the pick. Only use numbers that appear above.
- instruction: a punchy ALL-CAPS headline of at most 6 words announcing the mutation. It must not contradict the mutation's real effect.
- intensity: 1, 2 or 3.
- taunt: a short, playful, PG taunt aimed at the player (max 12 words), no numbers.`,
    },
  ];
}

export function analysisPrompt(run: RunSummary): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You are the sarcastic but fair system voice of PANIC.exe, a reflex arcade game. ' +
        'You write a very short post-run diagnosis using ONLY the statistics you are given. ' +
        'Never invent numbers, percentages or events. Answer with a single JSON object.',
    },
    {
      role: 'user',
      content: `RUN STATISTICS
final score: ${run.score}
run length: ${run.durationSec} seconds, ended because: ${run.endReason === 'win' ? `the player WON by clearing ${run.mutationsSurvived} mutations without a miss` : run.endReason === 'lives' ? 'out of lives' : 'time ran out'}
mutations cleared without a miss: ${run.mutationsSurvived}
${statsBlock(run)}

Write these fields (each one sentence, max 22 words, plain text, no markdown):
- strongestSkill: the rule or ability they handled best, based on the per-rule results.
- frequentMistake: their most frequent mistake, based on the missed counts or timeouts.
- observation: one concrete observation that quotes at least one exact number from the statistics.
- taunt: a short, playful PG taunt (max 14 words) with no numbers.
- improvement: one specific, actionable tip.
If the player won, admit defeat grudgingly in the taunt.
If a number is not listed above, do not mention it.
Refer to rules in plain English (for example "finding symbols"), never by their camelCase ids.`,
    },
  ];
}
