import type { Message, ToolResult, ToolUse } from '../types.js';
import type { AgentAdapter, NormalizedTranscript } from './types.js';

export interface AnthropicContentBlockText {
  type: 'text';
  text: string;
  [key: string]: unknown;
}

export interface AnthropicContentBlockToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AnthropicContentBlockToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<{ type: 'text'; text: string }>;
  is_error?: boolean;
  [key: string]: unknown;
}

export type AnthropicContentBlock =
  | AnthropicContentBlockText
  | AnthropicContentBlockToolUse
  | AnthropicContentBlockToolResult
  | { type: string; [key: string]: unknown };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
  [key: string]: unknown;
}

export interface ClaudeSessionMessage extends Message {
  handle?: string;
  [key: string]: unknown;
}

export type ClaudeInput = ClaudeSessionMessage[] | AnthropicMessage[];

export class ClaudeAdapter implements AgentAdapter<ClaudeInput, ClaudeInput> {
  readonly name = 'claude';

  detect(input: unknown): boolean {
    if (!Array.isArray(input) || input.length === 0) return false;
    const first = input[0];
    if (!first || typeof first !== 'object') return false;

    // Claude Code SessionMessage shape
    if ('role' in first && ('toolUses' in first || 'toolResults' in first)) {
      return true;
    }

    // Anthropic API Messages shape
    if ('role' in first && ('user' === first.role || 'assistant' === first.role)) {
      if (Array.isArray(first.content)) {
        return first.content.some(
          (b: unknown) =>
            typeof b === 'object' &&
            b !== null &&
            'type' in b &&
            (b.type === 'tool_use' || b.type === 'tool_result' || b.type === 'text'),
        );
      }
    }

    return false;
  }

  normalize(input: ClaudeInput): NormalizedTranscript {
    if (input.length === 0) return { messages: [] };
    const first = input[0]!;

    // Case A: Claude Code SessionMessage[]
    if ('toolUses' in first) {
      const sessionMessages = input as ClaudeSessionMessage[];
      return {
        messages: sessionMessages.map((m) => ({
          role: m.role,
          text: m.text,
          toolUses: m.toolUses,
          toolResults: m.toolResults,
        })),
        metadata: { format: 'claude-session' },
      };
    }

    // Case B: Anthropic API Message[]
    const anthropicMessages = input as AnthropicMessage[];
    const normalized: Message[] = [];

    for (const msg of anthropicMessages) {
      if (typeof msg.content === 'string') {
        normalized.push({
          role: msg.role,
          text: msg.content,
          toolUses: [],
        });
        continue;
      }

      let text = '';
      const toolUses: ToolUse[] = [];
      const toolResults: ToolResult[] = [];

      for (const block of msg.content) {
        if (block.type === 'text') {
          text += (text ? '\n' : '') + (block as AnthropicContentBlockText).text;
        } else if (block.type === 'tool_use') {
          const b = block as AnthropicContentBlockToolUse;
          toolUses.push({
            tool_use_id: b.id,
            tool: b.name,
            input: b.input ?? {},
          });
        } else if (block.type === 'tool_result') {
          const b = block as AnthropicContentBlockToolResult;
          const resultText =
            typeof b.content === 'string'
              ? b.content
              : Array.isArray(b.content)
              ? b.content.map((c) => c.text).join('\n')
              : '';
          toolResults.push({
            tool_use_id: b.tool_use_id,
            text: resultText,
            isError: b.is_error ?? false,
          });
        }
      }

      const entry: Message = { role: msg.role, text, toolUses };
      if (toolResults.length > 0) entry.toolResults = toolResults;
      normalized.push(entry);
    }

    return { messages: normalized, metadata: { format: 'anthropic-api' } };
  }

  denormalize(compacted: Message[], original: ClaudeInput): ClaudeInput {
    if (original.length === 0) return [];
    const first = original[0]!;

    // Case A: Claude Code SessionMessage[]
    if ('toolUses' in first) {
      const origList = original as ClaudeSessionMessage[];
      const origMap = new Map<Message, ClaudeSessionMessage>();
      for (const m of origList) origMap.set(m, m);

      return compacted.map((m) => {
        const found = origMap.get(m);
        if (found) return found;
        const rebuilt: ClaudeSessionMessage = {
          role: m.role,
          text: m.text,
          toolUses: m.toolUses,
        };
        if (m.toolResults && m.toolResults.length > 0) {
          rebuilt.toolResults = m.toolResults;
        }
        return rebuilt;
      });
    }

    // Case B: Anthropic API Message[]
    const origAnthropic = original as AnthropicMessage[];
    const activeToolUseIds = new Set<string>();
    const activeToolResultTexts = new Map<string, string>();

    for (const m of compacted) {
      for (const tu of m.toolUses) activeToolUseIds.add(tu.tool_use_id);
      for (const tr of m.toolResults ?? []) {
        activeToolResultTexts.set(tr.tool_use_id, tr.text);
      }
    }

    const result: AnthropicMessage[] = [];

    for (const orig of origAnthropic) {
      if (typeof orig.content === 'string') {
        result.push(orig);
        continue;
      }

      const newBlocks: AnthropicContentBlock[] = [];
      let touched = false;

      for (const block of orig.content) {
        if (block.type === 'tool_use') {
          const b = block as AnthropicContentBlockToolUse;
          if (activeToolUseIds.has(b.id)) {
            newBlocks.push(b);
          } else {
            touched = true; // dropped tool use
          }
        } else if (block.type === 'tool_result') {
          const b = block as AnthropicContentBlockToolResult;
          const updatedText = activeToolResultTexts.get(b.tool_use_id);
          if (updatedText !== undefined) {
            const currentText =
              typeof b.content === 'string'
                ? b.content
                : Array.isArray(b.content)
                ? b.content.map((c) => c.text).join('\n')
                : '';
            if (updatedText === currentText) {
              newBlocks.push(b);
            } else {
              touched = true;
              newBlocks.push({
                ...b,
                content: updatedText,
              });
            }
          } else {
            touched = true; // dropped tool result
          }
        } else {
          newBlocks.push(block);
        }
      }

      if (newBlocks.length === 0) continue;
      if (!touched) {
        result.push(orig);
      } else {
        result.push({
          ...orig,
          content: newBlocks,
        });
      }
    }

    return result;
  }
}
