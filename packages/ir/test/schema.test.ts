import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ColorSchema,
  IRDocumentSchema,
  IRNodeSchema,
  IR_VERSION,
  PaintSchema,
  TextStyleSchema,
} from '../src/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(here, '../examples/sample.json');

describe('primitives', () => {
  it('accepts valid RGBA color', () => {
    expect(() => ColorSchema.parse({ r: 0.1, g: 0.2, b: 0.3, a: 0.5 })).not.toThrow();
  });

  it('defaults alpha to 1', () => {
    const c = ColorSchema.parse({ r: 0, g: 0, b: 0 });
    expect(c.a).toBe(1);
  });

  it('rejects out-of-range color channels', () => {
    expect(() => ColorSchema.parse({ r: 1.5, g: 0, b: 0 })).toThrow();
    expect(() => ColorSchema.parse({ r: -0.1, g: 0, b: 0 })).toThrow();
  });

  it('parses solid and image paints through the discriminated union', () => {
    expect(PaintSchema.parse({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } })).toMatchObject({
      type: 'SOLID',
    });
    expect(PaintSchema.parse({ type: 'IMAGE', imageRef: 'img-1' })).toMatchObject({
      type: 'IMAGE',
      imageRef: 'img-1',
    });
  });

  it('rejects unknown paint types', () => {
    expect(() => PaintSchema.parse({ type: 'GRADIENT_LINEAR' })).toThrow();
  });
});

describe('text style', () => {
  it('applies defaults for line height, letter spacing, align', () => {
    const s = TextStyleSchema.parse({ fontFamily: 'Inter', fontSize: 14 });
    expect(s.fontStyle).toBe('Regular');
    expect(s.lineHeight).toEqual({ unit: 'AUTO' });
    expect(s.letterSpacing).toEqual({ unit: 'PIXELS', value: 0 });
    expect(s.textAlign).toBe('LEFT');
  });

  it('rejects zero or negative font size', () => {
    expect(() => TextStyleSchema.parse({ fontFamily: 'Inter', fontSize: 0 })).toThrow();
    expect(() => TextStyleSchema.parse({ fontFamily: 'Inter', fontSize: -1 })).toThrow();
  });
});

describe('nodes', () => {
  it('parses a minimal frame node', () => {
    const node = IRNodeSchema.parse({
      type: 'FRAME',
      id: 'root',
      name: 'Root',
      geometry: { x: 0, y: 0, width: 100, height: 100 },
    });
    expect(node.type).toBe('FRAME');
  });

  it('parses a text node with inline style', () => {
    const node = IRNodeSchema.parse({
      type: 'TEXT',
      id: 't1',
      characters: 'Hello',
      textStyle: { fontFamily: 'Inter', fontSize: 16 },
    });
    expect(node.type).toBe('TEXT');
    if (node.type === 'TEXT') {
      expect(node.characters).toBe('Hello');
    }
  });

  it('rejects frame without discriminant', () => {
    expect(() =>
      IRNodeSchema.parse({ id: 'x', geometry: { x: 0, y: 0, width: 1, height: 1 } }),
    ).toThrow();
  });

  it('rejects empty id', () => {
    expect(() =>
      IRNodeSchema.parse({
        type: 'FRAME',
        id: '',
      }),
    ).toThrow();
  });

  it('supports recursive children in a frame', () => {
    const parsed = IRNodeSchema.parse({
      type: 'FRAME',
      id: 'outer',
      children: [
        {
          type: 'FRAME',
          id: 'inner',
          children: [
            {
              type: 'TEXT',
              id: 'txt',
              characters: 'hi',
              textStyle: { fontFamily: 'Inter', fontSize: 12 },
            },
          ],
        },
      ],
    });
    if (parsed.type === 'FRAME') {
      const inner = parsed.children[0];
      expect(inner?.type).toBe('FRAME');
    }
  });

  it('parses an instance node with override', () => {
    const node = IRNodeSchema.parse({
      type: 'INSTANCE',
      id: 'inst-1',
      componentId: 'card',
      overrides: { 'card.title': { characters: 'Overridden' } },
    });
    expect(node.type).toBe('INSTANCE');
  });
});

describe('document root', () => {
  it('rejects documents with the wrong version', () => {
    expect(() =>
      IRDocumentSchema.parse({
        version: 999,
        root: { type: 'FRAME', id: 'root' },
      }),
    ).toThrow();
  });

  it('accepts a minimal document', () => {
    const doc = IRDocumentSchema.parse({
      version: IR_VERSION,
      root: { type: 'FRAME', id: 'root' },
    });
    expect(doc.styles.paints).toEqual([]);
    expect(doc.components).toEqual([]);
    expect(doc.fonts).toEqual([]);
  });
});

describe('sample.json', () => {
  it('validates against the document schema', () => {
    const raw = JSON.parse(readFileSync(samplePath, 'utf8'));
    const doc = IRDocumentSchema.parse(raw);
    expect(doc.version).toBe(IR_VERSION);
    expect(doc.root.type).toBe('FRAME');
    expect(doc.components.length).toBeGreaterThan(0);
    expect(doc.fonts.length).toBeGreaterThan(0);
  });

  it('has a card component referenced by 3 instances', () => {
    const raw = JSON.parse(readFileSync(samplePath, 'utf8'));
    const doc = IRDocumentSchema.parse(raw);
    const card = doc.components.find((c) => c.id === 'card');
    expect(card).toBeDefined();

    const instances: string[] = [];
    const walk = (node: ReturnType<typeof IRNodeSchema.parse>): void => {
      if (node.type === 'INSTANCE') {
        instances.push(node.componentId);
      }
      if (node.type === 'FRAME') {
        for (const child of node.children) walk(child);
      }
    };
    walk(doc.root);
    const cardInstances = instances.filter((id) => id === 'card');
    expect(cardInstances.length).toBe(3);
  });
});
