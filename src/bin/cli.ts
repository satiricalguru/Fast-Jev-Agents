#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compactAgent } from '../universal.js';
import type { SupportedAgent } from '../types.js';

function printHelp(): void {
  console.log(`
fast-jev-compaction CLI - High-performance context compaction for all coding agents
Supports Claude, Codex, Antigravity, Gemini, and OpenCode

Usage:
  fast-jev <file.json> [options]
  cat transcript.jsonl | fast-jev - [options]

Options:
  -a, --agent <name>     Agent format: auto (default), claude, codex, antigravity, gemini, opencode
  -o, --output <file>    Output destination file (defaults to stdout)
  -s, --stats            Print compaction statistics to stderr
  -d, --dry-run          Analyze and show decisions without writing output
  -k, --key <api-key>    TypeSafe API Key (or set TYPESAFE_API_KEY env)
  -h, --help             Show this help message

Examples:
  fast-jev session.json --agent codex --stats
  fast-jev transcript.jsonl --agent antigravity -o compacted.jsonl
  cat chat.json | fast-jev - --agent gemini > out.json
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  let inputFile: string | undefined;
  let outputFile: string | undefined;
  let agent: SupportedAgent | 'auto' = 'auto';
  let showStats = false;
  let dryRun = false;
  let apiKey: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-o' || arg === '--output') {
      outputFile = args[++i];
    } else if (arg === '-a' || arg === '--agent') {
      agent = (args[++i] as SupportedAgent | 'auto') ?? 'auto';
    } else if (arg === '-s' || arg === '--stats') {
      showStats = true;
    } else if (arg === '-d' || arg === '--dry-run') {
      dryRun = true;
      showStats = true;
    } else if (arg === '-k' || arg === '--key') {
      apiKey = args[++i];
    } else if ((arg === '-' || !arg.startsWith('-')) && !inputFile) {
      inputFile = arg;
    }
  }

  if (!inputFile) {
    console.error('Error: No input file or stdin specified.');
    process.exit(1);
  }

  // Read input
  let rawContent = '';
  if (inputFile === '-') {
    rawContent = readFileSync(0, 'utf-8');
  } else {
    rawContent = readFileSync(resolve(process.cwd(), inputFile), 'utf-8');
  }

  // Parse input
  let parsed: unknown;
  const trimmed = rawContent.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Might be JSONL
    }
  }

  if (!parsed && trimmed.startsWith('[')) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Might be JSONL
    }
  }

  if (!parsed) {
    // Attempt JSONL parsing
    const lines = trimmed.split('\n').filter(Boolean);
    try {
      parsed = lines.map((l) => JSON.parse(l));
    } catch {
      console.error('Error: Failed to parse input as JSON or JSONL.');
      process.exit(1);
    }
  }

  // Execute compaction
  const result = await compactAgent(parsed, {
    agent,
    apiKey,
    fallbackMode: 'local', // Graceful offline/local compaction for CLI
  });

  if (showStats) {
    const ratio = result.stats.charsBefore > 0
      ? (((result.stats.charsBefore - result.stats.charsAfter) / result.stats.charsBefore) * 100).toFixed(1)
      : '0.0';
    console.error(`\n--- fast-jev-compaction summary ---`);
    console.error(`Detected Agent : ${result.agent}`);
    console.error(`Messages       : ${result.stats.messagesBefore} -> ${result.stats.messagesAfter}`);
    console.error(`Characters     : ${result.stats.charsBefore} -> ${result.stats.charsAfter} (${ratio}% reduction)`);
    console.error(`Tool Calls     : ${result.stats.calls} (${result.stats.kept} kept, ${result.stats.resultsDropped} truncated, ${result.stats.callsDropped} dropped)`);
    if (result.stats.heuristicsPruned > 0) {
      console.error(`Heuristics     : ${result.stats.heuristicsPruned} call results pre-pruned (superseded/redundant)`);
    }
    console.error(`Duration       : ${result.stats.ms}ms in ${result.stats.requests} Jev request(s)\n`);
  }

  if (dryRun) {
    process.exit(0);
  }

  const outputString = JSON.stringify(result.messages, null, 2);

  if (outputFile) {
    writeFileSync(resolve(process.cwd(), outputFile), outputString, 'utf-8');
    if (showStats) console.error(`Compacted transcript written to ${outputFile}`);
  } else {
    process.stdout.write(outputString + '\n');
  }
}

main().catch((err) => {
  console.error('Compaction failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
