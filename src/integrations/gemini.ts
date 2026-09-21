import type { GeminiContent } from '../adapters/gemini.js';
import { compactGemini } from '../universal.js';
import type { CompactOptions } from '../types.js';

export interface GeminiCompactionOptions extends CompactOptions {
  apiKey?: string;
  autoCompactThresholdChars?: number;
  onCompacted?: (stats: { messagesBefore: number; messagesAfter: number; charsSavedRatio: number }) => void;
}

/**
 * Compacts a Gemini chat session history or Content[] list.
 */
export async function compactGeminiHistory(
  history: GeminiContent[],
  options: GeminiCompactionOptions = {},
): Promise<GeminiContent[]> {
  const threshold = options.autoCompactThresholdChars ?? 50_000;
  const currentChars = JSON.stringify(history).length;

  if (currentChars < threshold) {
    return history;
  }

  const result = await compactGemini(history, options);
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
 * Wraps a Gemini ChatSession object to automatically compact its history when needed.
 */
export function withGeminiCompaction<T extends { getHistory: () => Promise<GeminiContent[]> | GeminiContent[] }>(
  chatSession: T,
  options: GeminiCompactionOptions = {},
): T {
  const originalGetHistory = chatSession.getHistory.bind(chatSession);

  chatSession.getHistory = async () => {
    const history = await originalGetHistory();
    return compactGeminiHistory(history, options);
  };

  return chatSession;
}
