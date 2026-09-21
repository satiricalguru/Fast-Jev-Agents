import type { Message, ToolResult, ToolUse } from '../types.js';
import type { AgentAdapter, NormalizedTranscript } from './types.js';

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
  [key: string]: unknown;
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function';
  content?: string | null | Array<{ type: string; text?: string; [key: string]: unknown }>;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  [key: string]: unknown;
}

export class CodexAdapter implements AgentAdapter<OpenAIChatMessage[], OpenAIChatMessage[]> {
  readonly name = 'codex';

  detect(input: unknown): boolean {
    if (!Array.isArray(input) || input.length === 0) return false;
    const first = input[0];
    if (!first || typeof first !== 'object') return false;

    // Check for OpenAI specific fields: role in system/user/assistant/tool
    if (!('role' in first)) return false;
    const roles = new Set(['system', 'user', 'assistant', 'tool', 'function']);
    if (!roles.has(first.role)) return false;

    // Does any message have tool_calls or role === 'tool' or tool_call_id?
    return input.some(
      (m: unknown) =>
        typeof m === 'object' &&
        m !== null &&
        (('tool_calls' in m && Array.isArray((m as Record<string, unknown>).tool_calls)) ||
          ('role' in m && (m as Record<string, unknown>).role === 'tool') ||
          'tool_call_id' in m),
    );
  }

  normalize(input: OpenAIChatMessage[]): NormalizedTranscript {
    const normalized: Message[] = [];
    const toolResultsById = new Map<string, ToolResult>();

    // First pass: index tool results
    for (const msg of input) {
      if (msg.role === 'tool' && msg.tool_call_id) {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
        toolResultsById.set(msg.tool_call_id, {
          tool_use_id: msg.tool_call_id,
          text,
        });
      }
    }

    for (const msg of input) {
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
          ? msg.content
              .filter((c) => c.type === 'text')
              .map((c) => c.text ?? '')
              .join('\n')
          : '';

      if (msg.role === 'assistant') {
        const toolUses: ToolUse[] = [];
        for (const tc of msg.tool_calls ?? []) {
          let inputObj: Record<string, unknown> = {};
          try {
            inputObj = JSON.parse(tc.function.arguments);
          } catch {
            inputObj = { raw: tc.function.arguments };
          }
          toolUses.push({
            tool_use_id: tc.id,
            tool: tc.function.name,
            input: inputObj,
          });
        }
        normalized.push({
          role: 'assistant',
          text,
          toolUses,
        });
      } else if (msg.role === 'tool' && msg.tool_call_id) {
        const res = toolResultsById.get(msg.tool_call_id);
        normalized.push({
          role: 'user',
          text: '',
          toolUses: [],
          toolResults: res ? [res] : [],
        });
      } else {
        // System or User message
        normalized.push({
          role: 'user',
          text: msg.role === 'system' ? `[System Message]: ${text}` : text,
          toolUses: [],
        });
      }
    }

    return { messages: normalized };
  }

  denormalize(compacted: Message[], original: OpenAIChatMessage[]): OpenAIChatMessage[] {
    const activeToolUseIds = new Set<string>();
    const activeToolResultTexts = new Map<string, string>();

    for (const m of compacted) {
      for (const tu of m.toolUses) activeToolUseIds.add(tu.tool_use_id);
      for (const tr of m.toolResults ?? []) {
        activeToolResultTexts.set(tr.tool_use_id, tr.text);
      }
    }

    const result: OpenAIChatMessage[] = [];

    for (const msg of original) {
      if (msg.role === 'tool' && msg.tool_call_id) {
        const updatedText = activeToolResultTexts.get(msg.tool_call_id);
        if (updatedText === undefined) {
          // Tool result dropped entirely
          continue;
        }
        const currentText =
          typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
        if (updatedText === currentText) {
          result.push(msg);
        } else {
          result.push({
            ...msg,
            content: updatedText,
          });
        }
        continue;
      }

      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const keptToolCalls = msg.tool_calls.filter((tc) => activeToolUseIds.has(tc.id));
        if (keptToolCalls.length === 0 && (!msg.content || msg.content === '')) {
          // Assistant turn completely dropped
          continue;
        }
        if (keptToolCalls.length === msg.tool_calls.length) {
          result.push(msg);
        } else {
          result.push({
            ...msg,
            tool_calls: keptToolCalls.length > 0 ? keptToolCalls : undefined,
          });
        }
        continue;
      }

      result.push(msg);
    }

    return result;
  }
}
