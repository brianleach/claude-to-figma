/**
 * `max-width` + `margin: 0 auto` centring (gap #8 in
 * docs/quality-gap-report.md). The `.wrap` pattern on the landing
 * dogfood — and every page that uses a fixed-max-width column — needs
 * yoga's auto-margin semantics to produce the right x position in the
 * IR geometry.
 */

import type { FrameNode, IRNode } from '@claude-to-figma/ir';
import { describe, expect, it } from 'vitest';
import { convertHtml } from '../src/convert.js';

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

describe('margin: auto centring', () => {
  it('centres a max-width child horizontally in a wider parent', () => {
    // Parent 1440px wide, child max-width 800px, margin 0 auto.
    // Expected centring: (1440 - 800) / 2 = 320px left offset.
    const ir = convertHtml(
      `<html><body style="margin:0;width:1440px;">
         <div id="wrap" style="max-width:800px;margin:0 auto;height:200px;"></div>
       </body></html>`,
      { name: 'margin-auto-center' },
    ).document;

    const wrap = findFrame(ir.root, 'wrap');
    expect(wrap.geometry?.x).toBe(320);
    expect(wrap.geometry?.width).toBe(800);
  });

  it('honours margin: auto via the longhand form too', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:1000px;">
         <div id="wrap" style="max-width:600px;margin-left:auto;margin-right:auto;height:100px;"></div>
       </body></html>`,
      { name: 'margin-auto-longhand' },
    ).document;

    const wrap = findFrame(ir.root, 'wrap');
    expect(wrap.geometry?.x).toBe(200);
  });

  it('leaves numeric margins working', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:600px;">
         <div id="wrap" style="width:300px;margin-left:100px;height:100px;"></div>
       </body></html>`,
      { name: 'margin-numeric' },
    ).document;

    const wrap = findFrame(ir.root, 'wrap');
    expect(wrap.geometry?.x).toBe(100);
    expect(wrap.geometry?.width).toBe(300);
  });

  it('margin shorthand `0 auto` expands to top/bottom 0, left/right auto', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:1200px;">
         <div id="wrap" style="width:800px;margin:40px auto;height:100px;"></div>
       </body></html>`,
      { name: 'margin-shorthand-autos' },
    ).document;

    const wrap = findFrame(ir.root, 'wrap');
    expect(wrap.geometry?.x).toBe(200); // (1200 - 800) / 2
    expect(wrap.geometry?.y).toBe(40); // top margin
  });
});
