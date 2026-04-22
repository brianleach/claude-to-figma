import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import { convertHtml } from './convert.js';
import { substituteFontFamily } from './font-fallback.js';
import { hydrateHtml } from './hydrate.js';

const program = new Command();

program
  .name('claude-to-figma')
  .description('Convert Claude Design HTML exports into IR JSON')
  .version('0.1.0');

program
  .command('convert')
  .description('Parse an HTML file and emit IR JSON')
  .argument('<input>', 'Path to the HTML file')
  .requiredOption('-o, --output <path>', 'Where to write IR JSON')
  .option('--name <name>', 'Document name (default: input filename)')
  .option(
    '--component-threshold <n>',
    'Min identical subtrees to promote to a component (default 3, 0 to disable)',
    (v) => Number.parseInt(v, 10),
  )
  .option('--silent', 'Suppress warnings')
  .option('-v, --verbose', 'Print every warning + a per-pass breakdown')
  .option('--report <path>', 'Write a JSON report (stats + warnings) alongside the IR')
  .option(
    '--hydrate',
    'Pre-render the HTML in headless Chromium (requires playwright) and parse the post-render DOM. Use for runtime-bundled exports.',
  )
  .option(
    '--viewport <WxH>',
    'Viewport for --hydrate. Default 1440x900 (typical desktop landing breakpoint). Example: --viewport 1920x1080.',
  )
  .option(
    '--font-fallback <family>',
    'Substitute every font family in the IR with this one. Use when you cannot install the original fonts locally — e.g. --font-fallback Inter.',
  )
  .action(
    async (
      input: string,
      opts: {
        output: string;
        name?: string;
        componentThreshold?: number;
        silent?: boolean;
        verbose?: boolean;
        report?: string;
        hydrate?: boolean;
        viewport?: string;
        fontFallback?: string;
      },
    ) => {
      const inputPath = resolve(input);
      const outputPath = resolve(opts.output);
      const viewport = parseViewport(opts.viewport);
      const hydrated = opts.hydrate ? await hydrateHtml(inputPath, viewport) : undefined;
      const html = hydrated ? hydrated.html : await readFile(inputPath, 'utf8');
      const baseResult = convertHtml(html, {
        name: opts.name ?? inputPath.split('/').pop() ?? 'Untitled',
        baseDir: dirname(inputPath),
        componentThreshold: opts.componentThreshold,
        textMeasurements: hydrated?.textMeasurements,
        viewportWidth: viewport.viewportWidth ?? (opts.hydrate ? 1440 : undefined),
        viewportHeight: viewport.viewportHeight ?? (opts.hydrate ? 900 : undefined),
      });
      const result = opts.fontFallback
        ? { ...baseResult, document: substituteFontFamily(baseResult.document, opts.fontFallback) }
        : baseResult;
      await writeFile(outputPath, `${JSON.stringify(result.document, null, 2)}\n`, 'utf8');
      if (!opts.silent) {
        for (const warning of result.warnings) {
          process.stderr.write(`warn: ${warning}\n`);
        }
      }
      const { nodes, components, instances, paintStyles, textStyles, effectStyles } = result.stats;
      const componentsPart =
        components > 0 ? `, ${components} components × ${instances} instances` : '';
      const stylesPart =
        paintStyles + textStyles + effectStyles > 0
          ? `, ${paintStyles} paint × ${textStyles} text × ${effectStyles} effect styles`
          : '';
      process.stdout.write(`wrote ${outputPath} (${nodes} nodes${componentsPart}${stylesPart})\n`);

      if (opts.verbose) {
        process.stdout.write(`  source:        ${inputPath}\n`);
        process.stdout.write(`  warnings:      ${result.warnings.length}\n`);
        process.stdout.write(`  ir nodes:      ${nodes}\n`);
        process.stdout.write(`  components:    ${components}\n`);
        process.stdout.write(`  instances:     ${instances}\n`);
        process.stdout.write(`  paint styles:  ${paintStyles}\n`);
        process.stdout.write(`  text styles:   ${textStyles}\n`);
        process.stdout.write(`  effect styles: ${effectStyles}\n`);
        if (hydrated) {
          process.stdout.write(
            `  measured text: ${hydrated.textMeasurements.size} nodes via Chromium\n`,
          );
        }
      }

      if (opts.report) {
        const reportPath = resolve(opts.report);
        const report = {
          source: inputPath,
          output: outputPath,
          stats: result.stats,
          warnings: result.warnings,
          generatedAt: new Date().toISOString(),
        };
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        process.stdout.write(`wrote report ${reportPath}\n`);
      }
    },
  );

program
  .command('fonts')
  .description(
    'Print every font family + style the input requires (so you can install them before convert)',
  )
  .argument('<input>', 'Path to the HTML file')
  .option('--hydrate', 'Pre-render in headless Chromium first (same as on `convert`)')
  .option('--viewport <WxH>', 'Viewport for --hydrate (default 1440x900)')
  .action(async (input: string, opts: { hydrate?: boolean; viewport?: string }) => {
    const inputPath = resolve(input);
    const viewport = parseViewport(opts.viewport);
    const hydrated = opts.hydrate ? await hydrateHtml(inputPath, viewport) : undefined;
    const html = hydrated ? hydrated.html : await readFile(inputPath, 'utf8');
    const { document } = convertHtml(html, {
      name: inputPath.split('/').pop() ?? 'Untitled',
      baseDir: dirname(inputPath),
    });
    if (document.fonts.length === 0) {
      process.stdout.write('No fonts required.\n');
      return;
    }
    const byFamily = new Map<string, string[]>();
    for (const f of document.fonts) {
      let arr = byFamily.get(f.family);
      if (!arr) {
        arr = [];
        byFamily.set(f.family, arr);
      }
      if (!arr.includes(f.style)) arr.push(f.style);
    }
    process.stdout.write(
      `${document.fonts.length} font${document.fonts.length === 1 ? '' : 's'} required:\n`,
    );
    for (const [family, styles] of [...byFamily.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      process.stdout.write(`  ${family}: ${styles.sort().join(', ')}\n`);
    }
  });

function parseViewport(s: string | undefined): { viewportWidth?: number; viewportHeight?: number } {
  if (!s) return {};
  const match = /^(\d+)x(\d+)$/i.exec(s.trim());
  if (!match) {
    process.stderr.write(`error: --viewport must be WxH (e.g. 1440x900), got "${s}"\n`);
    process.exit(1);
  }
  return { viewportWidth: Number(match[1]), viewportHeight: Number(match[2]) };
}

program.parseAsync().catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
