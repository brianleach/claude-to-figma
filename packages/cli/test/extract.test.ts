/**
 * Token-extraction tests — covers V-M7-EXTRACTION-TESTS.
 *
 * Pure-function tests against the extraction modules plus end-to-end
 * checks through `convertHtml`.
 */

import {
  type Color,
  type FrameNode,
  type IRDocument,
  type IRNode,
  IR_VERSION,
  type Paint,
  type TextNode,
  type TextStyle,
} from '@claude-to-figma/ir';
import { describe, expect, it } from 'vitest';
import { convertHtml } from '../src/convert.js';
import {
  applyPaintStyles,
  applyTextStyles,
  colorKey,
  extractPaintStyles,
  extractTextStyles,
  extractTokens,
  hexOf,
  textStyleKey,
} from '../src/extract/index.js';

// ---------------------------------------------------------------------------
// Tiny IR builders
// ---------------------------------------------------------------------------

let counter = 0;
const id = () => `n-${++counter}`;

function solid(r: number, g: number, b: number, a = 1): Paint {
  return {
    type: 'SOLID',
    color: { r, g, b, a },
    opacity: 1,
    visible: true,
  };
}

function frame(opts: { name?: string; fills?: Paint[]; children?: IRNode[] } = {}): FrameNode {
  return {
    type: 'FRAME',
    id: id(),
    name: opts.name ?? 'frame',
    geometry: { x: 0, y: 0, width: 100, height: 100 },
    opacity: 1,
    visible: true,
    fills: opts.fills ?? [],
    strokes: [],
    effects: [],
    children: opts.children ?? [],
  };
}

function text(style: TextStyle, fills: Paint[] = []): TextNode {
  return {
    type: 'TEXT',
    id: id(),
    name: 'text',
    geometry: { x: 0, y: 0, width: 80, height: 20 },
    opacity: 1,
    visible: true,
    characters: 'x',
    textStyle: style,
    fills,
  };
}

const baseTextStyle = (overrides: Partial<TextStyle> = {}): TextStyle => ({
  fontFamily: 'Inter',
  fontStyle: 'Regular',
  fontSize: 16,
  lineHeight: { unit: 'AUTO' },
  letterSpacing: { unit: 'PIXELS', value: 0 },
  textAlign: 'LEFT',
  textDecoration: 'NONE',
  textCase: 'ORIGINAL',
  ...overrides,
});

function doc(root: FrameNode): IRDocument {
  return {
    version: IR_VERSION,
    name: 'test',
    root,
    styles: { paints: [], texts: [] },
    components: [],
    fonts: [],
    images: [],
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

describe('colorKey + hexOf', () => {
  it('hexOf converts 0–1 RGB to a 6-char lowercase hex', () => {
    expect(hexOf({ r: 1, g: 0, b: 0, a: 1 })).toBe('ff0000');
    expect(hexOf({ r: 0x25 / 255, g: 0x63 / 255, b: 0xeb / 255, a: 1 })).toBe('2563eb');
  });

  it('colorKey is identical for the same color from different float reps', () => {
    const a: Color = { r: 0.10000001, g: 0.2, b: 0.3, a: 1 };
    const b: Color = { r: 0.1, g: 0.2, b: 0.3, a: 1 };
    expect(colorKey(a)).toBe(colorKey(b));
  });

  it('colorKey distinguishes alpha', () => {
    const opaque: Color = { r: 1, g: 0, b: 0, a: 1 };
    const half: Color = { r: 1, g: 0, b: 0, a: 0.5 };
    expect(colorKey(opaque)).not.toBe(colorKey(half));
  });
});

// ---------------------------------------------------------------------------
// Paint extraction
// ---------------------------------------------------------------------------

describe('extractPaintStyles', () => {
  it('returns no styles when the tree has no solid fills', () => {
    const result = extractPaintStyles(doc(frame({})));
    expect(result.styles).toEqual([]);
  });

  it('dedupes the same color appearing in many places', () => {
    const red = solid(1, 0, 0);
    const root = frame({
      fills: [red],
      children: [frame({ fills: [red] }), frame({ fills: [red] })],
    });
    const result = extractPaintStyles(doc(root));
    expect(result.styles).toHaveLength(1);
  });

  it('special-cases #ffffff → color/white', () => {
    const root = frame({ fills: [solid(1, 1, 1)] });
    const result = extractPaintStyles(doc(root));
    expect(result.styles[0]?.id).toBe('color/white');
  });

  it('special-cases #000000 → color/black', () => {
    const root = frame({ fills: [solid(0, 0, 0)] });
    const result = extractPaintStyles(doc(root));
    expect(result.styles[0]?.id).toBe('color/black');
  });

  it('promotes the most-frequent neutral background to surface/primary (ADR 0010)', () => {
    // Low-chroma colours go to surface/ink/border by dominant role.
    const cream = solid(0xf0 / 255, 0xeb / 255, 0xe0 / 255); // near-neutral
    const otherNeutral = solid(0xd4 / 255, 0xce / 255, 0xbf / 255);
    const root = frame({
      fills: [cream],
      children: [
        frame({ fills: [cream] }),
        frame({ fills: [cream] }),
        frame({ fills: [otherNeutral] }),
      ],
    });
    const result = extractPaintStyles(doc(root));
    const ids = result.styles.map((s) => s.id);
    expect(ids).toContain('surface/primary');
    const primary = result.styles.find((s) => s.id === 'surface/primary');
    expect(primary?.paints[0]?.type).toBe('SOLID');
    if (primary?.paints[0]?.type === 'SOLID') {
      expect(hexOf(primary.paints[0].color)).toBe('f0ebe0');
    }
  });

  it('saturated colours go to brand/* regardless of role', () => {
    // Pure red on a frame fill — high chroma → brand, not surface.
    const red = solid(1, 0, 0);
    const root = frame({ fills: [red], children: [frame({ fills: [red] })] });
    const result = extractPaintStyles(doc(root));
    const ids = result.styles.map((s) => s.id);
    expect(ids).toContain('brand/primary');
    expect(ids).not.toContain('surface/primary');
  });

  it('falls back to color/{hex} past the slot count in a role', () => {
    // Four near-neutrals, three surface slots, fourth → color/{hex}.
    const a = solid(0.95, 0.93, 0.88);
    const b = solid(0.85, 0.83, 0.78);
    const c = solid(0.75, 0.73, 0.68);
    const d = solid(0.65, 0.63, 0.58);
    const root = frame({
      children: [a, b, c, d].map((col) => frame({ fills: [col] })),
    });
    const result = extractPaintStyles(doc(root));
    const ids = result.styles.map((s) => s.id);
    expect(ids).toContain('surface/primary');
    expect(ids).toContain('surface/secondary');
    expect(ids).toContain('surface/tertiary');
    expect(ids.some((i) => /^color\/[0-9a-f]{6}$/.test(i))).toBe(true);
  });

  it('alpha < 1 appends an alpha hex pair to the fallback name', () => {
    // Four near-neutrals fill the surface slots, then the 4th alpha value
    // falls to color/{hex}{alpha}.
    const reps = (paint: Paint, n: number): IRNode[] =>
      Array.from({ length: n }, () => frame({ fills: [paint] }));
    const root = frame({
      children: [
        ...reps(solid(0.95, 0.93, 0.88), 5),
        ...reps(solid(0.85, 0.83, 0.78), 5),
        ...reps(solid(0.75, 0.73, 0.68), 5),
        frame({ fills: [solid(0x12 / 255, 0x34 / 255, 0x56 / 255, 0.5)] }),
      ],
    });
    const result = extractPaintStyles(doc(root));
    const ids = result.styles.map((s) => s.id);
    // Saturated navy (#123456 has chroma 0.27) goes to brand — alpha lands there too.
    const brandMatch = ids.find((i) => i.startsWith('brand/') && i === 'brand/primary');
    expect(brandMatch).toBeDefined();
  });

  it('brand classification is saturation-based, not multi-role', () => {
    // Dark near-neutral used on FRAME bg + TEXT fill + a stroke — NOT brand
    // (chroma 0.02), routes to its dominant-role bucket (ink, since more
    // text uses than bg uses).
    const darkInk = solid(0x1c / 255, 0x1a / 255, 0x16 / 255);
    const root = frame({
      fills: [darkInk],
      children: [
        text(baseTextStyle(), [darkInk]),
        text(baseTextStyle(), [darkInk]),
        text(baseTextStyle(), [darkInk]),
      ],
    });
    const result = extractPaintStyles(doc(root));
    const ids = result.styles.map((s) => s.id);
    expect(ids).toContain('ink/primary');
    expect(ids).not.toContain('brand/primary');
  });

  it('text-only neutral colours go to ink/* bucket', () => {
    const dark = solid(0.1, 0.1, 0.1);
    const root = frame({
      children: [text(baseTextStyle(), [dark]), text(baseTextStyle(), [dark])],
    });
    const result = extractPaintStyles(doc(root));
    const ids = result.styles.map((s) => s.id);
    expect(ids).toContain('ink/primary');
  });
});

describe('applyPaintStyles', () => {
  it('stamps fillStyleId on FRAME and TEXT nodes whose first solid fill matches', () => {
    // Near-neutral cream on FRAME only → surface/primary.
    const cream = solid(0xf0 / 255, 0xeb / 255, 0xe0 / 255);
    const root = frame({
      fills: [cream],
      children: [frame({ fills: [cream] })],
    });
    const ext = extractPaintStyles(doc(root));
    const updated = applyPaintStyles(doc(root), ext.styleIdByColorKey);
    const r = updated.root as FrameNode;
    expect(r.fillStyleId).toBe('surface/primary');
    const child = r.children[0] as FrameNode;
    expect(child.fillStyleId).toBe('surface/primary');
  });

  it('also stamps fillStyleId on nodes inside component masters', () => {
    const cream = solid(0xf0 / 255, 0xeb / 255, 0xe0 / 255);
    const root = frame({ fills: [cream] });
    const d: IRDocument = {
      ...doc(root),
      components: [
        {
          id: 'card',
          name: 'Card',
          root: frame({ fills: [cream] }),
        },
      ],
    };
    const ext = extractPaintStyles(d);
    const updated = applyPaintStyles(d, ext.styleIdByColorKey);
    expect((updated.components[0]?.root as FrameNode).fillStyleId).toBe('surface/primary');
  });
});

// ---------------------------------------------------------------------------
// Text-style extraction
// ---------------------------------------------------------------------------

describe('extractTextStyles', () => {
  it('returns no styles when the tree has no TEXT nodes', () => {
    const result = extractTextStyles(doc(frame({})));
    expect(result.styles).toEqual([]);
  });

  it('dedupes identical text styles from different TEXT nodes', () => {
    const ts = baseTextStyle({ fontSize: 16 });
    const root = frame({
      children: [text(ts), text(ts), text(ts)],
    });
    const result = extractTextStyles(doc(root));
    expect(result.styles).toHaveLength(1);
  });

  it('classifies size 32+ as heading/xl', () => {
    const root = frame({ children: [text(baseTextStyle({ fontSize: 32 }))] });
    const result = extractTextStyles(doc(root));
    expect(result.styles[0]?.id).toBe('heading/xl');
  });

  it('classifies size 24 as heading/lg', () => {
    const root = frame({ children: [text(baseTextStyle({ fontSize: 24 }))] });
    const result = extractTextStyles(doc(root));
    expect(result.styles[0]?.id).toBe('heading/lg');
  });

  it('classifies size 18+ as heading/md', () => {
    const root = frame({ children: [text(baseTextStyle({ fontSize: 20 }))] });
    const result = extractTextStyles(doc(root));
    expect(result.styles[0]?.id).toBe('heading/md');
  });

  it('classifies bold-ish 16px as heading/md (weight nudges into heading)', () => {
    const root = frame({
      children: [text(baseTextStyle({ fontSize: 16, fontStyle: 'Semi Bold' }))],
    });
    const result = extractTextStyles(doc(root));
    expect(result.styles[0]?.id).toBe('heading/md');
  });

  it('classifies plain 16px as body/lg', () => {
    const root = frame({ children: [text(baseTextStyle({ fontSize: 16 }))] });
    const result = extractTextStyles(doc(root));
    expect(result.styles[0]?.id).toBe('body/lg');
  });

  it('classifies sub-12 as caption', () => {
    const root = frame({ children: [text(baseTextStyle({ fontSize: 10 }))] });
    const result = extractTextStyles(doc(root));
    expect(result.styles[0]?.id).toBe('caption');
  });

  it('suffixes colliding bucket members with weight slug (no plain bucket)', () => {
    // Two distinct styles in the same bucket (body/md), same weight but
    // different line-height → each gets `body/md-regular`, `body/md-regular-2`.
    const a = baseTextStyle({ fontSize: 14 });
    const b = baseTextStyle({ fontSize: 14, lineHeight: { unit: 'PERCENT', value: 200 } });
    const root = frame({ children: [text(a), text(a), text(b)] });
    const result = extractTextStyles(doc(root));
    const ids = result.styles.map((s) => s.id).sort();
    // No plain `body/md` — every collider is suffixed.
    expect(ids).not.toContain('body/md');
    expect(ids.some((i) => i.startsWith('body/md-'))).toBe(true);
  });

  it('different weights in the same bucket each get their weight suffix', () => {
    const medium = baseTextStyle({ fontSize: 18, fontStyle: 'Medium' });
    const bold = baseTextStyle({ fontSize: 18, fontStyle: 'Bold' });
    const root = frame({ children: [text(medium), text(bold)] });
    const result = extractTextStyles(doc(root));
    const ids = result.styles.map((s) => s.id).sort();
    expect(ids).toContain('heading/md-bold');
    expect(ids).toContain('heading/md-medium');
  });
});

describe('applyTextStyles', () => {
  it('stamps textStyleId on every TEXT node', () => {
    const ts = baseTextStyle({ fontSize: 16 });
    const root = frame({ children: [text(ts), text(ts)] });
    const ext = extractTextStyles(doc(root));
    const updated = applyTextStyles(doc(root), ext.styleIdByKey);
    const ts1 = (updated.root as FrameNode).children[0] as TextNode;
    const ts2 = (updated.root as FrameNode).children[1] as TextNode;
    expect(ts1.textStyleId).toBe('body/lg');
    expect(ts2.textStyleId).toBe('body/lg');
  });
});

// ---------------------------------------------------------------------------
// textStyleKey
// ---------------------------------------------------------------------------

describe('textStyleKey', () => {
  it('returns the same key for identical styles', () => {
    const a = baseTextStyle();
    const b = baseTextStyle();
    expect(textStyleKey(a)).toBe(textStyleKey(b));
  });

  it('returns different keys when font size differs', () => {
    expect(textStyleKey(baseTextStyle({ fontSize: 16 }))).not.toBe(
      textStyleKey(baseTextStyle({ fontSize: 17 })),
    );
  });
});

// ---------------------------------------------------------------------------
// extractTokens (orchestrator) end-to-end
// ---------------------------------------------------------------------------

describe('extractTokens', () => {
  it('populates both registries and stamps ids on the tree in one pass', () => {
    const ts = baseTextStyle({ fontSize: 14 });
    // Saturated blue → brand/primary (chroma 1.0).
    const blue = solid(0, 0, 1);
    const root = frame({
      fills: [blue],
      children: [text(ts, [blue])],
    });
    const result = extractTokens(doc(root));
    expect(result.stats.paints).toBe(1);
    expect(result.stats.texts).toBe(1);
    const r = result.document.root as FrameNode;
    expect(r.fillStyleId).toBe('brand/primary');
    const t = r.children[0] as TextNode;
    expect(t.textStyleId).toBe('body/md');
    expect(t.fillStyleId).toBe('brand/primary');
  });
});

// ---------------------------------------------------------------------------
// End-to-end through convertHtml
// ---------------------------------------------------------------------------

describe('extraction through convertHtml', () => {
  const html = `
    <html><body style="margin:0;width:300px;height:200px;background:#f5f5f7;">
      <div style="padding:16px;background:#2563eb;color:#ffffff;font-size:18px;font-weight:600;">Hello</div>
    </body></html>
  `;

  it('emits paint and text styles in the registry', () => {
    const { document, stats } = convertHtml(html, { name: 'extract' });
    expect(stats.paintStyles).toBeGreaterThanOrEqual(2);
    expect(stats.textStyles).toBeGreaterThanOrEqual(1);
    expect(document.styles.paints.length).toBe(stats.paintStyles);
    expect(document.styles.texts.length).toBe(stats.textStyles);
  });

  it('every paint style has a unique id', () => {
    const { document } = convertHtml(html, { name: 'extract' });
    const ids = document.styles.paints.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
