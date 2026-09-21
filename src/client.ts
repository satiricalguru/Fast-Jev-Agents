import { buildJevRequest, parseJevResponse } from './request.js';
import type { CallAnswer, CompactionCache, JevAsker, JevQuestions, JevResponse, JevState } from './types.js';

export interface JevClientOptions {
  /** Defaults to `process.env.TYPESAFE_API_KEY`. */
  apiKey?: string;
  /** Defaults to `jev-latest`. */
  model?: string;
  /** Defaults to the System One endpoint. */
  baseUrl?: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Max retries for transient 429/5xx errors or network drops. Default 2. */
  retries?: number;
  /** Timeout per request in milliseconds. Default 30,000ms. */
  timeoutMs?: number;
}

/**
 * In-memory LRU/map cache for compaction decisions across turns.
 */
export class MemoryCompactionCache implements CompactionCache {
  private readonly store = new Map<string, CallAnswer>();
  private readonly maxEntries: number;

  constructor(maxEntries: number = 2000) {
    this.maxEntries = maxEntries;
  }

  get(key: string): CallAnswer | undefined {
    return this.store.get(key);
  }

  set(key: string, answer: CallAnswer): void {
    if (this.store.size >= this.maxEntries) {
      const first = this.store.keys().next().value;
      if (first !== undefined) this.store.delete(first);
    }
    this.store.set(key, answer);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/** Asks Jev over HTTP with the global `fetch` (or an injected one) with retries, timeout, and resilience. */
export class JevClient implements JevAsker {
  private readonly apiKey: string;
  private readonly model: string | undefined;
  private readonly baseUrl: string | undefined;
  private readonly fetcher: typeof fetch;
  private readonly retries: number;
  private readonly timeoutMs: number;

  constructor(options: JevClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY ?? '';
    this.model = options.model;
    this.baseUrl = options.baseUrl;
    this.fetcher = options.fetch ?? fetch;
    this.retries = Math.max(0, options.retries ?? 2);
    this.timeoutMs = Math.max(100, options.timeoutMs ?? 30_000);
  }

  async ask(state: JevState, questions: JevQuestions): Promise<JevResponse> {
    if (!this.apiKey) throw new Error('TYPESAFE_API_KEY is not configured');
    const request = buildJevRequest(
      { apiKey: this.apiKey, model: this.model, baseUrl: this.baseUrl },
      state,
      questions,
    );

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;

      try {
        if (controller) {
          timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        }

        const response = await this.fetcher(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal: controller?.signal,
        });

        // If rate-limited or server error and we have retries left, wait and retry
        if ((response.status === 429 || response.status >= 500) && attempt < this.retries) {
          const delay = Math.min(2000, 200 * Math.pow(2, attempt) + Math.random() * 100);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        return parseJevResponse(response.status, response.ok, await response.text());
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.retries) {
          const delay = Math.min(2000, 200 * Math.pow(2, attempt) + Math.random() * 100);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    }

    throw lastError ?? new Error('Jev request failed');
  }
}
