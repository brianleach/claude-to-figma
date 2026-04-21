/**
 * End-to-end tests for stroke + effect extraction (gaps #2 and #3 in
 * docs/quality-gap-report.md). Verifies the whole pipeline —
 * cascade → shorthand expansion → extractor → IR — wires correctly.
 */

import type { FrameNode, IRNode, ShadowEffect, SolidPaint } from '@claude-to-figma/ir';
import { describe, expect, it } from 'vitest';
import { convertHtml } from '../src/convert.js';

function findFrame(node: IRNode, name: string): FrameNode {
  if (node.type === 'FRAME' && node.name === name) return node;
  if (node.type === 'FRAME') {
    for (const c of node.children) {
      try {
        return findFrame(c, name);
      } catch {
        // keep searching siblings
      }
    }
  }
  throw new Error(`no FRAME named "${name}"`);
}

describe('stroke extraction', () => {
  it('emits a Stroke from `border: 1px solid red`', () => {
    const { document } = convertHtml(
      `<html><body style="margin:0;">
         <div id="card" style="width:200px;height:100px;border:1px solid red;"></div>
       </body></html>`,
      { name: 'border-shorthand' },
    );

    const card = findFrame(document.root, 'card');
    expect(card.strokes).toHaveLength(1);
    const stroke = card.strokes[0];
    expect(stroke?.weight).toBe(1);
    expect(stroke?.align).toBe('INSIDE');
    const paint = stroke?.paint as SolidPaint;
    expect(paint.type).toBe('SOLID');
    expect(paint.color.r).toBeCloseTo(1);
    expect(paint.color.g).toBeCloseTo(0);
    expect(paint.color.b).toBeCloseTo(0);
  });

  it('resolves `var()` inside a border shorthand', () => {
    const { document } = convertHtml(
      `<html><head><style>
         :root { --rule: #c8b9a3; }
         .card { width:200px; height:100px; border: 1.5px solid var(--rule); }
       </style></head><body style="margin:0;">
         <div class="card" id="card"></div>
       </body></html>`,
      { name: 'var-in-border' },
    );

    const card = findFrame(document.root, 'card');
    expect(card.strokes).toHaveLength(1);
    expect(card.strokes[0]?.weight).toBe(1.5);
    const paint = card.strokes[0]?.paint as SolidPaint;
    expect(paint.color.r).toBeCloseTo(0xc8 / 255);
    expect(paint.color.g).toBeCloseTo(0xb9 / 255);
    expect(paint.color.b).toBeCloseTo(0xa3 / 255);
  });

  it('skips border: none', () => {
    const { document } = convertHtml(
      `<html><body style="margin:0;">
         <div id="card" style="width:200px;height:100px;border:none;"></div>
       </body></html>`,
      { name: 'border-none' },
    );

    expect(findFrame(document.root, 'card').strokes).toHaveLength(0);
  });

  it('skips zero-width borders', () => {
    const { document } = convertHtml(
      `<html><body style="margin:0;">
         <div id="card" style="width:200px;height:100px;border:0 solid red;"></div>
       </body></html>`,
      { name: 'border-zero' },
    );

    expect(findFrame(document.root, 'card').strokes).toHaveLength(0);
  });

  it('still picks up border-width set via longhands without a shorthand', () => {
    const { document } = convertHtml(
      `<html><body style="margin:0;">
         <div id="card" style="width:200px;height:100px;border-top-width:2px;border-top-style:solid;border-top-color:blue;"></div>
       </body></html>`,
      { name: 'border-longhand-only' },
    );

    const card = findFrame(document.root, 'card');
    expect(card.strokes).toHaveLength(1);
    expect(card.strokes[0]?.weight).toBe(2);
  });
});

describe('effect extraction', () => {
  it('emits DROP_SHADOW from a simple box-shadow', () => {
    const { document } = convertHtml(
      `<html><body style="margin:0;">
         <div id="card" style="width:200px;height:100px;box-shadow:0 4px 12px rgba(0,0,0,0.25);"></div>
       </body></html>`,
      { name: 'drop-shadow' },
    );

    const card = findFrame(document.root, 'card');
    expect(card.effects).toHaveLength(1);
    const effect = card.effects[0] as ShadowEffect;
    expect(effect.type).toBe('DROP_SHADOW');
    expect(effect.offset).toEqual({ x: 0, y: 4 });
    expect(effect.radius).toBe(12);
    expect(effect.color.a).toBeCloseTo(0.25);
  });

  it('emits INNER_SHADOW when `inset` is present', () => {
    const { document } = convertHtml(
      `<html><body style="margin:0;">
         <div id="card" style="width:200px;height:100px;box-shadow:inset 0 2px 4px black;"></div>
       </body></html>`,
      { name: 'inner-shadow' },
    );

    const card = findFrame(document.root, 'card');
    expect(card.effects).toHaveLength(1);
    expect((card.effects[0] as ShadowEffect).type).toBe('INNER_SHADOW');
  });

  it('emits one Effect per comma-separated shadow', () => {
    const { document } = convertHtml(
      `<html><body style="margin:0;">
         <div id="card" style="width:200px;height:100px;box-shadow:0 1px 0 rgba(0,0,0,0.1), 0 12px 40px -18px rgba(0,0,0,0.25);"></div>
       </body></html>`,
      { name: 'multi-shadow' },
    );

    const card = findFrame(document.root, 'card');
    expect(card.effects).toHaveLength(2);
    const first = card.effects[0] as ShadowEffect;
    const second = card.effects[1] as ShadowEffect;
    expect(first.offset.y).toBe(1);
    expect(second.offset.y).toBe(12);
    expect(second.spread).toBe(-18);
  });

  it('emits LAYER_BLUR from filter: blur()', () => {
    const { document } = convertHtml(
      `<html><body style="margin:0;">
         <div id="card" style="width:200px;height:100px;filter:blur(4px);"></div>
       </body></html>`,
      { name: 'layer-blur' },
    );

    const card = findFrame(document.root, 'card');
    const blur = card.effects.find((e) => e.type === 'LAYER_BLUR');
    expect(blur).toBeDefined();
    expect((blur as { radius: number }).radius).toBe(4);
  });

  it('emits BACKGROUND_BLUR from backdrop-filter: blur()', () => {
    const { document } = convertHtml(
      `<html><body style="margin:0;">
         <div id="card" style="width:200px;height:100px;backdrop-filter:blur(12px);"></div>
       </body></html>`,
      { name: 'background-blur' },
    );

    const card = findFrame(document.root, 'card');
    const blur = card.effects.find((e) => e.type === 'BACKGROUND_BLUR');
    expect(blur).toBeDefined();
    expect((blur as { radius: number }).radius).toBe(12);
  });

  it('silently drops non-blur filter functions', () => {
    const { document } = convertHtml(
      `<html><body style="margin:0;">
         <div id="card" style="width:200px;height:100px;filter:saturate(0.35);"></div>
       </body></html>`,
      { name: 'saturate-dropped' },
    );

    expect(findFrame(document.root, 'card').effects).toHaveLength(0);
  });
});
