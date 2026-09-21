import { describe, expect, it } from 'vitest';
import { JevClient, MemoryCompactionCache } from '../src/client.js';
import { compact } from '../src/compact.js';
import type { JevAsker, JevQuestions, Message } from '../src/types.js';

describe('decision caching', () => {
  it('skips querying Jev for cached decisions', async () => {
    const cache = new MemoryCompactionCache();
    cache.set('Read:{"file_path":"src/a.ts"}', { keepCall: 0.9, keepResult: 0.9 });

    const messages: Message[] = [
      { role: 'user', text: 'start', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [{ tool_use_id: 't1', tool: 'Read', input: { file_path: 'src/a.ts' } }] },
      { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'code' }] },
      { role: 'assistant', text: 'done', toolUses: [] },
    ];

    let askedCount = 0;
    const fakeAsker: JevAsker = {
      ask: async (_state, questions) => {
        askedCount += Object.keys(questions).length;
        return { answers: {} };
      },
    };

    const result = await compact(messages, fakeAsker, {
      cache,
      preserveRecentMessages: 0,
    });

    expect(result.stats.cacheHits).toBe(1);
    expect(askedCount).toBe(0); // Jev was never called because it was cached!
    expect(result.decisions[0]?.action).toBe('keep');
  });
});

describe('client retry resilience', () => {
  it('retries on transient 500/503 errors and succeeds', async () => {
    let attempts = 0;
    const client = new JevClient({
      apiKey: 'test-key',
      retries: 2,
      fetch: async () => {
        attempts++;
        if (attempts === 1) {
          return new Response('internal error', { status: 500 });
        }
        return new Response(JSON.stringify({ answers: { q: { noul: 0.8 } } }), { status: 200 });
      },
    });

    const response = await client.ask('state', { q: { type: 'noul', instructions: 'keep?' } });
    expect(attempts).toBe(2);
    expect(response.answers.q?.noul).toBe(0.8);
  });
});
