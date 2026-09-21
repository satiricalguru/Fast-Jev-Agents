import type { OpenAIChatMessage } from '../adapters/codex.js';
import { compactCodex } from '../universal.js';
import type { CompactOptions } from '../types.js';

export interface CodexCompactionOptions extends CompactOptions {
  /** Maximum number of messages or estimated characters before triggering auto-compaction */
  autoCompactThresholdChars?: number;
  apiKey?: string;
  onCompacted?: (stats: { messagesBefore: number; messagesAfter: number; charsSavedRatio: number }) => void;
}

/**
 * Helper to compact an OpenAI / Codex Chat Completions messages array before sending to the model.
 */
export async function compactCodexMessages(
  messages: OpenAIChatMessage[],
  options: CodexCompactionOptions = {},
): Promise<OpenAIChatMessage[]> {
  const threshold = options.autoCompactThresholdChars ?? 50_000;
  const currentChars = JSON.stringify(messages).length;

  if (currentChars < threshold) {
    return messages;
  }

  const result = await compactCodex(messages, options);
  if (options.onCompacted) {
    const charsBefore = result.stats.charsBefore;
    const charsAfter = result.stats.charsAfter;
    const ratio = charsBefore > 0 ? (charsBefore - charsAfter) / charsBefore : 0;
    options.onCompacted({
      messagesBefore: result.stats.messagesBefore,
      messagesAfter: result.stats.messagesAfter,
      charsSavedRatio: ratio,
    });
  }

  return result.messages;
}

/**
 * Creates an OpenAI client wrapper that automatically intercepts and compacts
 * `chat.completions.create` messages.
 */
export function withCodexCompaction<T extends { chat: { completions: { create: (...args: any[]) => Promise<any> } } }>(
  client: T,
  options: CodexCompactionOptions = {},
): T {
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);

  client.chat.completions.create = async (params: { messages: OpenAIChatMessage[]; [key: string]: unknown }, ...rest: any[]) => {
    if (params && Array.isArray(params.messages)) {
      params.messages = await compactCodexMessages(params.messages, options);
    }
    return originalCreate(params, ...rest);
  };

  return client;
}
