/**
 * Live check against the locally installed model (default gemma3:4b).
 *   npm run check:ai
 * Verifies Ollama is reachable, the model is installed, and that real model
 * output passes the same validation the server applies, for contrasting
 * player profiles.
 */
import { config } from '../server/src/config';
import { OllamaService } from '../server/src/services/ollamaService';
import { analysisJsonSchema, analysisPrompt, challengeJsonSchema, challengePrompt } from '../server/src/services/prompts';
import { validateAnalysis, validateChallenge } from '../server/src/schemas/challengeSchema';
import { allowedMutationsFor, type PerformanceSummary } from '../shared/challenges';

const ollama = new OllamaService(config.ollamaUrl, config.model);
let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${msg}`);
  if (!ok) failures++;
};

const base: PerformanceSummary = {
  roundsPlayed: 10, correct: 9, incorrect: 1, timeouts: 0, accuracy: 0.9,
  averageReactionMs: 480, recentAverageReactionMs: 430, recentTrend: 'improving',
  missedRules: { tapColor: 1 }, seenRules: { tapColor: 5, tapSymbol: 3, avoidColor: 2 },
  mostMissedRule: 'tapColor', mostSelectedWrongTarget: { color: 'cyan', symbol: 'square', count: 1 },
  currentCombo: 6, bestCombo: 8, recentMutations: ['speedSurge'], difficulty: 6, livesLeft: 3, score: 2400,
};
const profiles: Record<string, PerformanceSummary> = {
  'strong player (fast, accurate)': base,
  'symbol-blind player': {
    ...base, correct: 6, incorrect: 4, accuracy: 0.6, averageReactionMs: 720, recentAverageReactionMs: 800,
    recentTrend: 'slowing', missedRules: { tapSymbol: 3, tapColor: 1 }, mostMissedRule: 'tapSymbol',
    difficulty: 3, livesLeft: 2, recentMutations: ['doubleTap'],
  },
  'last life, struggling': {
    ...base, correct: 4, incorrect: 5, timeouts: 3, accuracy: 0.444, averageReactionMs: 980,
    missedRules: { avoidColor: 3, tapColor: 2 }, mostMissedRule: 'avoidColor', difficulty: 1, livesLeft: 1,
  },
};

console.log(`\nOllama: ${config.ollamaUrl}   model: ${config.model}\n`);

const models = await ollama.listModels().catch((e) => {
  console.error(`  FAIL  Ollama not reachable: ${(e as Error).message}`);
  process.exit(1);
});
check(OllamaService.hasModel(models, config.model), `model "${config.model}" is installed (found: ${models.join(', ')})`);

let t = Date.now();
await ollama.warmUp();
console.log(`        model loaded in ${Date.now() - t} ms\n`);

for (const [name, summary] of Object.entries(profiles)) {
  const allowed = allowedMutationsFor(summary);
  t = Date.now();
  const raw = await ollama.chat(challengePrompt(summary, allowed), {
    schema: challengeJsonSchema(allowed), timeoutMs: 30_000, temperature: 0.8, maxTokens: 200,
  });
  const ms = Date.now() - t;
  const v = validateChallenge(raw, allowed, summary);
  check(v.ok, `next-challenge for ${name}: ${ms} ms${v.ok && !v.value.reasonGrounded ? ' (reason cited an unrecorded number; server would replace it)' : ''}`);
  if (v.ok) {
    console.log(`        -> ${v.value.mutationId} x${v.value.intensity}  "${v.value.instruction}"`);
    console.log(`           reason: ${v.value.reason}`);
    console.log(`           taunt:  ${v.value.taunt}`);
    console.log(`           allowed: ${allowed.join(', ')}`);
  } else {
    console.log(`        rejected (${v.reason}): ${raw.slice(0, 200)}`);
  }
}

const run = { ...profiles['symbol-blind player'], durationSec: 52.4, endReason: 'lives' as const, mutationsSurvived: 1 };
t = Date.now();
const raw = await ollama.chat(analysisPrompt(run), { schema: analysisJsonSchema, timeoutMs: 40_000, temperature: 0.7, maxTokens: 320 });
const a = validateAnalysis(raw, run);
check(a.ok, `run-analysis: ${Date.now() - t} ms, ungrounded fields: ${a.ungrounded.join(', ') || 'none'}`);
if (a.value) for (const [k, v] of Object.entries(a.value)) console.log(`        ${k}: ${v}`);

console.log(failures ? `\n${failures} check(s) failed.\n` : '\nAll live AI checks passed.\n');
process.exit(failures ? 1 : 0);
