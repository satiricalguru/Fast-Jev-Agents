import type { OpenCodeEvent } from '../adapters/opencode.js';
import { compactOpenCode } from '../universal.js';
import type { CompactOptions } from '../types.js';

export interface OpenCodeCompactionOptions extends CompactOptions {
  apiKey?: string;
  onCompacted?: (stats: { eventsBefore: number; eventsAfter: number; reductionRatio: number }) => void;
}

/**
 * Compacts an OpenCode event list.
 */
export async function compactOpenCodeSession(
  events: OpenCodeEvent[],
  options: OpenCodeCompactionOptions = {},
): Promise<OpenCodeEvent[]> {
  const result = await compactOpenCode(events, options);
  if (options.onCompacted) {
    const charsBefore = result.stats.charsBefore;
    const charsAfter = result.stats.charsAfter;
    const ratio = charsBefore > 0 ? (charsBefore - charsAfter) / charsBefore : 0;
    options.onCompacted({
      eventsBefore: events.length,
      eventsAfter: result.messages.length,
      reductionRatio: ratio,
    });
  }

  return result.messages;
}
