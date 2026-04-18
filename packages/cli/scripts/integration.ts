#!/usr/bin/env node
/**
 * Thin wrapper around `runHarness` — walks `fixtures/claude-design/` at
 * the repo root, prints a one-row-per-fixture table of stats and
 * warnings. Exits 0 even when nothing's there so the open-source
 * release pipeline ships green.
 *
 * Pass `--report` to write a per-fixture `*.report.json` next to the
 * input HTML.
 */

import { relative, resolve } from 'node:path';
import { type FixtureOutcome, type FixtureSuccess, runHarness } from '../src/harness.js';

const FIXTURES_ROOT = resolve(import.meta.dirname, '../../../fixtures/claude-design');

async function main(): Promise<void> {
  const writeReport = process.argv.includes('--report');
  const hydrate = process.argv.includes('--hydrate');
  const result = await runHarness({ fixturesDir: FIXTURES_ROOT, writeReport, hydrate });
  const relRoot = relative(process.cwd(), FIXTURES_ROOT);

  if (result.empty) {
    process.stdout.write(
      `harness: nothing under ${relRoot} — drop a real Claude Design export there and re-run. Skipping cleanly.\n`,
    );
    return;
  }

  process.stdout.write(`harness: found ${result.outcomes.length} HTML file(s)\n\n`);
  for (const outcome of result.outcomes) {
    process.stdout.write(formatRow(outcome, FIXTURES_ROOT));
  }
  printSummary(result.outcomes);
}

function formatRow(o: FixtureOutcome, root: string): string {
  const rel = relative(root, o.source);
  if (!o.ok) return `  ✗ ${truncate(rel, 40)}  ERROR: ${o.error}\n`;
  const cells = [
    truncate(rel, 40),
    `${o.stats.nodes} nodes`.padEnd(12),
    `${o.stats.components}c × ${o.stats.instances}i`.padEnd(14),
    `${o.stats.paintStyles}p × ${o.stats.textStyles}t`.padEnd(12),
    o.warnings.length === 0
      ? ''
      : `${o.warnings.length} warning${o.warnings.length === 1 ? '' : 's'}`,
  ];
  return `  ✓ ${cells.join('  ')}\n`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `…${s.slice(-(n - 1))}` : s.padEnd(n);
}

function printSummary(outcomes: FixtureOutcome[]): void {
  const ok = outcomes.filter((o): o is FixtureSuccess => o.ok);
  const failed = outcomes.length - ok.length;
  process.stdout.write('\n');
  process.stdout.write(
    `summary: ${ok.length} converted, ${failed} failed, ${outcomes.length} total\n`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`harness: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
