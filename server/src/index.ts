import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config';
import { aiRoutes } from './routes/aiRoutes';
import { OllamaService, type OllamaLike } from './services/ollamaService';

export function createApp(ollama: OllamaLike, opts: { log?: (m: string) => void } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use(
    '/api',
    aiRoutes({
      ollama,
      challengeTimeoutMs: config.challengeTimeoutMs,
      analysisTimeoutMs: config.analysisTimeoutMs,
      log: opts.log,
    }),
  );
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not-found' });
  });

  // Serve the production build when it exists (npm run build && npm start).
  const dist = fileURLToPath(new URL('../../dist', import.meta.url));
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile('index.html', { root: dist }));
  }

  // Malformed JSON bodies etc. never crash the server.
  app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.status === 400 ? 'bad-request' : 'server-error' });
  });
  return app;
}

const norm = (p: string) => resolve(p).toLowerCase();
const isMain = !!process.argv[1] && norm(fileURLToPath(import.meta.url)) === norm(process.argv[1]);
if (isMain) {
  const ollama = new OllamaService(config.ollamaUrl, config.model);
  const app = createApp(ollama);
  app.listen(config.port, () => {
    console.log(`\n  PANIC.exe server   http://localhost:${config.port}`);
    console.log(`  Ollama             ${config.ollamaUrl}  model=${config.model}\n`);
  });

  // Report model availability and pre-load it so the first mutation is fast.
  ollama
    .listModels()
    .then((models) => {
      if (!OllamaService.hasModel(models, config.model)) {
        console.warn(`  [ai] Model "${config.model}" not found in Ollama. Game will use fallback challenges.`);
        console.warn(`       Installed: ${models.join(', ') || 'none'}`);
        return;
      }
      const t = Date.now();
      console.log(`  [ai] ${config.model} found. Loading into memory…`);
      return ollama.warmUp().then(() => console.log(`  [ai] ${config.model} ready (${Date.now() - t} ms)`));
    })
    .catch(() => console.warn(`  [ai] Ollama not reachable at ${config.ollamaUrl}. Game will use fallback challenges.`));
}
