import { describe, expect, it } from 'vitest';
import {
  AntigravityAdapter,
  ClaudeAdapter,
  CodexAdapter,
  GeminiAdapter,
  OpenCodeAdapter,
  detectAgentFormat,
  type AnthropicMessage,
  type AntigravityTranscriptStep,
  type GeminiContent,
  type OpenAIChatMessage,
  type OpenCodeEvent,
} from '../src/adapters/index.js';

describe('format detection', () => {
  it('detects Claude Code format', () => {
    const session = [
      { role: 'user', text: 'hi', toolUses: [] },
      { role: 'assistant', text: 'reading', toolUses: [{ tool_use_id: '1', tool: 'Read', input: {} }] },
    ];
    expect(detectAgentFormat(session)).toBe('claude');
  });

  it('detects Anthropic Messages API format', () => {
    const anthropic: AnthropicMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'check file' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'read', input: {} }] },
    ];
    expect(detectAgentFormat(anthropic)).toBe('claude');
  });

  it('detects Codex / OpenAI format', () => {
    const codex: OpenAIChatMessage[] = [
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'file content' },
    ];
    expect(detectAgentFormat(codex)).toBe('codex');
  });

  it('detects Antigravity format', () => {
    const agy: AntigravityTranscriptStep[] = [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'fix bug' },
      {
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        tool_calls: [{ toolAction: 'Reading file', toolSummary: 'Read file', tool: 'view_file', args: {}, output: 'code' }],
      },
    ];
    expect(detectAgentFormat(agy)).toBe('antigravity');
  });

  it('detects Gemini format', () => {
    const gemini: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'search something' }] },
      { role: 'model', parts: [{ functionCall: { name: 'search', args: { q: 'test' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'search', response: { output: 'results' } } }] },
    ];
    expect(detectAgentFormat(gemini)).toBe('gemini');
  });

  it('detects OpenCode format', () => {
    const opencode: OpenCodeEvent[] = [
      { type: 'message', role: 'user', content: 'run script' },
      { type: 'tool_call', tool: 'bash', call_id: 'call_1', args: { cmd: 'ls' } },
      { type: 'tool_result', call_id: 'call_1', output: 'file1 file2' },
    ];
    expect(detectAgentFormat(opencode)).toBe('opencode');
  });
});

describe('CodexAdapter roundtrip', () => {
  it('normalizes and denormalizes OpenAI messages with tool results truncated', () => {
    const adapter = new CodexAdapter();
    const input: OpenAIChatMessage[] = [
      { role: 'system', content: 'You are an AI engineer.' },
      { role: 'user', content: 'Read the file.' },
      {
        role: 'assistant',
        content: 'I will read it now.',
        tool_calls: [{ id: 'call_read', type: 'function', function: { name: 'Read', arguments: '{"path":"a.ts"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_read', content: 'long file content '.repeat(20) },
      { role: 'user', content: 'Looks good.' },
    ];

    const { messages: normalized } = adapter.normalize(input);
    expect(normalized).toHaveLength(5);
    expect(normalized[2]?.toolUses[0]?.tool_use_id).toBe('call_read');
    expect(normalized[3]?.toolResults?.[0]?.text).toContain('long file content');

    // Simulate compaction dropping the result
    const simulatedCompacted = normalized.map((m, idx) => {
      if (idx === 3) {
        return {
          ...m,
          toolResults: [{ tool_use_id: 'call_read', text: '[fast-jev-compaction truncated]' }],
        };
      }
      return m;
    });

    const output = adapter.denormalize(simulatedCompacted, input);
    expect(output).toHaveLength(5);
    expect(output[3]?.role).toBe('tool');
    expect(output[3]?.content).toBe('[fast-jev-compaction truncated]');
    // Untouched messages preserve identity
    expect(output[0]).toBe(input[0]);
    expect(output[1]).toBe(input[1]);
  });
});

describe('GeminiAdapter roundtrip', () => {
  it('normalizes and denormalizes Gemini contents with function responses', () => {
    const adapter = new GeminiAdapter();
    const input: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'Run test.' }] },
      { role: 'model', parts: [{ functionCall: { name: 'run_bash', args: { command: 'npm test' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'run_bash', response: { output: 'FAIL in a.ts' } } }] },
    ];

    const { messages: normalized } = adapter.normalize(input);
    expect(normalized).toHaveLength(3);
    expect(normalized[1]?.toolUses[0]?.tool).toBe('run_bash');
    expect(normalized[2]?.toolResults?.[0]?.text).toBe('FAIL in a.ts');

    const output = adapter.denormalize(normalized, input);
    expect(output).toHaveLength(3);
    expect(output[1]?.parts[0]?.functionCall?.name).toBe('run_bash');
    expect(output[2]?.parts[0]?.functionResponse?.name).toBe('run_bash');
  });
});

describe('AntigravityAdapter roundtrip', () => {
  it('normalizes and denormalizes Antigravity transcript steps', () => {
    const adapter = new AntigravityAdapter();
    const input: AntigravityTranscriptStep[] = [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'fix it' },
      {
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        tool_calls: [
          {
            id: 'call_1',
            tool: 'view_file',
            toolAction: 'Viewing file',
            args: { path: 'index.ts' },
            output: 'const x = 1;',
          },
        ],
      },
    ];

    const { messages: normalized } = adapter.normalize(input);
    expect(normalized).toHaveLength(3); // User, Assistant, Tool result
    expect(normalized[1]?.toolUses[0]?.tool).toBe('view_file');

    const output = adapter.denormalize(normalized, input);
    expect(output).toHaveLength(2);
    expect(output[1]?.tool_calls?.[0]?.toolAction).toBe('Viewing file');
  });
});
