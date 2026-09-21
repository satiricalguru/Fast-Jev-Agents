import type { AntigravityTranscriptStep } from '../adapters/antigravity.js';
import { compactAntigravity } from '../universal.js';
import type { CompactOptions } from '../types.js';

export interface AntigravityCompactionOptions extends CompactOptions {
  apiKey?: string;
  onCompacted?: (stats: { stepsBefore: number; stepsAfter: number; reductionRatio: number }) => void;
}

/**
 * Parses and compacts a JSONL string representing an Antigravity agent transcript.
 */
export async function compactAntigravityJsonl(
  jsonlContent: string,
  options: AntigravityCompactionOptions = {},
): Promise<string> {
  const lines = jsonlContent.trim().split('\n').filter(Boolean);
  const steps: AntigravityTranscriptStep[] = [];

  for (const line of lines) {
    try {
      steps.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  if (steps.length === 0) return jsonlContent;

  const result = await compactAntigravity(steps, options);
  if (options.onCompacted) {
    const charsBefore = result.stats.charsBefore;
    const charsAfter = result.stats.charsAfter;
    const ratio = charsBefore > 0 ? (charsBefore - charsAfter) / charsBefore : 0;
    options.onCompacted({
      stepsBefore: steps.length,
      stepsAfter: result.messages.length,
      reductionRatio: ratio,
    });
  }

  return result.messages.map((step) => JSON.stringify(step)).join('\n') + '\n';
}

/**
 * Helper hook for Antigravity agents to compact steps in-memory.
 */
export async function compactAntigravitySession(
  steps: AntigravityTranscriptStep[],
  options: AntigravityCompactionOptions = {},
): Promise<AntigravityTranscriptStep[]> {
  const result = await compactAntigravity(steps, options);
  return result.messages;
}
