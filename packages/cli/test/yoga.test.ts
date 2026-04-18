/**
 * Yoga layout integration tests — covers V-M4-YOGA-TESTS.
 *
 * Each test parses HTML through `convertHtml` and reads the computed
 * geometry off the resulting IR. The 5 required scenarios:
 *   1. block stack
 *   2. flex row
 *   3. flex column
 *   4. nested flex
 *   5. padding/margin
 */

import type { FrameNode, IRNode } from '@claude-to-figma/ir';
import { describe, expect, it } from 'vitest';
import { convertHtml } from '../src/convert.js';

function findFrameByName(node: IRNode, name: string): FrameNode {
  if (node.type === 'FRAME' && node.name === name) return node;
  if (node.type === 'FRAME') {
    for (const c of node.children) {
      try {
        return findFrameByName(c, name);
      } catch {
        // keep searching siblings
      }
    }
  }
  throw new Error(`expected FRAME named "${name}" in subtree`);
}

describe('yoga layout', () => {
  it('block stacks divs vertically inside the body', () => {
    const ir = convertHtml(
      `<html><body style="width:400px;height:400px;margin:0;">
         <div id="a" style="height:100px;background:#f00;"></div>
         <div id="b" style="height:100px;background:#0f0;"></div>
         <div id="c" style="height:100px;background:#00f;"></div>
       </body></html>`,
      { name: 'block-stack' },
    ).document;

    const a = findFrameByName(ir.root, 'a');
    const b = findFrameByName(ir.root, 'b');
    const c = findFrameByName(ir.root, 'c');

    expect(a.geometry).toEqual({ x: 0, y: 0, width: 400, height: 100 });
    expect(b.geometry).toEqual({ x: 0, y: 100, width: 400, height: 100 });
    expect(c.geometry).toEqual({ x: 0, y: 200, width: 400, height: 100 });
  });

  it('flex row lays out children horizontally with gap', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:400px;height:100px;">
         <div style="display:flex;flex-direction:row;gap:20px;height:100px;">
           <div id="a" style="width:80px;height:60px;"></div>
           <div id="b" style="width:80px;height:60px;"></div>
           <div id="c" style="width:80px;height:60px;"></div>
         </div>
       </body></html>`,
      { name: 'flex-row' },
    ).document;

    const a = findFrameByName(ir.root, 'a');
    const b = findFrameByName(ir.root, 'b');
    const c = findFrameByName(ir.root, 'c');

    expect(a.geometry?.x).toBe(0);
    expect(b.geometry?.x).toBe(100); // 80 + 20 gap
    expect(c.geometry?.x).toBe(200); // 80 + 20 + 80 + 20
    expect(a.geometry?.height).toBe(60);
  });

  it('flex column lays out children vertically with gap', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:200px;height:400px;">
         <div style="display:flex;flex-direction:column;gap:10px;width:200px;">
           <div id="x" style="width:200px;height:50px;"></div>
           <div id="y" style="width:200px;height:50px;"></div>
         </div>
       </body></html>`,
      { name: 'flex-col' },
    ).document;

    const x = findFrameByName(ir.root, 'x');
    const y = findFrameByName(ir.root, 'y');
    expect(x.geometry?.y).toBe(0);
    expect(y.geometry?.y).toBe(60); // 50 + 10 gap
  });

  it('nested flex resolves justify-content and align-items', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:400px;height:200px;">
         <div id="outer" style="display:flex;flex-direction:row;justify-content:space-between;align-items:center;width:400px;height:100px;">
           <div id="left" style="width:80px;height:40px;"></div>
           <div id="right" style="width:80px;height:40px;"></div>
         </div>
       </body></html>`,
      { name: 'nested-flex' },
    ).document;

    const left = findFrameByName(ir.root, 'left');
    const right = findFrameByName(ir.root, 'right');
    // space-between: first hugs left edge, last hugs right edge.
    expect(left.geometry?.x).toBe(0);
    expect(right.geometry?.x).toBe(320); // 400 - 80
    // align-items: center → vertically centered in the 100-tall container.
    expect(left.geometry?.y).toBe(30); // (100 - 40) / 2
    expect(right.geometry?.y).toBe(30);
  });

  it('padding shifts children inward', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:400px;height:200px;">
         <div id="outer" style="width:200px;height:100px;padding-left:20px;padding-top:30px;">
           <div id="inner" style="width:100px;height:40px;"></div>
         </div>
       </body></html>`,
      { name: 'padding' },
    ).document;

    const inner = findFrameByName(ir.root, 'inner');
    expect(inner.geometry).toEqual({ x: 20, y: 30, width: 100, height: 40 });
  });

  it('margin shifts the element itself within its block flow', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:400px;height:200px;">
         <div id="outer" style="width:400px;height:200px;">
           <div id="inner" style="width:100px;height:40px;margin-left:50px;margin-top:25px;"></div>
         </div>
       </body></html>`,
      { name: 'margin' },
    ).document;

    const inner = findFrameByName(ir.root, 'inner');
    expect(inner.geometry?.x).toBe(50);
    expect(inner.geometry?.y).toBe(25);
  });

  it('text nodes get a non-zero measured height', () => {
    const ir = convertHtml(
      `<html><body style="margin:0;width:400px;height:200px;">
         <p id="p" style="font-size:16px;line-height:1.5;width:400px;">Hello world</p>
       </body></html>`,
      { name: 'text-measure' },
    ).document;

    // The <p> becomes a TEXT IR node — search the tree directly since it's
    // text-only and not a FRAME.
    const find = (n: IRNode): IRNode | undefined => {
      if (n.type === 'TEXT' || n.type === 'IMAGE' || n.type === 'VECTOR' || n.type === 'INSTANCE') {
        return n;
      }
      for (const c of n.children) {
        const f = find(c);
        if (f) return f;
      }
      return undefined;
    };
    const text = find(ir.root);
    if (!text || text.type !== 'TEXT') throw new Error('expected TEXT node');
    expect(text.geometry?.width).toBe(400);
    expect(text.geometry?.height).toBeGreaterThan(0);
    expect(text.geometry?.height).toBeLessThan(50);
  });
});
