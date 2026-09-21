import {
  ClaudeAdapter,
  CodexAdapter,
  AntigravityAdapter,
  GeminiAdapter,
  OpenCodeAdapter,
  detectAgentFormat,
  getAdapter,
  type ClaudeInput,
  type OpenAIChatMessage,
  type AntigravityTranscriptStep,
  type GeminiContent,
  type OpenCodeEvent,
} from './adapters/index.js';
import { compactMessages, type CompactMessagesOptions } from './messages.js';
import type { CallDecision, CompactResult, Message, SupportedAgent } from './types.js';

export interface CompactAgentOptions extends CompactMessagesOptions {
  /**
   * The agent format to compact. Defaults to 'auto' (automatically detected).
   */
  agent?: SupportedAgent | 'auto';
}

export interface CompactAgentResult<T = unknown> {
  /** The compacted transcript in the native agent format */
  messages: T;
  /** Individual call decisions */
  decisions: CallDecision[];
  /** Detailed compaction metrics */
  stats: CompactResult['stats'];
  /** The detected or specified agent format */
  agent: SupportedAgent;
}

/**
 * Universal verbatim context compaction for any coding agent:
 * Claude, Codex, Antigravity, Gemini, or OpenCode.
 *
 * Automatically detects the input format, normalizes, runs fast Jev compaction,
 * and denormalizes back into the agent's native format.
 */
export async function compactAgent<T = unknown>(
  transcript: T,
  options: CompactAgentOptions = {},
): Promise<CompactAgentResult<T>> {
  const detected =
    options.agent && options.agent !== 'auto'
      ? options.agent
      : detectAgentFormat(transcript);

  const adapter = getAdapter(detected);

  if (!adapter || detected === 'universal') {
    const rawResult = await compactMessages(transcript as unknown as Message[], options);
    return {
      messages: rawResult.messages as unknown as T,
      decisions: rawResult.decisions,
      stats: rawResult.stats,
      agent: 'universal',
    };
  }

  const { messages: normalizedMessages } = adapter.normalize(transcript);
  const result = await compactMessages(normalizedMessages, options);
  const denormalized = adapter.denormalize(result.messages, transcript);

  return {
    messages: denormalized as T,
    decisions: result.decisions,
    stats: result.stats,
    agent: detected,
  };
}

/** Explicit helper for Claude Code or Anthropic API transcripts */
export async function compactClaude<T extends ClaudeInput>(
  transcript: T,
  options: CompactMessagesOptions = {},
): Promise<CompactAgentResult<T>> {
  const adapter = new ClaudeAdapter();
  const { messages: normalized } = adapter.normalize(transcript);
  const result = await compactMessages(normalized, options);
  return {
    messages: adapter.denormalize(result.messages, transcript) as T,
    decisions: result.decisions,
    stats: result.stats,
    agent: 'claude',
  };
}

/** Explicit helper for OpenAI / Codex Chat Completions transcripts */
export async function compactCodex(
  transcript: OpenAIChatMessage[],
  options: CompactMessagesOptions = {},
): Promise<CompactAgentResult<OpenAIChatMessage[]>> {
  const adapter = new CodexAdapter();
  const { messages: normalized } = adapter.normalize(transcript);
  const result = await compactMessages(normalized, options);
  return {
    messages: adapter.denormalize(result.messages, transcript),
    decisions: result.decisions,
    stats: result.stats,
    agent: 'codex',
  };
}

/** Explicit helper for Google Antigravity transcripts and AGY sessions */
export async function compactAntigravity(
  transcript: AntigravityTranscriptStep[],
  options: CompactMessagesOptions = {},
): Promise<CompactAgentResult<AntigravityTranscriptStep[]>> {
  const adapter = new AntigravityAdapter();
  const { messages: normalized } = adapter.normalize(transcript);
  const result = await compactMessages(normalized, options);
  return {
    messages: adapter.denormalize(result.messages, transcript),
    decisions: result.decisions,
    stats: result.stats,
    agent: 'antigravity',
  };
}

/** Explicit helper for Google Gen AI / Gemini SDK Content[] transcripts */
export async function compactGemini(
  transcript: GeminiContent[],
  options: CompactMessagesOptions = {},
): Promise<CompactAgentResult<GeminiContent[]>> {
  const adapter = new GeminiAdapter();
  const { messages: normalized } = adapter.normalize(transcript);
  const result = await compactMessages(normalized, options);
  return {
    messages: adapter.denormalize(result.messages, transcript),
    decisions: result.decisions,
    stats: result.stats,
    agent: 'gemini',
  };
}

/** Explicit helper for OpenCode event transcripts */
export async function compactOpenCode(
  transcript: OpenCodeEvent[],
  options: CompactMessagesOptions = {},
): Promise<CompactAgentResult<OpenCodeEvent[]>> {
  const adapter = new OpenCodeAdapter();
  const { messages: normalized } = adapter.normalize(transcript);
  const result = await compactMessages(normalized, options);
  return {
    messages: adapter.denormalize(result.messages, transcript),
    decisions: result.decisions,
    stats: result.stats,
    agent: 'opencode',
  };
}
