import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes('--watch');

const codeOpts = {
  entryPoints: [resolve(here, 'src/code.ts')],
  bundle: true,
  minify: false,
  sourcemap: false,
  target: 'es2017',
  platform: 'browser',
  format: 'iife',
  outfile: resolve(here, 'code.js'),
  logLevel: 'info',
};

// Copy ui.html verbatim — the inline <script> already has everything we need.
function copyUi() {
  const src = readFileSync(resolve(here, 'src/ui.html'), 'utf8');
  writeFileSync(resolve(here, 'ui.html'), src);
}

if (isWatch) {
  const ctx = await context(codeOpts);
  copyUi();
  await ctx.watch();
  console.log('[plugin] watching…');
} else {
  await build(codeOpts);
  copyUi();
  console.log('[plugin] built code.js + ui.html');
}
