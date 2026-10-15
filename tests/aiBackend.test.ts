import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../server/src/index';
import { OllamaError, type ChatMessage, type OllamaLike } from '../server/src/services/ollamaService';
import { validateChallenge } from '../server/src/schemas/challengeSchema';
import {
  allowedMutationsFor,
  fallbackChallenge,
  MUTATION_IDS,
  MUTATIONS,
  type MutationId,
  type PerformanceSummary,
  type RunSummary,
} from '../shared/challenges';

const summary: PerformanceSummary = {
  roundsPlayed: 9,
  correct: 7,
  incorrect: 2,
  timeouts: 1,
  accuracy: 0.778,
  averageReactionMs: 612,
  recentAverageReactionMs: 540,
  recentTrend: 'improving',
  missedRules: { tapSymbol: 2 },
  seenRules: { tapSymbol: 4, tapColor: 5 },
  mostMissedRule: 'tapSymbol',
  mostSelectedWrongTarget: { color: 'red', symbol: 'circle', count: 1 },
  currentCombo: 3,
  bestCombo: 5,
  recentMutations: ['doubleTap'],
  difficulty: 3,
  livesLeft: 2,
  score: 1450,
};

const run: RunSummary = { ...summary, durationSec: 48.2, endReason: 'lives', mutationsSurvived: 1 };

/** Scriptable stand-in for Ollama so every failure mode can be exercised. */
class FakeOllama implements OllamaLike {
  model = 'gemma3:4b';
  next: () => Promise<string> = async () => '{}';
  lastMessages: ChatMessage[] = [];
  lastSchema: { properties: { mutationId: { enum: MutationId[] } } } | null = null;
  models = ['gemma3:4b'];
  async chat(messages: ChatMessage[], opts: { schema: object }) {
    this.lastMessages = messages;
    this.lastSchema = opts.schema as never;
    return this.next();
  }
  async listModels() {
    return this.models;
  }
  async loadedModels() {
    return this.models;
  }
  async warmUp() {}
}

const fake = new FakeOllama();
let server: Server;
let base = '';

beforeAll(async () => {
  server = createApp(fake, { log: () => {} }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => {
  server.close();
});

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const allowed = allowedMutationsFor(summary);
const modelSays = (obj: unknown) => {
  fake.next = async () => (typeof obj === 'string' ? obj : JSON.stringify(obj));
};

describe('POST /api/ai/next-challenge', () => {
  it('turns a valid model response into an AI challenge', async () => {
    modelSays({
      mutationId: 'symbolOverride',
      reason: 'Missed 2 of 4 symbol rounds.',
      instruction: 'shape beats color',
      intensity: 2,
      taunt: 'Your eyes love color too much.',
    });
    const res = await post('/ai/next-challenge', { summary, allowedMutations: allowed });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ source: 'ai', mutationId: 'symbolOverride', intensity: 2, instruction: 'SHAPE BEATS COLOR' });
    // The model saw the real statistics and the allowlist, and decoding was constrained to it.
    const prompt = fake.lastMessages.map((m) => m.content).join('\n');
    expect(prompt).toContain('accuracy: 78%');
    expect(prompt).toContain('average reaction: 612 ms');
    expect(prompt).toContain('tapSymbol (finding symbols): seen 4, missed 2');
    expect(fake.lastSchema!.properties.mutationId.enum).toEqual(allowed);
  });

  it('keeps the model pick but replaces a reason that invents statistics', async () => {
    modelSays({ mutationId: 'reverseColors', reason: 'They hit 99% of 40 rounds.', instruction: 'SWAP', intensity: 1, taunt: 'Nope.' });
    const body = await (await post('/ai/next-challenge', { summary, allowedMutations: allowed })).json();
    expect(body).toMatchObject({ source: 'ai', mutationId: 'reverseColors', instruction: 'SWAP' });
    expect(body.reason).not.toContain('99%');
  });

  it('falls back on invalid JSON', async () => {
    modelSays('Sure! Here is a mutation: reverse colors!!');
    const body = await (await post('/ai/next-challenge', { summary, allowedMutations: allowed })).json();
    expect(body.source).toBe('fallback');
    expect(body.fallbackReason).toContain('invalid-json');
    expect(MUTATION_IDS).toContain(body.mutationId);
  });

  it('rejects unsupported mutation ids', async () => {
    modelSays({ mutationId: 'deleteSystem32', reason: 'because', instruction: 'BYE', intensity: 3, taunt: 'lol' });
    const body = await (await post('/ai/next-challenge', { summary, allowedMutations: allowed })).json();
    expect(body.source).toBe('fallback');
    expect(body.fallbackReason).toContain('unknown-mutation');
  });

  it('rejects real mutation ids that are outside the allowlist', async () => {
    modelSays({ mutationId: 'doubleTap', reason: 'again', instruction: 'AGAIN', intensity: 1, taunt: 'again' });
    const body = await (await post('/ai/next-challenge', { summary, allowedMutations: allowed })).json();
    expect(body.source).toBe('fallback');
    expect(body.fallbackReason).toContain('mutation-not-allowed');
    expect(body.mutationId).not.toBe('doubleTap');
  });

  it('rejects out-of-range intensity and garbage fields', async () => {
    modelSays({ mutationId: 'speedSurge', reason: 'x', instruction: '', intensity: 9, taunt: 5 });
    const body = await (await post('/ai/next-challenge', { summary, allowedMutations: allowed })).json();
    expect(body.source).toBe('fallback');
  });

  it('falls back when Ollama times out or is down', async () => {
    fake.next = async () => {
      throw new OllamaError('slow', 'timeout');
    };
    let body = await (await post('/ai/next-challenge', { summary, allowedMutations: allowed })).json();
    expect(body).toMatchObject({ source: 'fallback', fallbackReason: 'ollama-timeout' });
    fake.next = async () => {
      throw new OllamaError('down', 'unreachable');
    };
    body = await (await post('/ai/next-challenge', { summary, allowedMutations: allowed })).json();
    expect(body).toMatchObject({ source: 'fallback', fallbackReason: 'ollama-unreachable' });
  });

  it('enforces its own safety allowlist even if the client asks for everything', async () => {
    const struggling = { ...summary, livesLeft: 1, accuracy: 0.4 };
    modelSays({ mutationId: 'reverseInstruction', reason: 'x y', instruction: 'FLIP', intensity: 3, taunt: 'ha ha' });
    const body = await (await post('/ai/next-challenge', { summary: struggling, allowedMutations: [...MUTATION_IDS] })).json();
    expect(fake.lastSchema!.properties.mutationId.enum.every((id) => MUTATIONS[id].tier === 1)).toBe(true);
    expect(body.source).toBe('fallback');
    expect(MUTATIONS[body.mutationId as MutationId].tier).toBe(1);
  });

  it('rejects malformed requests with 400', async () => {
    expect((await post('/ai/next-challenge', { summary: { hello: 1 }, allowedMutations: [] })).status).toBe(400);
    expect((await post('/ai/next-challenge', { summary, allowedMutations: ['notAMutation'] })).status).toBe(400);
    const bad = await fetch(base + '/ai/next-challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{oops',
    });
    expect(bad.status).toBe(400);
  });
});

describe('POST /api/ai/run-analysis', () => {
  const good = {
    strongestSkill: 'Color taps: you cleared 5 of 5.',
    frequentMistake: 'Symbols tripped you up 2 times.',
    observation: 'You averaged 612 ms at 78% accuracy.',
    taunt: 'Shapes are hard, apparently.',
    improvement: 'Look at the shape before the color.',
  };

  it('returns AI analysis grounded in the recorded statistics', async () => {
    modelSays(good);
    const body = await (await post('/ai/run-analysis', run)).json();
    expect(body.source).toBe('ai');
    expect(body.observation).toBe(good.observation);
    const prompt = fake.lastMessages.map((m) => m.content).join('\n');
    expect(prompt).toContain('final score: 1450');
    expect(prompt).toContain('run length: 48.2 seconds');
  });

  it('replaces fields that invent statistics', async () => {
    modelSays({ ...good, observation: 'You hit 97% accuracy with a 233 ms average.' });
    const body = await (await post('/ai/run-analysis', run)).json();
    expect(body.source).toBe('mixed');
    expect(body.observation).not.toContain('97%');
    expect(body.taunt).toBe(good.taunt);
  });

  it('falls back on invalid output or a dead model', async () => {
    modelSays('not json at all');
    expect((await (await post('/ai/run-analysis', run)).json()).source).toBe('fallback');
    fake.next = async () => {
      throw new OllamaError('down', 'unreachable');
    };
    const body = await (await post('/ai/run-analysis', run)).json();
    expect(body.source).toBe('fallback');
    expect(body.observation).toContain('612 ms');
  });

  it('rejects malformed run summaries', async () => {
    expect((await post('/ai/run-analysis', { score: 'lots' })).status).toBe(400);
  });
});

describe('GET /api/health', () => {
  it('reports model availability without generating', async () => {
    fake.models = ['gemma3:4b', 'other:1b'];
    let body = await (await fetch(base + '/health')).json();
    expect(body.ollama).toMatchObject({ reachable: true, modelAvailable: true, model: 'gemma3:4b' });
    fake.models = ['llama3:8b'];
    body = await (await fetch(base + '/health')).json();
    expect(body.ollama.modelAvailable).toBe(false);
    fake.models = ['gemma3:4b'];
  });
});

describe('validation helpers', () => {
  it('rewrites internal rule ids into plain English', () => {
    const v = validateChallenge(
      JSON.stringify({ mutationId: 'speedSurge', reason: "Their 'avoidColor' misses and slow speedSurges.", instruction: 'go', intensity: 1, taunt: 'nice tapColor' }),
      ['speedSurge'],
    );
    expect(v.ok && v.value.reason).toBe('Their avoiding a color misses and slow speed surges.');
    expect(v.ok && v.value.taunt).toBe('nice tapping the named color');
  });

  it('tolerates code fences around JSON', () => {
    const v = validateChallenge(
      '```json\n{"mutationId":"speedSurge","reason":"fast hands","instruction":"go","intensity":1,"taunt":"zoom zoom"}\n```',
      ['speedSurge'],
    );
    expect(v.ok).toBe(true);
  });

  it('fallback selection is deterministic and targets the weakness', () => {
    const a = fallbackChallenge(summary, allowed);
    const b = fallbackChallenge(summary, allowed);
    expect(a).toEqual(b);
    expect(a.mutationId).toBe('symbolOverride');
  });
});
