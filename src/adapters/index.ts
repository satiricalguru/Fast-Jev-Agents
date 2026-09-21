import type { SupportedAgent } from '../types.js';
import { AntigravityAdapter } from './antigravity.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { GeminiAdapter } from './gemini.js';
import { OpenCodeAdapter } from './opencode.js';
import type { AgentAdapter } from './types.js';

export * from './types.js';
export * from './claude.js';
export * from './codex.js';
export * from './antigravity.js';
export * from './gemini.js';
export * from './opencode.js';

const adapters: AgentAdapter[] = [
  new AntigravityAdapter(),
  new GeminiAdapter(),
  new CodexAdapter(),
  new ClaudeAdapter(),
  new OpenCodeAdapter(),
];

/**
 * Automatically inspects input messages and detects which coding agent format it is.
 */
export function detectAgentFormat(input: unknown): SupportedAgent {
  for (const adapter of adapters) {
    if (adapter.detect(input)) {
      return adapter.name;
    }
  }
  return 'universal';
}

/**
 * Retrieves the adapter corresponding to the specified agent name.
 */
export function getAdapter(agent: SupportedAgent): AgentAdapter | undefined {
  return adapters.find((a) => a.name === agent);
}
