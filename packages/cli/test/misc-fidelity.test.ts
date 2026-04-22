/**
 * Small fidelity fixes from gaps #5, #6, and #7 of
 * docs/quality-gap-report.md — em letter-spacing, multi-path SVG, and
 * aspect-ratio.
 */

import type { IRNode, VectorNode } from '@claude-to-figma/ir';
import { describe, expect, it } from 'vitest';
import { convertHtml } from '../src/convert.js';
import { parseAspectRatio, parseLetterSpacing } from '../src/style.js';

function findNodeByName(node: IRNode, name: string): IRNode {
  if (node.name.toLowerCase() === name.toLowerCase()) return node;
  if (node.type === 'FRAME') {
    for (const c of node.children) {
      try {
        return findNodeByName(c, name);
      } catch {
        // keep searching
      }
    }
  }
  throw new Error(`no node named "${name}"`);
}

/**
 * Collect every VECTOR descendant (including self) — multi-shape SVGs now
 * emit a FRAME wrapping one VECTOR per shape, so walking is needed.
 */
function collectVectors(node: IRNode, out: VectorNode[] = []): VectorNode[] {
  if (node.type === 'VECTOR') out.push(node);
  if (node.type === 'FRAME') for (const c of node.children) collectVectors(c, out);
  return out;
}

describe('em letter-spacing (gap #5)', () => {
  it('converts -0.025em to -2.5%', () => {
    expect(parseLetterSpacing('-0.025em')).toEqual({ unit: 'PERCENT', value: -2.5 });
  });

  it('converts positive em values too', () => {
    expect(parseLetterSpacing('0.1em')).toEqual({ unit: 'PERCENT', value: 10 });
  });

  it('still handles px, %, normal, and bare numbers', () => {
    expect(parseLetterSpacing('2px')).toEqual({ unit: 'PIXELS', value: 2 });
    expect(parseLetterSpacing('5%')).toEqual({ unit: 'PERCENT', value: 5 });
    expect(parseLetterSpacing('normal')).toEqual({ unit: 'PIXELS', value: 0 });
  });

  it('flows end-to-end through convertHtml', () => {
    const { document } = convertHtml(
      `<html><body><h1 style="font-size:48px;letter-spacing:-0.025em;">Hello</h1></body></html>`,
      { name: 'em-tracking' },
    );
    // Walk to the TEXT node and check its textStyle.letterSpacing.
    function findText(n: IRNode): IRNode | undefined {
      if (n.type === 'TEXT') return n;
      if (n.type === 'FRAME')
        for (const c of n.children) {
          const hit = findText(c);
          if (hit) return hit;
        }
      return undefined;
    }
    const hit = findText(document.root);
    if (!hit || hit.type !== 'TEXT') throw new Error('no TEXT node');
    expect(hit.textStyle.letterSpacing).toEqual({ unit: 'PERCENT', value: -2.5 });
  });
});

describe('multi-path SVG (gap #6)', () => {
  it('emits one VECTOR per <path> inside a wrapping FRAME', () => {
    const { document } = convertHtml(
      `<html><body>
         <svg id="icon" width="24" height="24">
           <path d="M0 0L10 10"/>
           <path d="M5 5L15 15"/>
           <path d="M2 2L8 8"/>
         </svg>
       </body></html>`,
      { name: 'multi-path' },
    );

    const wrapper = findNodeByName(document.root, 'icon');
    expect(wrapper.type).toBe('FRAME');
    const vectors = collectVectors(wrapper);
    expect(vectors).toHaveLength(3);
    expect(vectors[0]?.path).toContain('M 0 0 L 10 10');
    expect(vectors[1]?.path).toContain('M 5 5 L 15 15');
    expect(vectors[2]?.path).toContain('M 2 2 L 8 8');
  });

  it('walks into <g> groups', () => {
    const { document } = convertHtml(
      `<html><body>
         <svg id="grouped" width="24" height="24">
           <g><path d="M0 0L10 10"/></g>
           <g><path d="M5 5L15 15"/></g>
         </svg>
       </body></html>`,
      { name: 'grouped' },
    );

    const wrapper = findNodeByName(document.root, 'grouped');
    const vectors = collectVectors(wrapper);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.path).toContain('M 0 0');
    expect(vectors[1]?.path).toContain('M 5 5');
  });

  it('synthesises path data from basic shapes (circle, rect, line, polygon)', () => {
    const { document } = convertHtml(
      `<html><body>
         <svg id="shapes" width="50" height="50">
           <circle cx="25" cy="25" r="10"/>
           <rect x="0" y="0" width="20" height="20"/>
           <line x1="0" y1="0" x2="50" y2="50"/>
           <polygon points="5,5 10,10 5,15"/>
         </svg>
       </body></html>`,
      { name: 'shapes' },
    );
    const wrapper = findNodeByName(document.root, 'shapes');
    const vectors = collectVectors(wrapper);
    expect(vectors).toHaveLength(4);
    // Circle: four cubics (Figma rejects `A` — arcs lowered to cubics).
    expect(vectors[0]?.path).toMatch(/^M 35 25 C /);
    expect(vectors[0]?.path).not.toMatch(/ A /);
    // Rect uses L (no H/V — Figma also rejects H/V).
    expect(vectors[1]?.path).toMatch(/L 20 0 L 20 20/);
    // Line: M-to-L.
    expect(vectors[2]?.path).toMatch(/L 50 50/);
    // Polygon: closed.
    expect(vectors[3]?.path).toContain('Z');
  });

  it('carries per-shape fill / stroke / stroke-width through the IR', () => {
    const { document } = convertHtml(
      `<html><body>
         <svg id="styled" width="24" height="24" fill="none" stroke="#1C1A16" stroke-width="1.5">
           <rect x="3" y="3" width="20" height="16" rx="2"/>
           <circle cx="6" cy="5" r="0.7" fill="#1C1A16" stroke="none"/>
         </svg>
       </body></html>`,
      { name: 'styled-svg' },
    );
    const wrapper = findNodeByName(document.root, 'styled');
    const vectors = collectVectors(wrapper);
    expect(vectors).toHaveLength(2);
    // Rect inherits svg's stroke + stroke-width; fill stays "none".
    expect(vectors[0]?.strokes).toHaveLength(1);
    expect(vectors[0]?.strokes[0]?.weight).toBe(1.5);
    expect(vectors[0]?.fills).toHaveLength(0);
    // Circle overrides: fill set, stroke explicitly "none".
    expect(vectors[1]?.fills).toHaveLength(1);
    expect(vectors[1]?.strokes).toHaveLength(0);
  });

  it('warns only when the SVG has no convertible geometry at all', () => {
    const result = convertHtml(`<html><body><svg id="empty"><defs></defs></svg></body></html>`, {
      name: 'no-geometry',
    });
    expect(result.warnings.some((w) => w.includes('no <path d'))).toBe(true);
  });
});

describe('SVG path tokenizer + arc lowering', () => {
  function getPath(html: string, id = 'icon'): string {
    const { document } = convertHtml(`<html><body>${html}</body></html>`, { name: id });
    const wrapper = findNodeByName(document.root, id);
    const vectors = collectVectors(wrapper);
    return vectors[0]?.path ?? '';
  }

  it('splits sign-concatenated numbers (`0-2.53` → `0 -2.53`)', () => {
    const path = getPath(
      `<svg id="signs" width="10" height="10"><path d="M0 0l0-2.53l3.5 0"/></svg>`,
      'signs',
    );
    expect(path).toContain('-2.53');
    // No `A` since no arcs; also no glued tokens like `0-2.53`.
    expect(path).not.toMatch(/\d-\d/);
  });

  it('splits chained decimal numbers (`.4.07.55` → `.4 .07 .55`)', () => {
    // 4 numeric args → 2 implicit `l` lineto pairs. Figma's parser rejects
    // glued decimals; the tokenizer must emit them as separate tokens.
    const path = getPath(
      `<svg id="decimals" width="10" height="10"><path d="M0 0l.4.07.55.08"/></svg>`,
      'decimals',
    );
    // Each implicit chained pair gets its own `l` emitted (valid SVG), and
    // every number ends up space-separated rather than glued.
    expect(path).toMatch(/l \.4 \.07 l \.55 \.08/);
  });

  it('accepts numbers in exponent form (`1e-3`)', () => {
    const path = getPath(
      `<svg id="exp" width="10" height="10"><path d="M0 0 L1e1 1.5e-1"/></svg>`,
      'exp',
    );
    // Tokenizer keeps exponent notation intact — `1e1` and `1.5e-1` are each
    // one token, not split into `1`, `e1`, `1.5`, `e`, `-1`.
    expect(path).toMatch(/L 1e1 1\.5e-1/);
  });

  it('lowers absolute `A` commands to cubic Béziers', () => {
    // Quarter arc from (10,0) to (0,10) with rx=ry=10, sweep=1 (CW).
    const path = getPath(
      `<svg id="arc" width="20" height="20"><path d="M10 0 A10 10 0 0 1 0 10"/></svg>`,
      'arc',
    );
    // No raw `A` survives; endpoint lands on (0,10) within float tolerance.
    expect(path).not.toMatch(/ A /);
    expect(path).toMatch(/^M 10 0 C /);
    const match = path.match(/C [^C]+$/);
    expect(match).toBeTruthy();
    const tail = match?.[0]?.split(/\s+/) ?? [];
    const endX = Number(tail[tail.length - 2]);
    const endY = Number(tail[tail.length - 1]);
    expect(endX).toBeCloseTo(0, 5);
    expect(endY).toBeCloseTo(10, 5);
  });

  it('lowers relative `a` commands (endpoint relative to current point)', () => {
    const path = getPath(
      `<svg id="rel-arc" width="20" height="20"><path d="M10 0 a10 10 0 0 1 -10 10"/></svg>`,
      'rel-arc',
    );
    expect(path).not.toMatch(/ a /);
    const match = path.match(/C [^C]+$/);
    expect(match).toBeTruthy();
    const tail = match?.[0]?.split(/\s+/) ?? [];
    const endX = Number(tail[tail.length - 2]);
    const endY = Number(tail[tail.length - 1]);
    expect(endX).toBeCloseTo(0, 5);
    expect(endY).toBeCloseTo(10, 5);
  });

  it('splits a >π/2 arc into multiple cubic segments', () => {
    // Half-circle: sweep ≈ π, should produce ≥ 2 cubic segments.
    const path = getPath(
      `<svg id="half" width="20" height="20"><path d="M10 0 A10 10 0 0 1 -10 0"/></svg>`,
      'half',
    );
    const cubicCount = (path.match(/C /g) ?? []).length;
    expect(cubicCount).toBeGreaterThanOrEqual(2);
  });

  it('degenerates a zero-radius arc to a straight line', () => {
    const path = getPath(
      `<svg id="zero-r" width="20" height="20"><path d="M0 0 A0 0 0 0 1 10 10"/></svg>`,
      'zero-r',
    );
    expect(path).not.toMatch(/ A /);
    // Zero-radius collapses to one cubic whose control points coincide with
    // the endpoints — functionally a straight line.
    expect(path).toMatch(/^M 0 0 C 0 0 10 10 10 10/);
  });
});

describe('aspect-ratio parsing (gap #7)', () => {
  it('parses `<num> / <num>`', () => {
    expect(parseAspectRatio('1 / 1')).toBeCloseTo(1);
    expect(parseAspectRatio('16 / 9')).toBeCloseTo(16 / 9);
    expect(parseAspectRatio('1 / 0.92')).toBeCloseTo(1 / 0.92);
  });

  it('parses a bare number', () => {
    expect(parseAspectRatio('1.5')).toBe(1.5);
  });

  it('returns undefined for auto / invalid', () => {
    expect(parseAspectRatio('auto')).toBeUndefined();
    expect(parseAspectRatio('')).toBeUndefined();
    expect(parseAspectRatio(undefined)).toBeUndefined();
    expect(parseAspectRatio('0 / 0')).toBeUndefined();
    expect(parseAspectRatio('-1')).toBeUndefined();
  });

  it('flows into yoga-computed geometry (height derived from width + ratio)', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:600px;">
         <div id="box" style="width:300px;aspect-ratio:3/1;"></div>
       </body></html>`,
      { name: 'aspect-ratio' },
    ).document;
    function findById(n: IRNode, id: string): IRNode | undefined {
      if (n.name.toLowerCase() === id.toLowerCase()) return n;
      if (n.type === 'FRAME')
        for (const c of n.children) {
          const hit = findById(c, id);
          if (hit) return hit;
        }
      return undefined;
    }
    const box = findById(ir.root, 'box');
    if (!box || box.type !== 'FRAME') throw new Error('no frame "box"');
    expect(box.geometry?.width).toBe(300);
    // 300 / 3 = 100 height at a 3:1 aspect ratio.
    expect(box.geometry?.height).toBe(100);
  });
});
