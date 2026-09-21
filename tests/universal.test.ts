import { describe, expect, it } from 'vitest';
import {
  compactAgent,
  compactClaude,
  compactCodex,
  compactAntigravity,
  compactGemini,
  compactOpenCode,
} from '../src/universal.js';
import type { OpenAIChatMessage } from '../src/adapters/codex.js';
import type { GeminiContent } from '../src/adapters/gemini.js';
import type { AntigravityTranscriptStep } from '../src/adapters/antigravity.js';
import type { OpenCodeEvent } from '../src/adapters/opencode.js';

describe('universal compactAgent', () => {
  it('compacts Codex transcripts with local fallback when offline', async () => {
    const codex: OpenAIChatMessage[] = [
      { role: 'user', content: 'Inspect the code' },
      {
        role: 'assistant',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{"file":"a.ts"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'file content '.repeat(100) },
      { role: 'user', content: 'Now test it' },
      {
        role: 'assistant',
        tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'Bash', arguments: '{"command":"npm test"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_2', content: 'PASS' },
    ];

    const result = await compactAgent(codex, {
      fallbackMode: 'local',
      preserveRecentMessages: 2,
    });

    expect(result.agent).toBe('codex');
    expect(result.messages).toHaveLength(6);
    expect(result.stats.calls).toBe(2);
    // Older call should have its result truncated
    expect(result.messages[2]?.content).toContain('[fast-jev-compaction truncated');
    // Recent call is preserved
    expect(result.messages[5]?.content).toBe('PASS');
  });

  it('compacts Gemini transcripts with auto-detection', async () => {
    const gemini: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'Check the file' }] },
      { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'test.ts' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { output: 'code '.repeat(100) } } }] },
      { role: 'user', parts: [{ text: 'Run linter' }] },
      { role: 'model', parts: [{ functionCall: { name: 'lint', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'lint', response: { output: 'clean' } } }] },
    ];

    const result = await compactGemini(gemini, {
      fallbackMode: 'local',
      preserveRecentMessages: 2,
    });

    expect(result.agent).toBe('gemini');
    expect(result.messages).toHaveLength(6);
    expect(result.stats.calls).toBe(2);
  });

  it('compacts Antigravity transcripts end-to-end', async () => {
    const steps: AntigravityTranscriptStep[] = [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'start' },
      {
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        tool_calls: [
          {
            id: 'c1',
            tool: 'view_file',
            toolAction: 'Viewing file',
            args: { path: 'a.ts' },
            output: 'huge content '.repeat(80),
          },
        ],
      },
      { step_index: 2, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'next turn' },
      {
        step_index: 3,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        tool_calls: [
          {
            id: 'c2',
            tool: 'run_command',
            toolAction: 'Running command',
            args: { cmd: 'test' },
            output: 'ok',
          },
        ],
      },
    ];

    const result = await compactAntigravity(steps, {
      fallbackMode: 'local',
      preserveRecentMessages: 2,
    });

    expect(result.agent).toBe('antigravity');
    expect(result.messages).toHaveLength(4);
    expect(result.messages[1]?.tool_calls?.[0]?.output).toContain('[fast-jev-compaction truncated');
    expect(result.messages[3]?.tool_calls?.[0]?.output).toBe('ok');
  });

  it('compacts OpenCode event transcripts', async () => {
    const events: OpenCodeEvent[] = [
      { role: 'user', content: 'Run code' },
      { type: 'tool_call', call_id: 'call_1', tool: 'exec', input: { script: 'a.py' } },
      { type: 'tool_result', call_id: 'call_1', output: 'result '.repeat(100) },
      { role: 'user', content: 'Done' },
      { type: 'tool_call', call_id: 'call_2', tool: 'exec', input: { script: 'b.py' } },
      { type: 'tool_result', call_id: 'call_2', output: 'success' },
    ];

    const result = await compactOpenCode(events, {
      fallbackMode: 'local',
      preserveRecentMessages: 2,
    });

    expect(result.agent).toBe('opencode');
    expect(result.stats.calls).toBe(2);
  });
});
