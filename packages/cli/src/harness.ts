/**
 * Integration harness — convert every Claude Design HTML export under a
 * fixtures directory and return per-fixture stats. Exposed as a function
 * so vitest can drive it; `scripts/integration.ts` is the thin CLI
 * wrapper that prints results to stdout.
 */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type ConvertResult, convertHtml } from './convert.js';
import { hydrateHtml } from './hydrate.js';

export interface HarnessOptions {
  /** Absolute path to the directory to scan. */
  fixturesDir: string;
  /** Write a per-fixture `*.report.json` next to each input HTML. */
  writeReport?: boolean;
  /** Pre-render each HTML in headless Chromium before parsing. */
  hydrate?: boolean;
}

export interface FixtureSuccess {
  ok: true;
  /** Absolute path to the input HTML. */
  source: string;
  stats: ConvertResult['stats'];
  warnings: string[];
}

export interface FixtureFailure {
  ok: false;
  source: string;
  error: string;
}

export type FixtureOutcome = FixtureSuccess | FixtureFailure;

export interface HarnessResult {
  /** True when the fixtures dir doesn't exist or is empty of *.html files. */
  empty: boolean;
  outcomes: FixtureOutcome[];
}

/** Convert every `*.html` under `fixturesDir`, recursively. */
export async function runHarness(opts: HarnessOptions): Promise<HarnessResult> {
  if (!(await pathExists(opts.fixturesDir))) {
    return { empty: true, outcomes: [] };
  }
  const htmlFiles = await findHtmlFiles(opts.fixturesDir);
  if (htmlFiles.length === 0) {
    return { empty: true, outcomes: [] };
  }
  const outcomes: FixtureOutcome[] = [];
  for (const file of htmlFiles) {
    outcomes.push(await runOne(file, opts.writeReport ?? false, opts.hydrate ?? false));
  }
  return { empty: false, outcomes };
}

async function runOne(
  htmlPath: string,
  writeReport: boolean,
  hydrate: boolean,
): Promise<FixtureOutcome> {
  try {
    const hydrated = hydrate ? await hydrateHtml(htmlPath) : undefined;
    const html = hydrated ? hydrated.html : await readFile(htmlPath, 'utf8');
    const result = convertHtml(html, {
      name: htmlPath.split('/').pop() ?? 'Untitled',
      baseDir: dirname(htmlPath),
      textMeasurements: hydrated?.textMeasurements,
    });
    if (writeReport) {
      const reportPath = htmlPath.replace(/\.html$/, '.report.json');
      await writeFile(
        reportPath,
        `${JSON.stringify({ source: htmlPath, ...result }, null, 2)}\n`,
        'utf8',
      );
    }
    return { ok: true, source: htmlPath, stats: result.stats, warnings: result.warnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, source: htmlPath, error: message };
  }
}

// ---------------------------------------------------------------------------
// fs helpers
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function findHtmlFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        out.push(full);
      }
    }
  };
  await walk(root);
  return out.sort();
}
