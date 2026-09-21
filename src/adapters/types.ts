import type { Message, SupportedAgent } from '../types.js';

export interface NormalizedTranscript {
  /** The standard normalized messages passed to the compaction engine */
  messages: Message[];
  /** Opaque metadata or handles preserved for lossless denormalization */
  metadata?: Record<string, unknown>;
}

export interface AgentAdapter<TInput = unknown, TOutput = unknown> {
  readonly name: SupportedAgent;
  /** Returns true if the provided transcript matches this agent's format */
  detect(input: unknown): boolean;
  /** Normalizes the agent transcript into universal Message[] representation */
  normalize(input: TInput): NormalizedTranscript;
  /** Denormalizes compacted universal Message[] back to native agent transcript */
  denormalize(compacted: Message[], original: TInput): TOutput;
}
