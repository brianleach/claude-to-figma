/**
 * Grid → flex-wrap mapping (ADR 0008).
 *
 * Covers the track-count parser, yoga geometry for 2/3/4-column grids
 * with gap, and the auto-layout props that make it into the IR.
 */

import type { FrameNode, IRNode } from '@claude-to-figma/ir';
import { describe, expect, it } from 'vitest';
import { convertHtml } from '../src/convert.js';
import { parseGridTrackCount } from '../src/style.js';

function findFrame(node: IRNode, name: string): FrameNode {
  if (node.type === 'FRAME' && node.name === name) return node;
  if (node.type === 'FRAME') {
    for (const c of node.children) {
      try {
        return findFrame(c, name);
      } catch {
        // keep searching
      }
    }
  }
  throw new Error(`no FRAME named "${name}"`);
}

describe('parseGridTrackCount', () => {
  it('counts repeat() tracks', () => {
    expect(parseGridTrackCount('repeat(3, 1fr)')).toBe(3);
    expect(parseGridTrackCount('repeat(4, 200px)')).toBe(4);
  });

  it('counts space-separated tracks', () => {
    expect(parseGridTrackCount('1fr 1fr')).toBe(2);
    expect(parseGridTrackCount('200px 200px 200px')).toBe(3);
    expect(parseGridTrackCount('1fr auto 1fr')).toBe(3);
  });

  it('counts repeat() plus extra tracks', () => {
    expect(parseGridTrackCount('repeat(3, 1fr) 200px')).toBe(4);
  });

  it('treats minmax() as one track, not two', () => {
    expect(parseGridTrackCount('minmax(100px, 1fr) minmax(100px, 1fr)')).toBe(2);
  });

  it('returns undefined for none/empty values', () => {
    expect(parseGridTrackCount(undefined)).toBeUndefined();
    expect(parseGridTrackCount('')).toBeUndefined();
    expect(parseGridTrackCount('none')).toBeUndefined();
  });
});

describe('grid → flex-wrap geometry', () => {
  it('lays out a 3-column grid with 3 cells in one row', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:600px;">
         <div id="grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:0;">
           <div id="a" style="height:100px;"></div>
           <div id="b" style="height:100px;"></div>
           <div id="c" style="height:100px;"></div>
         </div>
       </body></html>`,
      { name: 'grid-3col' },
    ).document;

    const a = findFrame(ir.root, 'a');
    const b = findFrame(ir.root, 'b');
    const c = findFrame(ir.root, 'c');

    expect(a.geometry?.x).toBe(0);
    expect(b.geometry?.x).toBe(200);
    expect(c.geometry?.x).toBe(400);
    for (const frame of [a, b, c]) {
      expect(frame.geometry?.y).toBe(0);
      expect(frame.geometry?.width).toBe(200);
    }
  });

  it('wraps a 2-column grid into 2 rows when given 4 cells', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:400px;">
         <div id="grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:0;">
           <div id="a" style="height:50px;"></div>
           <div id="b" style="height:50px;"></div>
           <div id="c" style="height:50px;"></div>
           <div id="d" style="height:50px;"></div>
         </div>
       </body></html>`,
      { name: 'grid-2x2' },
    ).document;

    const a = findFrame(ir.root, 'a');
    const b = findFrame(ir.root, 'b');
    const c = findFrame(ir.root, 'c');
    const d = findFrame(ir.root, 'd');

    // Row 1
    expect(a.geometry?.x).toBe(0);
    expect(a.geometry?.y).toBe(0);
    expect(b.geometry?.x).toBe(200);
    expect(b.geometry?.y).toBe(0);
    // Row 2 wraps
    expect(c.geometry?.x).toBe(0);
    expect(c.geometry?.y).toBe(50);
    expect(d.geometry?.x).toBe(200);
    expect(d.geometry?.y).toBe(50);
  });

  it('honours column-gap and row-gap', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:424px;">
         <div id="grid" style="display:grid;grid-template-columns:repeat(2,1fr);column-gap:24px;row-gap:16px;">
           <div id="a" style="height:50px;"></div>
           <div id="b" style="height:50px;"></div>
           <div id="c" style="height:50px;"></div>
           <div id="d" style="height:50px;"></div>
         </div>
       </body></html>`,
      { name: 'grid-gaps' },
    ).document;

    const b = findFrame(ir.root, 'b');
    const c = findFrame(ir.root, 'c');
    // Second cell is first-cell-width + column-gap away.
    expect(b.geometry?.x).toBe(200 + 24);
    // Third cell wraps to row 2 — first-cell-height + row-gap.
    expect(c.geometry?.y).toBe(50 + 16);
  });

  it('honours the `gap` shorthand for grids', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:432px;">
         <div id="grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px 32px;">
           <div id="a" style="height:40px;"></div>
           <div id="b" style="height:40px;"></div>
           <div id="c" style="height:40px;"></div>
         </div>
       </body></html>`,
      { name: 'grid-gap-shorthand' },
    ).document;

    const b = findFrame(ir.root, 'b');
    const c = findFrame(ir.root, 'c');
    // gap shorthand is `row column` — so row-gap 16, column-gap 32.
    expect(b.geometry?.x).toBe(200 + 32);
    expect(c.geometry?.y).toBe(40 + 16);
  });
});

describe('grid → auto-layout IR props', () => {
  it('emits HORIZONTAL + WRAP layout on a grid container', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:600px;">
         <div id="grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
           <div style="height:50px;"></div>
           <div style="height:50px;"></div>
           <div style="height:50px;"></div>
         </div>
       </body></html>`,
      { name: 'grid-layout-props' },
    ).document;

    const grid = findFrame(ir.root, 'grid');
    expect(grid.layout).toBeDefined();
    expect(grid.layout?.layoutMode).toBe('HORIZONTAL');
    expect(grid.layout?.layoutWrap).toBe('WRAP');
    expect(grid.layout?.itemSpacing).toBe(16);
    expect(grid.layout?.counterAxisSpacing).toBe(16);
  });

  it('splits row-gap and column-gap across the two axes', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:600px;">
         <div id="grid" style="display:grid;grid-template-columns:repeat(2,1fr);row-gap:8px;column-gap:24px;">
           <div style="height:50px;"></div>
           <div style="height:50px;"></div>
         </div>
       </body></html>`,
      { name: 'grid-split-gaps' },
    ).document;

    const grid = findFrame(ir.root, 'grid');
    // column-gap = itemSpacing (main axis = horizontal)
    expect(grid.layout?.itemSpacing).toBe(24);
    // row-gap = counterAxisSpacing (cross axis = vertical)
    expect(grid.layout?.counterAxisSpacing).toBe(8);
  });

  it('decorates grid children with layoutGrow 1 when they have no explicit width', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:600px;">
         <div id="grid" style="display:grid;grid-template-columns:repeat(2,1fr);">
           <div id="a" style="height:50px;"></div>
           <div id="b" style="height:50px;width:100px;"></div>
         </div>
       </body></html>`,
      { name: 'grid-layout-grow' },
    ).document;

    const a = findFrame(ir.root, 'a');
    const b = findFrame(ir.root, 'b');
    expect(a.childLayout?.layoutGrow).toBe(1);
    // B has explicit width — don't override its flex-grow.
    expect(b.childLayout?.layoutGrow).toBe(0);
  });
});
