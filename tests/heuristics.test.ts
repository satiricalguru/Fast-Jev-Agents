import { describe, expect, it } from 'vitest';
import { analyzeHeuristics, smartTruncateResultText } from '../src/heuristics.js';
import type { ToolCall } from '../src/types.js';

describe('heuristics', () => {
  it('detects superseded file reads when a file is edited subsequently', () => {
    const calls: ToolCall[] = [
      {
        id: 't1',
        tool_use_id: 'u1',
        tool: 'Read',
        input: { file_path: 'src/main.ts' },
        callIndex: 1,
        resultIndex: 2,
        resultChars: 2000,
        isError: false,
        pinned: false,
      },
      {
        id: 't2',
        tool_use_id: 'u2',
        tool: 'Edit',
        input: { file_path: 'src/main.ts', old_string: 'a', new_string: 'b' },
        callIndex: 3,
        resultIndex: 4,
        resultChars: 50,
        isError: false,
        pinned: false,
      },
    ];

    const analysis = analyzeHeuristics(calls);
    expect(analysis.supersededResults.has('t1')).toBe(true);
    expect(analysis.supersededResults.has('t2')).toBe(false);

    const decision = analysis.decisions.get('t1');
    expect(decision).toBeDefined();
    expect(decision?.keepCall).toBeGreaterThanOrEqual(0.9);
    expect(decision?.keepResult).toBeLessThanOrEqual(0.1);
  });

  it('detects redundant consecutive search operations', () => {
    const calls: ToolCall[] = [
      {
        id: 't1',
        tool_use_id: 'u1',
        tool: 'Glob',
        input: { pattern: '**/*.ts' },
        callIndex: 1,
        resultIndex: 2,
        resultChars: 10000,
        isError: false,
        pinned: false,
      },
      {
        id: 't2',
        tool_use_id: 'u2',
        tool: 'Glob',
        input: { pattern: 'src/auth/*.ts' },
        callIndex: 3,
        resultIndex: 4,
        resultChars: 200,
        isError: false,
        pinned: false,
      },
    ];

    const analysis = analyzeHeuristics(calls);
    expect(analysis.supersededResults.has('t1')).toBe(true);
  });

  it('never marks pinned calls as superseded', () => {
    const calls: ToolCall[] = [
      {
        id: 't1',
        tool_use_id: 'u1',
        tool: 'Read',
        input: { file_path: 'src/main.ts' },
        callIndex: 1,
        resultIndex: 2,
        resultChars: 2000,
        isError: false,
        pinned: true,
      },
      {
        id: 't2',
        tool_use_id: 'u2',
        tool: 'Edit',
        input: { file_path: 'src/main.ts' },
        callIndex: 3,
        resultIndex: 4,
        resultChars: 50,
        isError: false,
        pinned: false,
      },
    ];

    const analysis = analyzeHeuristics(calls);
    expect(analysis.supersededResults.has('t1')).toBe(false);
  });
});

describe('smart head + tail truncation', () => {
  it('preserves both head and tail when tailChars > 0', () => {
    const errorLog = `npm test starting...\n${'pass\n'.repeat(50)}FAIL src/auth.test.ts: TokenExpiredError at line 42`;
    const truncated = smartTruncateResultText(errorLog, true, 30, 50);

    expect(truncated).toContain('npm test starting...');
    expect(truncated).toContain('TokenExpiredError at line 42');
    expect(truncated).toContain('[fast-jev-compaction truncated');
    expect(truncated).toContain('(error)');
  });

  it('behaves like legacy truncation when tailChars is 0', () => {
    const text = 'a'.repeat(1000);
    const truncated = smartTruncateResultText(text, false, 50, 0);

    expect(truncated).toMatch(/^a{50}\n\[fast-jev-compaction truncated 950 chars of this tool result; re-run the tool if needed\]$/);
  });

  it('returns short text unchanged', () => {
    const short = 'ok, 10 lines';
    expect(smartTruncateResultText(short, false, 50, 50)).toBe(short);
  });
});
