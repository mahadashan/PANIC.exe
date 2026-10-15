import { Router } from 'express';
import {
  allowedMutationsFor,
  fallbackAnalysis,
  fallbackChallenge,
  nextChallengeRequestSchema,
  runSummarySchema,
  type ChallengeRecommendation,
  type RunAnalysis,
} from '../../../shared/challenges';
import { validateAnalysis, validateChallenge } from '../schemas/challengeSchema';
import { OllamaError, OllamaService, type OllamaLike } from '../services/ollamaService';
import { analysisJsonSchema, analysisPrompt, challengeJsonSchema, challengePrompt } from '../services/prompts';

export interface AiRouteOptions {
  ollama: OllamaLike;
  challengeTimeoutMs: number;
  analysisTimeoutMs: number;
  log?: (msg: string) => void;
}

const describe = (err: unknown) =>
  err instanceof OllamaError ? `ollama-${err.kind}` : err instanceof Error ? err.message : 'unknown-error';

export function aiRoutes({ ollama, challengeTimeoutMs, analysisTimeoutMs, log = console.log }: AiRouteOptions) {
  const router = Router();

  router.get('/health', async (_req, res) => {
    let reachable = false;
    let modelAvailable = false;
    let warm = false;
    try {
      const models = await ollama.listModels();
      reachable = true;
      modelAvailable = OllamaService.hasModel(models, ollama.model);
      warm = OllamaService.hasModel(await ollama.loadedModels(), ollama.model);
    } catch {
      /* reported as unreachable */
    }
    res.json({ ok: true, ollama: { reachable, model: ollama.model, modelAvailable, warm } });
  });

  router.post('/ai/warmup', (_req, res) => {
    ollama.warmUp().catch((err) => log(`[ai] warm-up failed: ${describe(err)}`));
    res.status(202).json({ ok: true });
  });

  router.post('/ai/next-challenge', async (req, res) => {
    const parsed = nextChallengeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-summary', issues: parsed.error.issues.slice(0, 5) });
      return;
    }
    const { summary, allowedMutations } = parsed.data;
    // The server enforces its own allowlist regardless of what the client asked for.
    const serverAllowed = allowedMutationsFor(summary);
    const intersect = allowedMutations.filter((id) => serverAllowed.includes(id));
    const allowed = intersect.length ? intersect : serverAllowed;

    const started = Date.now();
    let result: ChallengeRecommendation;
    try {
      const raw = await ollama.chat(challengePrompt(summary, allowed), {
        schema: challengeJsonSchema(allowed),
        timeoutMs: challengeTimeoutMs,
        temperature: 0.8,
        maxTokens: 200,
      });
      const v = validateChallenge(raw, allowed, summary);
      if (v.ok) {
        const { reasonGrounded, ...rec } = v.value;
        result = { ...rec, source: 'ai' };
        if (!reasonGrounded) {
          // Keep the model's choice, but never show the player a statistic it made up.
          result.reason = fallbackChallenge(summary, [rec.mutationId]).reason;
          log(`[ai] replaced ungrounded reason: ${rec.reason}`);
        }
      } else {
        result = fallbackChallenge(summary, allowed, `rejected-model-output: ${v.reason}`);
      }
      if (!v.ok) log(`[ai] rejected model output (${v.reason}): ${raw.slice(0, 160)}`);
    } catch (err) {
      result = fallbackChallenge(summary, allowed, describe(err));
    }
    result.latencyMs = Date.now() - started;
    log(
      `[ai] next-challenge ${result.source.toUpperCase()} ${result.latencyMs}ms -> ${result.mutationId} x${result.intensity}` +
        (result.source === 'ai' ? ` | "${result.instruction}" | ${result.reason}` : ` (${result.fallbackReason})`),
    );
    res.json(result);
  });

  router.post('/ai/run-analysis', async (req, res) => {
    const parsed = runSummarySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-run-summary', issues: parsed.error.issues.slice(0, 5) });
      return;
    }
    const run = parsed.data;
    const fallback = fallbackAnalysis(run);
    const started = Date.now();
    let result: RunAnalysis;
    try {
      const raw = await ollama.chat(analysisPrompt(run), {
        schema: analysisJsonSchema,
        timeoutMs: analysisTimeoutMs,
        temperature: 0.7,
        maxTokens: 320,
      });
      const v = validateAnalysis(raw, run);
      if (!v.ok || !v.value) {
        log(`[ai] rejected analysis (${v.reason}): ${raw.slice(0, 160)}`);
        result = { ...fallback, fallbackReason: `rejected-model-output: ${v.reason}` };
      } else if (v.ungrounded.length === 5) {
        result = { ...fallback, fallbackReason: 'ungrounded-numbers' };
      } else {
        // Any field that cites numbers not in the recorded stats is replaced with the verified version.
        const merged = { ...v.value };
        for (const key of v.ungrounded) merged[key] = fallback[key];
        if (v.ungrounded.length) log(`[ai] replaced ungrounded analysis fields: ${v.ungrounded.join(', ')}`);
        result = { ...merged, source: v.ungrounded.length ? 'mixed' : 'ai' };
      }
    } catch (err) {
      result = { ...fallback, fallbackReason: describe(err) };
    }
    result.latencyMs = Date.now() - started;
    log(`[ai] run-analysis ${result.source.toUpperCase()} ${result.latencyMs}ms${result.fallbackReason ? ` (${result.fallbackReason})` : ''}`);
    res.json(result);
  });

  return router;
}
