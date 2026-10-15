/**
 * Talks to the local Express backend (which talks to Ollama). Every response
 * is re-validated here, and every call has a hard timeout. Callers never
 * await these inside the input path: the engine caches results.
 */
import {
  analysisResponseSchema,
  challengeResponseSchema,
  type ChallengeRecommendation,
  type MutationId,
  type PerformanceSummary,
  type RunAnalysis,
  type RunSummary,
} from '../../../shared/challenges';
import type { AiPort } from '../game/gameEngine';

const CHALLENGE_TIMEOUT_MS = 15_000;
const ANALYSIS_TIMEOUT_MS = 30_000;

async function postJson(path: string, body: unknown, signal: AbortSignal, timeoutMs: number): Promise<unknown> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function createAiPort(): AiPort {
  return {
    async requestChallenge(summary: PerformanceSummary, allowed: MutationId[], signal: AbortSignal) {
      const raw = await postJson(
        '/api/ai/next-challenge',
        { summary, allowedMutations: allowed },
        signal,
        CHALLENGE_TIMEOUT_MS,
      );
      const rec = challengeResponseSchema.parse(raw) as ChallengeRecommendation;
      if (!allowed.includes(rec.mutationId)) throw new Error('Server returned a mutation outside the allowlist');
      return rec;
    },
    async requestAnalysis(run: RunSummary, signal: AbortSignal) {
      const raw = await postJson('/api/ai/run-analysis', run, signal, ANALYSIS_TIMEOUT_MS);
      return analysisResponseSchema.parse(raw) as RunAnalysis;
    },
  };
}

export interface HealthStatus {
  server: boolean;
  ollama: boolean;
  modelAvailable: boolean;
  model: string;
  warm: boolean;
}

export async function fetchHealth(): Promise<HealthStatus> {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as {
      ollama?: { reachable?: boolean; modelAvailable?: boolean; model?: string; warm?: boolean };
    };
    return {
      server: true,
      ollama: !!data.ollama?.reachable,
      modelAvailable: !!data.ollama?.modelAvailable,
      model: data.ollama?.model ?? 'gemma3:4b',
      warm: !!data.ollama?.warm,
    };
  } catch {
    return { server: false, ollama: false, modelAvailable: false, model: 'gemma3:4b', warm: false };
  }
}

/** Ask the backend to load the model into memory so the first mutation is fast. */
export function warmUp(): void {
  fetch('/api/ai/warmup', { method: 'POST', signal: AbortSignal.timeout(60_000) }).catch(() => {});
}
