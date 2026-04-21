/**
 * Static pseudo-class selector support (gap #9 in
 * docs/quality-gap-report.md).
 *
 * `:first-child`, `:last-child`, `:first-of-type`, `:last-of-type`,
 * `:only-child`, `:only-of-type`, `:empty` are all resolvable at
 * parse time — no runtime state, no parenthesised sub-selectors.
 * Interactive pseudos (`:hover`, `:focus`) + `:nth-child(...)` /
 * `:not(...)` stay unsupported and silently fail to match.
 */

import type { FrameNode, IRNode, SolidPaint } from '@claude-to-figma/ir';
import { describe, expect, it } from 'vitest';
import { convertHtml } from '../src/convert.js';

function findById(node: IRNode, id: string): IRNode {
  if (node.name.toLowerCase() === id.toLowerCase()) return node;
  if (node.type === 'FRAME') {
    for (const c of node.children) {
      try {
        return findById(c, id);
      } catch {
        // keep searching
      }
    }
  }
  throw new Error(`no node named "${id}"`);
}

function firstSolidColor(node: IRNode) {
  if (node.type !== 'FRAME') throw new Error('expected FRAME');
  const fill = node.fills[0];
  if (!fill || fill.type !== 'SOLID') throw new Error('expected SOLID fill');
  return (fill as SolidPaint).color;
}

describe('static pseudo-classes', () => {
  it(':first-child matches only the first element sibling', () => {
    const html = `<html><head><style>
        div > div { background-color: red; }
        div > div:first-child { background-color: blue; }
      </style></head><body style="width:1px;height:1px;">
      <div style="width:40px;height:10px;">
        <div id="a" style="width:10px;height:10px;"></div>
        <div id="b" style="width:10px;height:10px;"></div>
      </div>
    </body></html>`;
    const ir = convertHtml(html, { name: 'first-child' }).document;
    const a = findById(ir.root, 'a') as FrameNode;
    const b = findById(ir.root, 'b') as FrameNode;
    // a is first-child → blue (0,0,1), b stays red.
    expect(firstSolidColor(a).b).toBeCloseTo(1);
    expect(firstSolidColor(b).r).toBeCloseTo(1);
  });

  it(':last-child matches only the last element sibling', () => {
    const html = `<html><body style="width:1px;height:1px;">
      <style>
        div { background-color: red; }
        div:last-child { background-color: blue; }
      </style>
      <div id="a" style="width:10px;height:10px;"></div>
      <div id="b" style="width:10px;height:10px;"></div>
      <div id="c" style="width:10px;height:10px;"></div>
    </body></html>`;
    const ir = convertHtml(html, { name: 'last-child' }).document;
    expect(firstSolidColor(findById(ir.root, 'a')).r).toBeCloseTo(1);
    expect(firstSolidColor(findById(ir.root, 'b')).r).toBeCloseTo(1);
    expect(firstSolidColor(findById(ir.root, 'c')).b).toBeCloseTo(1);
  });

  it(':first-of-type counts only same-tag siblings', () => {
    const html = `<html><body style="width:1px;height:1px;">
      <style>
        div { background-color: red; }
        div:first-of-type { background-color: blue; }
      </style>
      <span style="width:10px;height:10px;"></span>
      <div id="a" style="width:10px;height:10px;"></div>
      <div id="b" style="width:10px;height:10px;"></div>
    </body></html>`;
    const ir = convertHtml(html, { name: 'first-of-type' }).document;
    // `a` is first div-of-type (the span doesn't count).
    expect(firstSolidColor(findById(ir.root, 'a')).b).toBeCloseTo(1);
    expect(firstSolidColor(findById(ir.root, 'b')).r).toBeCloseTo(1);
  });

  it(':last-of-type on the last sibling of its tag', () => {
    const html = `<html><body style="width:1px;height:1px;">
      <style>
        div { border: 1px solid red; }
        div:last-of-type { border: 1px solid blue; }
      </style>
      <div id="a" style="width:10px;height:10px;"></div>
      <div id="b" style="width:10px;height:10px;"></div>
      <span style="width:10px;height:10px;"></span>
    </body></html>`;
    const ir = convertHtml(html, { name: 'last-of-type' }).document;
    const a = findById(ir.root, 'a') as FrameNode;
    const b = findById(ir.root, 'b') as FrameNode;
    // a has red border; b is last-of-type div → blue.
    const aPaint = a.strokes[0]?.paint;
    const bPaint = b.strokes[0]?.paint;
    if (!aPaint || aPaint.type !== 'SOLID' || !bPaint || bPaint.type !== 'SOLID') {
      throw new Error('expected SOLID border paints');
    }
    expect(aPaint.color.r).toBeCloseTo(1);
    expect(bPaint.color.b).toBeCloseTo(1);
  });

  it(':only-child matches only when there is exactly one child element', () => {
    const html = `<html><head><style>
        div > div:only-child { background-color: blue; }
      </style></head><body style="width:1px;height:1px;">
      <div style="width:10px;height:10px;">
        <div id="singleton" style="width:10px;height:10px;"></div>
      </div>
      <div style="width:10px;height:10px;">
        <div id="oneoftwo" style="width:10px;height:10px;"></div>
        <div style="width:10px;height:10px;"></div>
      </div>
    </body></html>`;
    const ir = convertHtml(html, { name: 'only-child' }).document;
    expect(firstSolidColor(findById(ir.root, 'singleton')).b).toBeCloseTo(1);
    const other = findById(ir.root, 'oneoftwo') as FrameNode;
    expect(other.fills).toHaveLength(0);
  });

  it(':empty matches elements with no element children and no non-whitespace text', () => {
    const html = `<html><body style="width:1px;height:1px;">
      <style>
        section:empty { background-color: blue; }
      </style>
      <section id="blank" style="width:10px;height:10px;"></section>
      <section id="hastext" style="width:10px;height:10px;">text</section>
    </body></html>`;
    const ir = convertHtml(html, { name: 'empty' }).document;
    expect(firstSolidColor(findById(ir.root, 'blank')).b).toBeCloseTo(1);
    const withText = findById(ir.root, 'hastext') as FrameNode;
    expect(withText.fills).toHaveLength(0);
  });

  it(':last-child on the real landing pattern (strip right border from the last step)', () => {
    // The step-card pattern: each card has a right border except the last.
    const html = `<html><body style="width:1px;height:1px;">
      <style>
        section > article { border-right: 1px solid red; }
        section > article:last-child { border-right: 0; }
      </style>
      <section style="width:300px;height:100px;">
        <article id="s1" style="width:100px;height:100px;"></article>
        <article id="s2" style="width:100px;height:100px;"></article>
        <article id="s3" style="width:100px;height:100px;"></article>
      </section>
    </body></html>`;
    const ir = convertHtml(html, { name: 'step-border' }).document;
    const s1 = findById(ir.root, 's1') as FrameNode;
    const s3 = findById(ir.root, 's3') as FrameNode;
    expect(s1.strokes.length).toBe(1);
    // Last step has border-right 0 → no stroke emitted.
    expect(s3.strokes.length).toBe(0);
  });

  it('rejects unsupported pseudos silently (specificity scored, selector never matches)', () => {
    const html = `<html><body style="width:1px;height:1px;">
      <style>
        div { background-color: red; }
        div:hover { background-color: blue; }
      </style>
      <div id="a" style="width:10px;height:10px;"></div>
    </body></html>`;
    const ir = convertHtml(html, { name: 'hover' }).document;
    // :hover never matches → red stays.
    expect(firstSolidColor(findById(ir.root, 'a')).r).toBeCloseTo(1);
  });
});
