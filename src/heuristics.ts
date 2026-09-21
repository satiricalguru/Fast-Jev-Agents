import type { CallAnswer, ToolCall } from './types.js';

export interface HeuristicAnalysisResult {
  /** Map of tool call ID -> predetermined decision */
  decisions: Map<string, CallAnswer>;
  /** Set of tool call IDs whose full results were marked as obsolete */
  supersededResults: Set<string>;
}

const READ_TOOLS = new Set([
  'read',
  'read_file',
  'view_file',
  'readfile',
  'cat',
  'open_file',
]);

const WRITE_TOOLS = new Set([
  'edit',
  'edit_file',
  'write',
  'write_file',
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
  'create_file',
  'patch',
]);

const SEARCH_TOOLS = new Set([
  'glob',
  'grep',
  'grep_search',
  'find_by_name',
  'search_files',
  'list_dir',
  'ls',
]);

/**
 * Normalizes a file path extracted from tool input for comparison.
 */
function extractFilePath(input: Record<string, unknown>): string | undefined {
  for (const key of ['file_path', 'filePath', 'path', 'AbsolutePath', 'targetFile', 'TargetFile', 'filename']) {
    const val = input[key];
    if (typeof val === 'string' && val.trim()) {
      return val.trim().replace(/\\/g, '/');
    }
  }
  return undefined;
}

/**
 * Analyzes tool calls across the transcript to identify provably obsolete
 * or redundant calls before querying Jev.
 *
 * Examples:
 * 1. A file was read at turn 2, then edited at turn 5. The turn 2 read result is obsolete.
 * 2. A file was read at turn 2, then read again at turn 6. The turn 2 read result is superseded.
 * 3. Consecutive search/glob queries where a narrower search followed immediately.
 */
export function analyzeHeuristics(calls: readonly ToolCall[]): HeuristicAnalysisResult {
  const decisions = new Map<string, CallAnswer>();
  const supersededResults = new Set<string>();

  // Map from normalized file path -> list of tool calls operating on that file
  const fileOperations = new Map<string, { call: ToolCall; type: 'read' | 'write' }[]>();

  for (const call of calls) {
    const toolLower = call.tool.toLowerCase();
    const filePath = extractFilePath(call.input);

    if (filePath) {
      const isRead = READ_TOOLS.has(toolLower);
      const isWrite = WRITE_TOOLS.has(toolLower);

      if (isRead || isWrite) {
        const ops = fileOperations.get(filePath) ?? [];
        ops.push({ call, type: isRead ? 'read' : 'write' });
        fileOperations.set(filePath, ops);
      }
    }
  }

  // Check file read supersession:
  // If an unpinned read is followed by another read or a write on the same file,
  // its result is no longer needed (the call itself matters, but the verbatim file content is old).
  for (const [, ops] of fileOperations) {
    for (let i = 0; i < ops.length - 1; i++) {
      const current = ops[i]!;
      if (current.type === 'read' && !current.call.pinned) {
        // There is a subsequent read or write to this file
        supersededResults.add(current.call.id);
        decisions.set(current.call.id, {
          keepCall: 0.95, // The call happened and is relevant context
          keepResult: 0.05, // The full result is obsolete
        });
      }
    }
  }

  // Check redundant searches:
  // If an unpinned search is followed by another search within 2 calls of the same type,
  // the earlier search result is usually superseded by the more specific search.
  for (let i = 0; i < calls.length - 1; i++) {
    const current = calls[i]!;
    if (current.pinned || !SEARCH_TOOLS.has(current.tool.toLowerCase())) continue;

    const next = calls[i + 1]!;
    if (SEARCH_TOOLS.has(next.tool.toLowerCase()) && !next.pinned) {
      if (!decisions.has(current.id)) {
        supersededResults.add(current.id);
        decisions.set(current.id, {
          keepCall: 0.9,
          keepResult: 0.1,
        });
      }
    }
  }

  return { decisions, supersededResults };
}

/**
 * Truncates a tool result keeping both a head and an optional tail (e.g. for error summaries).
 */
export function smartTruncateResultText(
  text: string,
  isError: boolean,
  headChars: number,
  tailChars: number = 0,
): string {
  if (text.length <= headChars + tailChars + 120) return text;

  const head = headChars > 0 ? `${text.slice(0, headChars)}\n` : '';
  const tail = tailChars > 0 ? `\n${text.slice(-tailChars)}` : '';
  const omitted = text.length - headChars - tailChars;

  return `${head}[fast-jev-compaction truncated ${omitted} chars of this tool result${
    isError ? ' (error)' : ''
  }; re-run the tool if needed]${tail}`;
}
