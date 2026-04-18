/**
 * Cascade engine tests — covers V-M3-CASCADE-TESTS.
 *
 * Each test parses HTML through `convertHtml` and reads the computed
 * style off the resulting IR. We assert against IR fields rather than
 * the cascade map directly so the tests survive internal refactors.
 */

import type { Color, FrameNode, IRNode, Paint, TextNode } from '@claude-to-figma/ir';
import { type DefaultTreeAdapterTypes, parse } from 'parse5';
import { describe, expect, it } from 'vitest';
import {
  compareSpecificity,
  computeSpecificity,
  matchSelector,
  resolveVars,
} from '../src/cascade/index.js';
import { convertHtml } from '../src/convert.js';

type Element = DefaultTreeAdapterTypes.Element;

// Helpers ----------------------------------------------------------------

function findText(node: IRNode): TextNode {
  const found = findTextOpt(node);
  if (!found) throw new Error('expected a TEXT node in subtree');
  return found;
}

function findTextOpt(node: IRNode): TextNode | undefined {
  if (node.type === 'TEXT') return node;
  if (node.type === 'FRAME') {
    for (const c of node.children) {
      const t = findTextOpt(c);
      if (t) return t;
    }
  }
  return undefined;
}

function findFrameByName(node: IRNode, name: string): FrameNode {
  const found = findFrameByNameOpt(node, name);
  if (!found) throw new Error(`expected FRAME named "${name}" in subtree`);
  return found;
}

function findFrameByNameOpt(node: IRNode, name: string): FrameNode | undefined {
  if (node.type === 'FRAME' && node.name === name) return node;
  if (node.type === 'FRAME') {
    for (const c of node.children) {
      const f = findFrameByNameOpt(c, name);
      if (f) return f;
    }
  }
  return undefined;
}

function firstSolidColor(fills: Paint[]): Color | undefined {
  const fill = fills[0];
  if (!fill || fill.type !== 'SOLID') return undefined;
  return fill.color;
}

interface FoundElement {
  el: Element;
  ancestors: Element[];
}

function isP5Element(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && 'tagName' in node;
}

function findElement(html: string, tag: string): FoundElement {
  const tree = parse(html);
  let found: FoundElement | null = null;
  const walk = (node: unknown, ancestors: Element[]): void => {
    if (!isP5Element(node)) {
      if (typeof node === 'object' && node !== null && 'childNodes' in node) {
        const children = (node as { childNodes: unknown[] }).childNodes;
        for (const c of children) walk(c, ancestors);
      }
      return;
    }
    if (node.tagName === tag && !found) found = { el: node, ancestors };
    for (const c of node.childNodes) walk(c, [...ancestors, node]);
  };
  walk(tree, []);
  if (!found) throw new Error(`No <${tag}> in HTML`);
  return found;
}

// Specificity ------------------------------------------------------------

describe('computeSpecificity', () => {
  it('counts a single type selector as (0,0,1)', () => {
    expect(computeSpecificity('div')).toEqual({ inline: 0, id: 0, cls: 0, type: 1 });
  });

  it('counts a class selector as (0,1,0)', () => {
    expect(computeSpecificity('.card')).toEqual({ inline: 0, id: 0, cls: 1, type: 0 });
  });

  it('counts an id selector as (1,0,0)', () => {
    expect(computeSpecificity('#main')).toEqual({ inline: 0, id: 1, cls: 0, type: 0 });
  });

  it('counts compound selectors additively', () => {
    expect(computeSpecificity('div.card#main')).toEqual({ inline: 0, id: 1, cls: 1, type: 1 });
  });

  it('counts descendant selectors across compounds', () => {
    expect(computeSpecificity('nav .item a')).toEqual({ inline: 0, id: 0, cls: 1, type: 2 });
  });

  it('orders id > class > type', () => {
    const id = computeSpecificity('#x');
    const cls = computeSpecificity('.x');
    const type = computeSpecificity('x');
    expect(compareSpecificity(id, cls)).toBeGreaterThan(0);
    expect(compareSpecificity(cls, type)).toBeGreaterThan(0);
  });
});

// Selector matching ------------------------------------------------------

describe('matchSelector', () => {
  it('matches a tag selector', () => {
    const { el, ancestors } = findElement('<html><body><div></div></body></html>', 'div');
    expect(matchSelector('div', el, ancestors)).toBe(true);
  });

  it('matches a class selector', () => {
    const { el, ancestors } = findElement(
      '<html><body><div class="card primary"></div></body></html>',
      'div',
    );
    expect(matchSelector('.card', el, ancestors)).toBe(true);
    expect(matchSelector('.missing', el, ancestors)).toBe(false);
  });

  it('matches descendant combinators across multiple ancestors', () => {
    const { el, ancestors } = findElement(
      '<html><body><nav><ul><li><a></a></li></ul></nav></body></html>',
      'a',
    );
    expect(matchSelector('nav a', el, ancestors)).toBe(true);
    expect(matchSelector('ul a', el, ancestors)).toBe(true);
    expect(matchSelector('main a', el, ancestors)).toBe(false);
  });

  it('honours the child combinator', () => {
    const { el, ancestors } = findElement(
      '<html><body><div><p><span></span></p></div></body></html>',
      'span',
    );
    expect(matchSelector('p > span', el, ancestors)).toBe(true);
    expect(matchSelector('div > span', el, ancestors)).toBe(false);
  });
});

// Cascade — !important, specificity, source order, inheritance, vars -----

describe('cascade', () => {
  it('respects specificity (id beats class)', () => {
    const html = `
      <html><body style="width:1px;height:1px;">
        <style>
          .card { background-color: red; }
          #card { background-color: blue; }
        </style>
        <div id="card" class="card" style="width:10px;height:10px;"></div>
      </body></html>
    `;
    const ir = convertHtml(html, { name: 'specificity' }).document;
    const card = findFrameByName(ir.root, 'card');
    expect(firstSolidColor(card.fills)?.b).toBe(1);
    expect(firstSolidColor(card.fills)?.r).toBe(0);
  });

  it('falls back to source order on equal specificity', () => {
    const html = `
      <html><body style="width:1px;height:1px;">
        <style>
          .a { background-color: red; }
          .a { background-color: green; }
        </style>
        <div class="a" id="x" style="width:10px;height:10px;"></div>
      </body></html>
    `;
    const ir = convertHtml(html, { name: 'order' }).document;
    const node = findFrameByName(ir.root, 'x');
    const c = firstSolidColor(node.fills);
    expect(c?.g).toBeCloseTo(128 / 255, 2);
  });

  it('!important overrides higher specificity', () => {
    const html = `
      <html><body style="width:1px;height:1px;">
        <style>
          .card { background-color: red !important; }
          #card { background-color: blue; }
        </style>
        <div id="card" class="card" style="width:10px;height:10px;"></div>
      </body></html>
    `;
    const ir = convertHtml(html, { name: 'important' }).document;
    const card = findFrameByName(ir.root, 'card');
    expect(firstSolidColor(card.fills)?.r).toBe(1);
  });

  it('inline style beats author rules without !important', () => {
    const html = `
      <html><body style="width:1px;height:1px;">
        <style>
          #card { background-color: red; }
        </style>
        <div id="card" style="background-color: blue; width:10px; height:10px;"></div>
      </body></html>
    `;
    const ir = convertHtml(html, { name: 'inline-wins' }).document;
    const card = findFrameByName(ir.root, 'card');
    expect(firstSolidColor(card.fills)?.b).toBe(1);
  });

  it('!important on author rule beats plain inline', () => {
    const html = `
      <html><body style="width:1px;height:1px;">
        <style>
          #card { background-color: red !important; }
        </style>
        <div id="card" style="background-color: blue; width:10px; height:10px;"></div>
      </body></html>
    `;
    const ir = convertHtml(html, { name: 'important-vs-inline' }).document;
    const card = findFrameByName(ir.root, 'card');
    expect(firstSolidColor(card.fills)?.r).toBe(1);
  });

  it('inherits color from a parent frame to a child text node', () => {
    const html = `
      <html><body style="width:1px;height:1px;">
        <style>
          .article { color: #ff0000; }
        </style>
        <div class="article" style="width:100px;height:50px;">
          <p style="font-size:14px;">red text</p>
        </div>
      </body></html>
    `;
    const ir = convertHtml(html, { name: 'inherit' }).document;
    const text = findText(ir.root);
    expect(firstSolidColor(text.fills)?.r).toBe(1);
  });

  it('does not inherit non-inheritable properties (background-color)', () => {
    const html = `
      <html><body style="width:1px;height:1px;">
        <style>
          .outer { background-color: red; }
        </style>
        <div class="outer" style="width:200px;height:100px;">
          <div id="inner" style="width:50px;height:50px;"></div>
        </div>
      </body></html>
    `;
    const ir = convertHtml(html, { name: 'no-bg-inherit' }).document;
    const inner = findFrameByName(ir.root, 'inner');
    expect(inner.fills).toEqual([]);
  });

  it('resolves CSS custom properties at computed-value time', () => {
    const html = `
      <html><body style="width:1px;height:1px;">
        <style>
          :root, body { --brand: #3300ff; }
          #card { background-color: var(--brand); }
        </style>
        <div id="card" style="width:10px;height:10px;"></div>
      </body></html>
    `;
    const ir = convertHtml(html, { name: 'vars' }).document;
    const card = findFrameByName(ir.root, 'card');
    const c = firstSolidColor(card.fills);
    expect(c?.b).toBe(1);
    expect(c?.r).toBeCloseTo(0.2, 1);
  });

  it('resolves nested var() references through inheritance', () => {
    const html = `
      <html><body style="width:1px;height:1px;">
        <style>
          body { --brand: #00ff00; --primary: var(--brand); }
          #card { background-color: var(--primary); }
        </style>
        <div id="card" style="width:10px;height:10px;"></div>
      </body></html>
    `;
    const ir = convertHtml(html, { name: 'nested-vars' }).document;
    const card = findFrameByName(ir.root, 'card');
    expect(firstSolidColor(card.fills)?.g).toBe(1);
  });

  it('uses var() fallback when the variable is undefined', () => {
    const html = `
      <html><body style="width:1px;height:1px;">
        <style>
          #card { background-color: var(--missing, #ff8800); }
        </style>
        <div id="card" style="width:10px;height:10px;"></div>
      </body></html>
    `;
    const ir = convertHtml(html, { name: 'var-fallback' }).document;
    const card = findFrameByName(ir.root, 'card');
    const c = firstSolidColor(card.fills);
    expect(c?.r).toBe(1);
    expect(c?.g).toBeCloseTo(0x88 / 255, 2);
  });

  it('descendant selectors apply to nested children only', () => {
    const html = `
      <html><body style="width:1px;height:1px;">
        <style>
          .article p { color: #0000ff; }
        </style>
        <p id="outside" style="font-size:14px;">outside</p>
        <div class="article" style="width:100px;height:100px;">
          <p style="font-size:14px;">inside</p>
        </div>
      </body></html>
    `;
    const ir = convertHtml(html, { name: 'descendant' }).document;
    const outside = findText(ir.root);
    expect(firstSolidColor(outside.fills)?.b).not.toBe(1);
  });

  it('child combinator does not match grandchildren', () => {
    const html = `
      <html><body style="width:1px;height:1px;">
        <style>
          .wrap > p { color: #00ff00; }
        </style>
        <div class="wrap" style="width:100px;height:100px;">
          <div style="width:50px;height:50px;">
            <p style="font-size:14px;">grandchild</p>
          </div>
        </div>
      </body></html>
    `;
    const ir = convertHtml(html, { name: 'child' }).document;
    const text = findText(ir.root);
    expect(firstSolidColor(text.fills)?.g).not.toBe(1);
  });
});

// var() resolver — direct unit tests --------------------------------------

describe('resolveVars', () => {
  it('returns the value unchanged when no var() is present', () => {
    expect(resolveVars('#ff0000', () => undefined)).toBe('#ff0000');
  });

  it('substitutes a defined variable', () => {
    expect(resolveVars('var(--x)', (n) => (n === '--x' ? '#abc' : undefined))).toBe('#abc');
  });

  it('uses the fallback when undefined', () => {
    expect(resolveVars('var(--missing, fallback)', () => undefined)).toBe('fallback');
  });

  it('bails out on cyclic references', () => {
    const lookup = (n: string): string | undefined => (n === '--a' ? 'var(--a)' : undefined);
    expect(() => resolveVars('var(--a)', lookup)).not.toThrow();
  });
});
