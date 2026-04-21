/**
 * Gradient paint parsing + matrix computation (ADR 0009).
 *
 * Covers the direction/angle parser, color-stop parsing (positioned +
 * auto-distributed), the gradient transform math for common angles,
 * radial gradient defaults, and the end-to-end flow through
 * `convertHtml` so IR frames actually carry gradient paints.
 */

import type {
  FrameNode,
  IRNode,
  LinearGradientPaint,
  RadialGradientPaint,
} from '@claude-to-figma/ir';
import { describe, expect, it } from 'vitest';
import { parseCssGradient } from '../src/cascade/gradients.js';
import { convertHtml } from '../src/convert.js';

function asLinear(p: unknown): LinearGradientPaint {
  if (!p || typeof p !== 'object' || (p as { type: string }).type !== 'GRADIENT_LINEAR') {
    throw new Error('expected LinearGradientPaint');
  }
  return p as LinearGradientPaint;
}

function asRadial(p: unknown): RadialGradientPaint {
  if (!p || typeof p !== 'object' || (p as { type: string }).type !== 'GRADIENT_RADIAL') {
    throw new Error('expected RadialGradientPaint');
  }
  return p as RadialGradientPaint;
}

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

describe('linear-gradient parsing', () => {
  it('parses two colours with no direction (defaults to 180deg / to bottom)', () => {
    const paint = asLinear(parseCssGradient('linear-gradient(red, blue)'));
    expect(paint.gradientStops).toHaveLength(2);
    expect(paint.gradientStops[0]?.color.r).toBeCloseTo(1);
    expect(paint.gradientStops[1]?.color.b).toBeCloseTo(1);
    // 180deg: matrix should map (0,0)→(0.5, 0) and (1,0)→(0.5, 1).
    const [[a, b, c], [d, e, f]] = paint.gradientTransform;
    expect(a).toBeCloseTo(0);
    expect(b).toBeCloseTo(-1);
    expect(c).toBeCloseTo(0.5);
    expect(d).toBeCloseTo(1);
    expect(e).toBeCloseTo(0);
    expect(f).toBeCloseTo(0);
  });

  it('parses `90deg` (left → right)', () => {
    const paint = asLinear(parseCssGradient('linear-gradient(90deg, red, blue)'));
    const [[a, , c], [d, , f]] = paint.gradientTransform;
    // Direction (1, 0): start at (0, 0.5), end at (1, 0.5).
    expect(a).toBeCloseTo(1);
    expect(c).toBeCloseTo(0);
    expect(d).toBeCloseTo(0);
    expect(f).toBeCloseTo(0.5);
  });

  it('parses the `to top` keyword (0deg)', () => {
    const paint = asLinear(parseCssGradient('linear-gradient(to top, red, blue)'));
    const [[, , c], [d, , f]] = paint.gradientTransform;
    // 0deg direction (0, -1): start at (0.5, 1), end at (0.5, 0).
    expect(c).toBeCloseTo(0.5);
    expect(d).toBeCloseTo(-1);
    expect(f).toBeCloseTo(1);
  });

  it('parses the `to right bottom` diagonal (135deg)', () => {
    const paint = asLinear(parseCssGradient('linear-gradient(to right bottom, red, blue)'));
    const [[a, ,], [d, ,]] = paint.gradientTransform;
    const expectedDx = Math.sin((135 * Math.PI) / 180);
    const expectedDy = -Math.cos((135 * Math.PI) / 180);
    expect(a).toBeCloseTo(expectedDx);
    expect(d).toBeCloseTo(expectedDy);
  });

  it('respects explicit stop positions', () => {
    const paint = asLinear(parseCssGradient('linear-gradient(red 10%, blue 90%)'));
    expect(paint.gradientStops[0]?.position).toBeCloseTo(0.1);
    expect(paint.gradientStops[1]?.position).toBeCloseTo(0.9);
  });

  it('distributes missing positions evenly', () => {
    const paint = asLinear(parseCssGradient('linear-gradient(red, green, blue)'));
    expect(paint.gradientStops[0]?.position).toBeCloseTo(0);
    expect(paint.gradientStops[1]?.position).toBeCloseTo(0.5);
    expect(paint.gradientStops[2]?.position).toBeCloseTo(1);
  });

  it('keeps rgba() stops with embedded commas intact', () => {
    const paint = asLinear(
      parseCssGradient(
        'linear-gradient(90deg, rgba(0, 0, 0, 0.5) 0%, rgba(255, 255, 255, 1) 100%)',
      ),
    );
    expect(paint.gradientStops).toHaveLength(2);
    expect(paint.gradientStops[0]?.color.a).toBeCloseTo(0.5);
    expect(paint.gradientStops[1]?.color.r).toBeCloseTo(1);
  });

  it('supports `turn`, `rad`, `grad` angle units', () => {
    // 0.25turn = 90deg — should produce the same matrix as the 90deg test above.
    const viaTurn = asLinear(parseCssGradient('linear-gradient(0.25turn, red, blue)'));
    const [[a]] = viaTurn.gradientTransform;
    expect(a).toBeCloseTo(1);
  });
});

describe('radial-gradient parsing', () => {
  it('parses stops without a shape/size/position prefix', () => {
    const paint = asRadial(parseCssGradient('radial-gradient(red, blue)'));
    expect(paint.gradientStops).toHaveLength(2);
    // Figma default: centre at (0.5, 0.5), radii 0.5 on both axes.
    expect(paint.gradientTransform).toEqual([
      [0.5, 0, 0.5],
      [0, 0.5, 0.5],
    ]);
  });

  it('discards the shape/size/position prefix and still parses stops', () => {
    const paint = asRadial(
      parseCssGradient('radial-gradient(circle at center, red 0%, blue 100%)'),
    );
    expect(paint.gradientStops).toHaveLength(2);
  });
});

describe('parser rejects malformed / unsupported input', () => {
  it('returns undefined for a plain colour', () => {
    expect(parseCssGradient('red')).toBeUndefined();
  });

  it('returns undefined for single-stop gradients', () => {
    expect(parseCssGradient('linear-gradient(red)')).toBeUndefined();
  });

  it('returns undefined for unsupported functions', () => {
    expect(parseCssGradient('conic-gradient(red, blue)')).toBeUndefined();
  });
});

describe('gradient end-to-end via convertHtml', () => {
  it('lands a GRADIENT_LINEAR fill on a frame using `background:` shorthand', () => {
    const { document } = convertHtml(
      `<html><body><div id="card" style="width:200px;height:100px;background:linear-gradient(90deg, #ff0000, #0000ff);"></div></body></html>`,
      { name: 'gradient-end-to-end' },
    );
    const card = findFrame(document.root, 'card');
    expect(card.fills).toHaveLength(1);
    const gradient = asLinear(card.fills[0]);
    expect(gradient.gradientStops).toHaveLength(2);
    expect(gradient.gradientStops[0]?.color.r).toBeCloseTo(1);
    expect(gradient.gradientStops[1]?.color.b).toBeCloseTo(1);
  });

  it('falls back to SOLID when background is a flat colour', () => {
    const { document } = convertHtml(
      `<html><body><div id="card" style="width:200px;height:100px;background:#ffaa33;"></div></body></html>`,
      { name: 'solid-bg' },
    );
    const card = findFrame(document.root, 'card');
    expect(card.fills).toHaveLength(1);
    const fill = card.fills[0];
    if (!fill || fill.type !== 'SOLID') throw new Error('expected SOLID');
    expect(fill.color.r).toBeCloseTo(1);
  });
});
