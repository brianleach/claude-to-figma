/**
 * Integration harness tests — covers V-M8-HARNESS.
 *
 * The harness must run cleanly when fixtures/claude-design/ doesn't
 * exist (the open-source default) and when it exists but is empty,
 * because that's the state every fresh checkout starts in. Then we
 * exercise the success path against a temp directory of synthetic
 * Claude-Design-shaped exports.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runHarness } from '../src/harness.js';

let tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

async function makeTmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'c2f-harness-'));
  tmpDirs.push(dir);
  return dir;
}

describe('runHarness', () => {
  it('returns empty=true and outcomes=[] when the directory does not exist', async () => {
    const result = await runHarness({ fixturesDir: '/tmp/c2f-harness-does-not-exist-xyz123' });
    expect(result.empty).toBe(true);
    expect(result.outcomes).toEqual([]);
  });

  it('returns empty=true when the directory exists but contains no .html files', async () => {
    const dir = await makeTmp();
    await writeFile(join(dir, 'README.md'), 'not html');
    const result = await runHarness({ fixturesDir: dir });
    expect(result.empty).toBe(true);
    expect(result.outcomes).toEqual([]);
  });

  it('converts a single HTML fixture and reports stats', async () => {
    const dir = await makeTmp();
    await writeFile(
      join(dir, 'page.html'),
      `<html><body style="margin:0;width:300px;height:200px;">
         <div style="padding:16px;background:#2563eb;">
           <h1 style="color:#ffffff;font-size:24px;">Hello</h1>
         </div>
       </body></html>`,
    );
    const result = await runHarness({ fixturesDir: dir });
    expect(result.empty).toBe(false);
    expect(result.outcomes).toHaveLength(1);
    const outcome = result.outcomes[0];
    if (!outcome || !outcome.ok) throw new Error('expected success');
    expect(outcome.stats.nodes).toBeGreaterThan(0);
    expect(outcome.stats.paintStyles).toBeGreaterThan(0);
  });

  it('walks subdirectories recursively', async () => {
    const dir = await makeTmp();
    const nested = join(dir, 'export-1');
    await mkdir(nested, { recursive: true });
    const html = '<html><body style="width:100px;height:100px;"></body></html>';
    await writeFile(join(dir, 'a.html'), html);
    await writeFile(join(nested, 'b.html'), html);

    const result = await runHarness({ fixturesDir: dir });
    expect(result.outcomes).toHaveLength(2);
  });

  it('writes per-fixture *.report.json when writeReport is true', async () => {
    const dir = await makeTmp();
    await writeFile(
      join(dir, 'page.html'),
      `<html><body style="width:200px;height:100px;background:#ccc;">
         <div style="width:50px;height:50px;background:#fff;"></div>
       </body></html>`,
    );
    await runHarness({ fixturesDir: dir, writeReport: true });
    const report = await (await import('node:fs/promises')).readFile(
      join(dir, 'page.report.json'),
      'utf8',
    );
    const parsed = JSON.parse(report);
    expect(parsed.source).toContain('page.html');
    expect(parsed.stats.nodes).toBeGreaterThan(0);
  });
});
