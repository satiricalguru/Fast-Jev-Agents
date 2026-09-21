import type { Message, ToolResult, ToolUse } from '../types.js';
import type { AgentAdapter, NormalizedTranscript } from './types.js';

export interface GeminiFunctionCall {
  name: string;
  args?: Record<string, unknown>;
  id?: string;
  [key: string]: unknown;
}

export interface GeminiFunctionResponse {
  name: string;
  response: Record<string, unknown>;
  id?: string;
  [key: string]: unknown;
}

export interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;
  [key: string]: unknown;
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
  [key: string]: unknown;
}

export class GeminiAdapter implements AgentAdapter<GeminiContent[], GeminiContent[]> {
  readonly name = 'gemini';

  detect(input: unknown): boolean {
    if (!Array.isArray(input) || input.length === 0) return false;
    const first = input[0];
    if (!first || typeof first !== 'object') return false;

    // Gemini Content shape: role is 'user' | 'model', and has 'parts' array
    if ('role' in first && ('model' === first.role || 'user' === first.role) && 'parts' in first) {
      if (Array.isArray(first.parts)) {
        return first.parts.some(
          (p: unknown) =>
            typeof p === 'object' &&
            p !== null &&
            ('functionCall' in p || 'functionResponse' in p || 'text' in p),
        );
      }
    }

    return false;
  }

  normalize(input: GeminiContent[]): NormalizedTranscript {
    const messages: Message[] = [];
    let callCounter = 0;

    // Track functionCall ID -> Part mapping
    const callIdsByTurn = new Map<number, string[]>();

    // Pass 1: generate IDs for all function calls
    input.forEach((turn, turnIdx) => {
      const ids: string[] = [];
      for (const part of turn.parts) {
        if (part.functionCall) {
          callCounter++;
          const id = part.functionCall.id ?? `gemini_call_${callCounter}_${part.functionCall.name}`;
          ids.push(id);
        }
      }
      callIdsByTurn.set(turnIdx, ids);
    });

    // Pass 2: map to Message[]
    input.forEach((turn, turnIdx) => {
      const role = turn.role === 'model' ? 'assistant' : 'user';
      let text = '';
      const toolUses: ToolUse[] = [];
      const toolResults: ToolResult[] = [];

      let funcCallIdx = 0;
      const callIds = callIdsByTurn.get(turnIdx) ?? [];

      for (const part of turn.parts) {
        if (part.text) {
          text += (text ? '\n' : '') + part.text;
        }

        if (part.functionCall) {
          const id = callIds[funcCallIdx++] ?? `gemini_call_${callCounter}`;
          toolUses.push({
            tool_use_id: id,
            tool: part.functionCall.name,
            input: part.functionCall.args ?? {},
          });
        }

        if (part.functionResponse) {
          // Look back for corresponding function call ID
          const fn = part.functionResponse;
          const resp = fn.response ?? {};
          const resultText =
            typeof resp.output === 'string'
              ? resp.output
              : typeof resp.content === 'string'
              ? resp.content
              : JSON.stringify(resp);

          // If id is explicitly on functionResponse, use it
          let matchedId = fn.id;
          if (!matchedId) {
            // Find most recent matching functionCall with same name in preceding messages
            for (let i = messages.length - 1; i >= 0; i--) {
              const prev = messages[i]!;
              const found = prev.toolUses.find((tu) => tu.tool === fn.name);
              if (found) {
                matchedId = found.tool_use_id;
                break;
              }
            }
          }

          toolResults.push({
            tool_use_id: matchedId ?? `gemini_res_${fn.name}`,
            text: resultText,
            isError: Boolean(resp.error),
          });
        }
      }

      const msg: Message = { role, text, toolUses };
      if (toolResults.length > 0) msg.toolResults = toolResults;
      messages.push(msg);
    });

    return { messages };
  }

  denormalize(compacted: Message[], original: GeminiContent[]): GeminiContent[] {
    const activeToolUseIds = new Set<string>();
    const activeToolResultTexts = new Map<string, string>();

    for (const m of compacted) {
      for (const tu of m.toolUses) activeToolUseIds.add(tu.tool_use_id);
      for (const tr of m.toolResults ?? []) {
        activeToolResultTexts.set(tr.tool_use_id, tr.text);
      }
    }

    // Reconstruct call IDs as in normalize
    let callCounter = 0;
    const callIdsByTurn = new Map<number, string[]>();
    original.forEach((turn, turnIdx) => {
      const ids: string[] = [];
      for (const part of turn.parts) {
        if (part.functionCall) {
          callCounter++;
          const id = part.functionCall.id ?? `gemini_call_${callCounter}_${part.functionCall.name}`;
          ids.push(id);
        }
      }
      callIdsByTurn.set(turnIdx, ids);
    });

    const result: GeminiContent[] = [];

    original.forEach((turn, turnIdx) => {
      const newParts: GeminiPart[] = [];
      let touched = false;
      let funcCallIdx = 0;
      const callIds = callIdsByTurn.get(turnIdx) ?? [];

      for (const part of turn.parts) {
        if (part.functionCall) {
          const id = callIds[funcCallIdx++];
          if (id && activeToolUseIds.has(id)) {
            newParts.push(part);
          } else {
            touched = true; // dropped function call
          }
          continue;
        }

        if (part.functionResponse) {
          const fn = part.functionResponse;
          // Find matched ID
          let matchedId = fn.id;
          if (!matchedId) {
            for (const id of activeToolUseIds) {
              if (id.includes(fn.name)) {
                matchedId = id;
                break;
              }
            }
          }

          if (matchedId && !activeToolUseIds.has(matchedId)) {
            touched = true; // call was dropped, drop response
            continue;
          }

          const updatedText = matchedId ? activeToolResultTexts.get(matchedId) : undefined;
          if (updatedText !== undefined) {
            const resp = fn.response ?? {};
            const currentText =
              typeof resp.output === 'string'
                ? resp.output
                : typeof resp.content === 'string'
                ? resp.content
                : JSON.stringify(resp);

            if (updatedText === currentText) {
              newParts.push(part);
            } else {
              touched = true;
              newParts.push({
                ...part,
                functionResponse: {
                  ...fn,
                  response: {
                    ...resp,
                    output: updatedText,
                  },
                },
              });
            }
          } else {
            newParts.push(part);
          }
          continue;
        }

        newParts.push(part);
      }

      if (newParts.length === 0) return; // drop empty turn

      if (!touched) {
        result.push(turn);
      } else {
        result.push({
          ...turn,
          parts: newParts,
        });
      }
    });

    return result;
  }
}
