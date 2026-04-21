/**
 * Small fidelity fixes from gaps #5, #6, and #7 of
 * docs/quality-gap-report.md — em letter-spacing, multi-path SVG, and
 * aspect-ratio.
 */

import type { IRNode, VectorNode } from '@claude-to-figma/ir';
import { describe, expect, it } from 'vitest';
import { convertHtml } from '../src/convert.js';
import { parseAspectRatio, parseLetterSpacing } from '../src/style.js';

function findVectorByName(node: IRNode, name: string): VectorNode {
  if (node.type === 'VECTOR' && node.name === name) return node;
  if (node.type === 'FRAME') {
    for (const c of node.children) {
      try {
        return findVectorByName(c, name);
      } catch {
        // keep searching
      }
    }
  }
  throw new Error(`no VECTOR named "${name}"`);
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
  it('concatenates every <path d> in the SVG, not just the first', () => {
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

    const vec = findVectorByName(document.root, 'icon');
    // All three path `d`s should be present (separated by whitespace).
    expect(vec.path).toContain('M 0 0 L 10 10');
    expect(vec.path).toContain('M 5 5 L 15 15');
    expect(vec.path).toContain('M 2 2 L 8 8');
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

    const vec = findVectorByName(document.root, 'grouped');
    expect(vec.path).toContain('M 0 0');
    expect(vec.path).toContain('M 5 5');
  });

  it('still emits a warning when no <path d> exists', () => {
    const result = convertHtml(
      `<html><body><svg id="empty"><circle cx="5" cy="5" r="3"/></svg></body></html>`,
      { name: 'no-path' },
    );
    expect(result.warnings.some((w) => w.includes('no <path d'))).toBe(true);
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
      if (n.name === id) return n;
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
