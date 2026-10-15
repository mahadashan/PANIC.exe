// Optional .env support without extra dependencies (Node >= 20.12).
try {
  process.loadEnvFile();
} catch {
  /* no .env file: defaults apply */
}

const int = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  port: int(process.env.PORT, 8787),
  ollamaUrl: (process.env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/$/, ''),
  model: process.env.OLLAMA_MODEL ?? 'gemma3:4b',
  challengeTimeoutMs: int(process.env.AI_CHALLENGE_TIMEOUT_MS, 12_000),
  analysisTimeoutMs: int(process.env.AI_ANALYSIS_TIMEOUT_MS, 25_000),
};
