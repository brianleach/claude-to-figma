import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { convertHtml } from './convert.js';

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
  .option('--silent', 'Suppress warnings')
  .action(async (input: string, opts: { output: string; name?: string; silent?: boolean }) => {
    const inputPath = resolve(input);
    const outputPath = resolve(opts.output);
    const html = await readFile(inputPath, 'utf8');
    const result = convertHtml(html, {
      name: opts.name ?? inputPath.split('/').pop() ?? 'Untitled',
    });
    await writeFile(outputPath, `${JSON.stringify(result.document, null, 2)}\n`, 'utf8');
    if (!opts.silent) {
      for (const warning of result.warnings) {
        process.stderr.write(`warn: ${warning}\n`);
      }
    }
    process.stdout.write(`wrote ${outputPath} (${result.stats.nodes} nodes)\n`);
  });

program.parseAsync().catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
