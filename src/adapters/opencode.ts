import type { Message, ToolResult, ToolUse } from '../types.js';
import type { AgentAdapter, NormalizedTranscript } from './types.js';

export interface OpenCodeEvent {
  id?: string;
  type?: 'message' | 'tool_call' | 'tool_result' | 'step' | string;
  role?: 'user' | 'assistant' | 'system' | 'tool' | string;
  tool?: string;
  name?: string;
  call_id?: string;
  tool_call_id?: string;
  input?: Record<string, unknown>;
  args?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
  output?: string | unknown;
  content?: string | null;
  text?: string;
  is_error?: boolean;
  [key: string]: unknown;
}

export class OpenCodeAdapter implements AgentAdapter<OpenCodeEvent[], OpenCodeEvent[]> {
  readonly name = 'opencode';

  detect(input: unknown): boolean {
    if (!Array.isArray(input) || input.length === 0) return false;
    return input.some((item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      const rec = item as Record<string, unknown>;
      if ('call_id' in rec) return true;
      if ('type' in rec && typeof rec.type === 'string') {
        if (rec.type === 'tool_call' || rec.type === 'tool_result' || rec.type === 'step') return true;
      }
      if ('tool' in rec && ('output' in rec || 'args' in rec || 'arguments' in rec)) return true;
      return false;
    });
  }

  normalize(input: OpenCodeEvent[]): NormalizedTranscript {
    const messages: Message[] = [];
    let callCounter = 0;

    // Index results by call_id / id
    const resultsByCallId = new Map<string, OpenCodeEvent>();
    for (const event of input) {
      if (event.type === 'tool_result' || event.role === 'tool' || event.output !== undefined) {
        const id = event.call_id ?? event.tool_call_id ?? event.id;
        if (id) resultsByCallId.set(id, event);
      }
    }

    for (const event of input) {
      const isUser = event.role === 'user' || event.type === 'user';
      const text = event.content ?? event.text ?? '';

      if (isUser) {
        messages.push({
          role: 'user',
          text,
          toolUses: [],
        });
        continue;
      }

      if (event.type === 'tool_call' || (event.tool && event.output === undefined)) {
        callCounter++;
        const id = event.call_id ?? event.tool_call_id ?? event.id ?? `opencode_call_${callCounter}`;
        const tool = event.tool ?? event.name ?? 'tool';
        const inputArgs = event.input ?? event.args ?? event.arguments ?? {};

        const toolUses: ToolUse[] = [{
          tool_use_id: id,
          tool,
          input: inputArgs,
        }];

        const resEvent = resultsByCallId.get(id);
        const toolResults: ToolResult[] = [];
        if (resEvent) {
          const raw = resEvent.output ?? resEvent.content ?? '';
          const resText = typeof raw === 'string' ? raw : JSON.stringify(raw);
          toolResults.push({
            tool_use_id: id,
            text: resText,
            isError: resEvent.is_error ?? false,
          });
        }

        messages.push({
          role: 'assistant',
          text,
          toolUses,
        });

        if (toolResults.length > 0) {
          messages.push({
            role: 'user',
            text: '',
            toolUses: [],
            toolResults,
          });
        }
        continue;
      }

      // If it's just a separate tool_result event that was already paired, skip standalone
      if (event.type === 'tool_result' || event.role === 'tool') {
        continue;
      }

      // Standard assistant message
      messages.push({
        role: 'assistant',
        text,
        toolUses: [],
      });
    }

    return { messages };
  }

  denormalize(compacted: Message[], original: OpenCodeEvent[]): OpenCodeEvent[] {
    const activeToolUseIds = new Set<string>();
    const activeToolResultTexts = new Map<string, string>();

    for (const m of compacted) {
      for (const tu of m.toolUses) activeToolUseIds.add(tu.tool_use_id);
      for (const tr of m.toolResults ?? []) {
        activeToolResultTexts.set(tr.tool_use_id, tr.text);
      }
    }

    let callCounter = 0;
    const result: OpenCodeEvent[] = [];

    for (const event of original) {
      if (event.type === 'tool_call' || (event.tool && event.output === undefined)) {
        callCounter++;
        const id = event.call_id ?? event.tool_call_id ?? event.id ?? `opencode_call_${callCounter}`;
        if (!activeToolUseIds.has(id)) {
          // Drop call
          continue;
        }
        result.push(event);
        continue;
      }

      if (event.type === 'tool_result' || event.role === 'tool' || event.output !== undefined) {
        const id = event.call_id ?? event.tool_call_id ?? event.id;
        if (id && !activeToolUseIds.has(id)) {
          // Drop result
          continue;
        }

        const updatedText = id ? activeToolResultTexts.get(id) : undefined;
        if (updatedText !== undefined) {
          const raw = event.output ?? event.content ?? '';
          const currentText = typeof raw === 'string' ? raw : JSON.stringify(raw);
          if (updatedText === currentText) {
            result.push(event);
          } else {
            result.push({
              ...event,
              output: event.output !== undefined ? updatedText : undefined,
              content: event.content !== undefined ? updatedText : undefined,
            });
          }
          continue;
        }

        result.push(event);
        continue;
      }

      result.push(event);
    }

    return result;
  }
}
