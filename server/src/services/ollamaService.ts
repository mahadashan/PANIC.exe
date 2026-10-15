/**
 * Minimal client for the local Ollama HTTP API. This is the only place the
 * application performs AI inference, and it only ever talks to the
 * configured local Ollama instance.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  /** JSON schema passed to Ollama's structured-output `format`. */
  schema: object;
  timeoutMs: number;
  temperature?: number;
  maxTokens?: number;
}

export interface OllamaLike {
  readonly model: string;
  chat(messages: ChatMessage[], opts: ChatOptions): Promise<string>;
  listModels(): Promise<string[]>;
  loadedModels(): Promise<string[]>;
  warmUp(): Promise<void>;
}

export class OllamaError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'unreachable' | 'http' | 'bad-response',
  ) {
    super(message);
  }
}

const sameModel = (a: string, b: string) =>
  a === b || a === `${b}:latest` || `${a}:latest` === b;

export class OllamaService implements OllamaLike {
  private warming: Promise<void> | null = null;

  constructor(
    private readonly baseUrl: string,
    readonly model: string,
  ) {}

  private async request(path: string, init: RequestInit & { timeoutMs: number }): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(init.timeoutMs),
      });
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new OllamaError(`Ollama did not answer within ${init.timeoutMs} ms`, 'timeout');
      }
      throw new OllamaError(`Cannot reach Ollama at ${this.baseUrl}`, 'unreachable');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new OllamaError(`Ollama HTTP ${res.status}: ${text.slice(0, 200)}`, 'http');
    }
    try {
      return await res.json();
    } catch {
      throw new OllamaError('Ollama returned a non-JSON body', 'bad-response');
    }
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
    const data = (await this.request('/api/chat', {
      method: 'POST',
      timeoutMs: opts.timeoutMs,
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        format: opts.schema,
        keep_alive: '30m',
        options: { temperature: opts.temperature ?? 0.7, num_predict: opts.maxTokens ?? 220 },
      }),
    })) as { message?: { content?: unknown } };
    const content = data?.message?.content;
    if (typeof content !== 'string') throw new OllamaError('Ollama response had no message content', 'bad-response');
    return content;
  }

  async listModels(): Promise<string[]> {
    const data = (await this.request('/api/tags', { method: 'GET', timeoutMs: 2500 })) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    return (data.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean);
  }

  async loadedModels(): Promise<string[]> {
    const data = (await this.request('/api/ps', { method: 'GET', timeoutMs: 2500 })) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    return (data.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean);
  }

  /** Loads the model into memory (no generation) so the first real request is fast. */
  warmUp(): Promise<void> {
    if (!this.warming) {
      this.warming = this.request('/api/generate', {
        method: 'POST',
        timeoutMs: 120_000,
        body: JSON.stringify({ model: this.model, prompt: '', keep_alive: '30m' }),
      })
        .then(() => undefined)
        .finally(() => {
          this.warming = null;
        });
    }
    return this.warming;
  }

  static hasModel(names: string[], model: string) {
    return names.some((n) => sameModel(n, model));
  }
}
