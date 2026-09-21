import type { Message, ToolResult, ToolUse } from '../types.js';
import type { AgentAdapter, NormalizedTranscript } from './types.js';

export interface AntigravityToolCallRecord {
  id?: string;
  tool_use_id?: string;
  name?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
  input?: Record<string, unknown>;
  result?: string | unknown;
  output?: string | unknown;
  is_error?: boolean;
  toolAction?: string;
  toolSummary?: string;
  [key: string]: unknown;
}

export interface AntigravityTranscriptStep {
  step_index?: number;
  source?: 'USER_EXPLICIT' | 'MODEL' | 'SYSTEM' | string;
  type?: 'USER_INPUT' | 'PLANNER_RESPONSE' | 'SUBAGENT_NOTIFICATION' | 'TASK_NOTIFICATION' | string;
  status?: 'DONE' | 'ERROR' | string;
  content?: string;
  text?: string;
  tool_calls?: AntigravityToolCallRecord[];
  [key: string]: unknown;
}

export class AntigravityAdapter
  implements AgentAdapter<AntigravityTranscriptStep[], AntigravityTranscriptStep[]>
{
  readonly name = 'antigravity';

  detect(input: unknown): boolean {
    if (!Array.isArray(input) || input.length === 0) return false;
    const first = input[0];
    if (!first || typeof first !== 'object') return false;

    // Detect Antigravity step structure: source / type / step_index / toolAction
    if ('step_index' in first || 'source' in first) {
      return true;
    }
    if ('type' in first && typeof first.type === 'string') {
      const types = new Set(['USER_INPUT', 'PLANNER_RESPONSE', 'SUBAGENT_NOTIFICATION', 'TASK_NOTIFICATION']);
      if (types.has(first.type)) return true;
    }
    if (
      'tool_calls' in first &&
      Array.isArray(first.tool_calls) &&
      first.tool_calls.some((tc: Record<string, unknown>) => 'toolAction' in tc || 'toolSummary' in tc)
    ) {
      return true;
    }

    return false;
  }

  normalize(input: AntigravityTranscriptStep[]): NormalizedTranscript {
    const messages: Message[] = [];
    let callCounter = 0;

    for (const step of input) {
      const isUser =
        step.type === 'USER_INPUT' ||
        step.source === 'USER_EXPLICIT' ||
        step.type === 'TASK_NOTIFICATION';
      const text = step.content ?? step.text ?? '';

      if (isUser) {
        messages.push({
          role: 'user',
          text,
          toolUses: [],
        });
        continue;
      }

      // Assistant / Planner response
      const toolUses: ToolUse[] = [];
      const toolResults: ToolResult[] = [];

      for (const tc of step.tool_calls ?? []) {
        callCounter++;
        const id = tc.id ?? tc.tool_use_id ?? `agy_call_${callCounter}`;
        const tool = tc.tool ?? tc.name ?? 'unknown_tool';
        const inputArgs = tc.args ?? tc.arguments ?? tc.input ?? {};

        toolUses.push({
          tool_use_id: id,
          tool,
          input: inputArgs,
        });

        const rawResult = tc.result ?? tc.output;
        const resultText =
          typeof rawResult === 'string'
            ? rawResult
            : rawResult !== undefined
            ? JSON.stringify(rawResult)
            : '';

        toolResults.push({
          tool_use_id: id,
          text: resultText,
          isError: tc.is_error ?? false,
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
    }

    return { messages };
  }

  denormalize(
    compacted: Message[],
    original: AntigravityTranscriptStep[],
  ): AntigravityTranscriptStep[] {
    const activeToolUseIds = new Set<string>();
    const activeToolResultTexts = new Map<string, string>();

    for (const m of compacted) {
      for (const tu of m.toolUses) activeToolUseIds.add(tu.tool_use_id);
      for (const tr of m.toolResults ?? []) {
        activeToolResultTexts.set(tr.tool_use_id, tr.text);
      }
    }

    const result: AntigravityTranscriptStep[] = [];
    let callCounter = 0;

    for (const step of original) {
      if (!step.tool_calls || step.tool_calls.length === 0) {
        result.push(step);
        continue;
      }

      const newToolCalls: AntigravityToolCallRecord[] = [];
      let touched = false;

      for (const tc of step.tool_calls) {
        callCounter++;
        const id = tc.id ?? tc.tool_use_id ?? `agy_call_${callCounter}`;

        if (!activeToolUseIds.has(id)) {
          touched = true; // dropped tool call
          continue;
        }

        const updatedResult = activeToolResultTexts.get(id);
        const originalResult =
          typeof (tc.result ?? tc.output) === 'string'
            ? (tc.result ?? tc.output)
            : JSON.stringify(tc.result ?? tc.output ?? '');

        if (updatedResult !== undefined && updatedResult !== originalResult) {
          touched = true;
          const copy: AntigravityToolCallRecord = { ...tc };
          if ('result' in copy) copy.result = updatedResult;
          if ('output' in copy) copy.output = updatedResult;
          if (!('result' in copy) && !('output' in copy)) copy.result = updatedResult;
          newToolCalls.push(copy);
        } else {
          newToolCalls.push(tc);
        }
      }

      if (newToolCalls.length === 0 && (!step.content || step.content === '')) {
        continue; // drop empty step
      }

      if (!touched) {
        result.push(step);
      } else {
        result.push({
          ...step,
          tool_calls: newToolCalls,
        });
      }
    }

    return result;
  }
}
