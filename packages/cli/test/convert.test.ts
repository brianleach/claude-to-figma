import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IRDocumentSchema } from '@claude-to-figma/ir';
import { describe, expect, it } from 'vitest';
import { convertHtml } from '../src/convert.js';

const FIXTURES = [
  'simple-divs',
  'nested-divs',
  'text-heavy',
  'external-css',
  'cascade-edge-cases',
  'flex-basic',
  'flex-nested',
] as const;
type Fixture = (typeof FIXTURES)[number];

const FIXTURE_DIR = resolve(__dirname, 'fixtures');

function loadFixture(name: Fixture): string {
  return readFileSync(resolve(FIXTURE_DIR, `${name}.html`), 'utf8');
}

describe('convertHtml', () => {
  for (const name of FIXTURES) {
    describe(name, () => {
      const html = loadFixture(name);
      const result = convertHtml(html, { name: `${name}.html`, baseDir: FIXTURE_DIR });

      it('emits stable IR snapshot', () => {
        expect(result.document).toMatchSnapshot();
      });

      it('produces IR that validates against the zod schema', () => {
        const parsed = IRDocumentSchema.safeParse(result.document);
        if (!parsed.success) {
          throw new Error(
            `IR for ${name} failed validation:\n${parsed.error.issues
              .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
              .join('\n')}`,
          );
        }
      });

      it('records non-empty stats', () => {
        expect(result.stats.nodes).toBeGreaterThan(0);
      });
    });
  }

  it('flattens text-only elements into a single TEXT node', () => {
    const result = convertHtml(
      '<html><body><div style="width:100px;height:50px;"><p style="color: #ff0000; font-size: 14px;">hi</p></div></body></html>',
      { name: 'text-only' },
    );
    const root = result.document.root;
    expect(root.type).toBe('FRAME');
    if (root.type !== 'FRAME') throw new Error('expected FRAME');
    const child = root.children[0];
    if (!child || child.type !== 'FRAME') throw new Error('expected nested FRAME');
    const text = child.children[0];
    if (!text || text.type !== 'TEXT') throw new Error('expected TEXT child');
    expect(text.characters).toBe('hi');
    expect(text.textStyle.fontSize).toBe(14);
  });

  it('parses common color formats', () => {
    const result = convertHtml(
      '<html><body style="width:1px;height:1px;"><p style="color: rgb(255, 0, 0); font-size: 14px;">x</p></body></html>',
      { name: 'colors' },
    );
    const root = result.document.root;
    if (root.type !== 'FRAME') throw new Error('expected FRAME');
    const text = root.children[0];
    if (!text || text.type !== 'TEXT') throw new Error('expected TEXT');
    const fill = text.fills[0];
    if (!fill || fill.type !== 'SOLID') throw new Error('expected SOLID fill');
    expect(fill.color.r).toBeCloseTo(1);
    expect(fill.color.g).toBeCloseTo(0);
    expect(fill.color.b).toBeCloseTo(0);
  });
});
