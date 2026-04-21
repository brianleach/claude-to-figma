/**
 * Text measurement plumbing (ADR 0006).
 *
 * Verifies that when `convertHtml` is handed a `textMeasurements` map,
 * TEXT nodes whose source element carries a matching `data-c2f-mid`
 * stamp get their geometry from the map — bypassing the
 * `0.55 × fontSize × chars` heuristic in `layout/measure.ts`.
 *
 * We assert on height, not width. A block-level <p> inside a stretching
 * flex column gets its cross-axis (width) stretched to parent regardless
 * of what the measure function returns — that's yoga doing flex layout,
 * not the measure function misbehaving. Height comes from the measure
 * function's return value and is the signal that our path ran.
 */

import type { IRNode, TextNode } from '@claude-to-figma/ir';
import { describe, expect, it } from 'vitest';
import { convertHtml } from '../src/convert.js';

function findText(node: IRNode, characters: string): TextNode {
  if (node.type === 'TEXT' && node.characters === characters) return node;
  if (node.type === 'FRAME') {
    for (const c of node.children) {
      try {
        return findText(c, characters);
      } catch {
        // keep searching
      }
    }
  }
  throw new Error(`no TEXT node with characters "${characters}"`);
}

describe('text measurement plumbing', () => {
  it('uses the measurements map when an element carries a matching data-c2f-mid', () => {
    // Measured height of 48 is deliberately outside the heuristic's range
    // (auto line-height at 16px → ceil(19.2) = 20 per line) so the two
    // paths are easy to tell apart.
    const measurements = new Map([['m0', { width: 240, height: 48, lineCount: 2 }]]);

    const { document } = convertHtml(
      `<html><body style="margin:0;width:600px;height:200px;">
         <p data-c2f-mid="m0" style="font-size:16px;">Hello world</p>
       </body></html>`,
      { name: 'measured', textMeasurements: measurements },
    );

    const text = findText(document.root, 'Hello world');
    expect(text.geometry?.height).toBe(48);
  });

  it('falls back to the heuristic when no measurements are passed', () => {
    const { document } = convertHtml(
      `<html><body style="margin:0;width:600px;height:200px;">
         <p data-c2f-mid="m0" style="font-size:16px;">Hello world</p>
       </body></html>`,
      { name: 'heuristic' },
    );

    const text = findText(document.root, 'Hello world');
    // Auto line-height = 1.2 × 16 = 19.2 → ceil to 20 (single line at 600px wide).
    expect(text.geometry?.height).toBe(20);
  });

  it('falls back to the heuristic when the stamp has no matching map entry', () => {
    const measurements = new Map();
    const { document } = convertHtml(
      `<html><body style="margin:0;width:600px;height:200px;">
         <p data-c2f-mid="m0" style="font-size:16px;">Hello world</p>
       </body></html>`,
      { name: 'miss', textMeasurements: measurements },
    );

    const text = findText(document.root, 'Hello world');
    expect(text.geometry?.height).toBe(20);
  });

  it('measurement propagates up to the parent frame height', () => {
    // If yoga is seeing our measured 48px, the <body> (no explicit height)
    // should be at least that tall. The heuristic would give ~20px.
    const measurements = new Map([['m0', { width: 240, height: 48, lineCount: 2 }]]);

    const { document } = convertHtml(
      `<html><body style="margin:0;width:600px;">
         <p data-c2f-mid="m0" style="font-size:16px;">Hello world</p>
       </body></html>`,
      { name: 'parent-height', textMeasurements: measurements },
    );

    // document.root is the body frame; its height is yoga-computed.
    expect(document.root.geometry?.height).toBeGreaterThanOrEqual(48);
  });
});
