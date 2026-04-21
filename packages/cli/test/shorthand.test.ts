/**
 * Shorthand expansion tests (ADR 0007).
 *
 * Covers border / border-{side} expansion, box-shadow parsing (single
 * and multi), filter blur extraction, and the top-level splitter's
 * paren balancing.
 */

import { describe, expect, it } from 'vitest';
import {
  type ParsedShadow,
  expandShorthands,
  readParsedShadows,
} from '../src/cascade/shorthand.js';

function makeStyle(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

describe('shorthand: border', () => {
  it('splits `1px solid red` into four edges × three longhands', () => {
    const style = makeStyle({ border: '1px solid red' });
    expandShorthands(style);

    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(style.get(`border-${side}-width`)).toBe('1px');
      expect(style.get(`border-${side}-style`)).toBe('solid');
      expect(style.get(`border-${side}-color`)).toBe('red');
    }
    expect(style.has('border')).toBe(false);
  });

  it('handles components in any order', () => {
    const style = makeStyle({ border: 'red solid 2px' });
    expandShorthands(style);

    expect(style.get('border-top-width')).toBe('2px');
    expect(style.get('border-top-style')).toBe('solid');
    expect(style.get('border-top-color')).toBe('red');
  });

  it('keeps an rgba() color intact when it contains spaces', () => {
    const style = makeStyle({ border: '1px solid rgba(28, 26, 22, 0.12)' });
    expandShorthands(style);

    expect(style.get('border-top-color')).toBe('rgba(28, 26, 22, 0.12)');
    expect(style.get('border-top-width')).toBe('1px');
  });

  it('leaves missing components undefined rather than inventing them', () => {
    const style = makeStyle({ border: '1px' });
    expandShorthands(style);

    expect(style.get('border-top-width')).toBe('1px');
    expect(style.get('border-top-style')).toBeUndefined();
    expect(style.get('border-top-color')).toBeUndefined();
  });

  it('per-side shorthand beats the omnibus when both are present', () => {
    // `border-top` is processed before `border`; the omnibus expander
    // then fills remaining sides without clobbering border-top-*.
    const style = makeStyle({
      'border-top': '2px dashed blue',
      border: '1px solid red',
    });
    expandShorthands(style);

    expect(style.get('border-top-width')).toBe('2px');
    expect(style.get('border-top-style')).toBe('dashed');
    expect(style.get('border-top-color')).toBe('blue');
    expect(style.get('border-bottom-width')).toBe('1px');
    expect(style.get('border-bottom-style')).toBe('solid');
    expect(style.get('border-bottom-color')).toBe('red');
  });

  it('existing longhand beats the shorthand expander', () => {
    const style = makeStyle({
      border: '1px solid red',
      'border-top-color': 'blue',
    });
    expandShorthands(style);

    expect(style.get('border-top-color')).toBe('blue');
    expect(style.get('border-top-width')).toBe('1px');
  });

  it('expands a single-side shorthand only on that side', () => {
    const style = makeStyle({ 'border-top': '3px dashed green' });
    expandShorthands(style);

    expect(style.get('border-top-width')).toBe('3px');
    expect(style.get('border-top-style')).toBe('dashed');
    expect(style.get('border-top-color')).toBe('green');
    expect(style.get('border-bottom-width')).toBeUndefined();
  });
});

describe('shorthand: box-shadow', () => {
  function readFirst(style: Map<string, string>): ParsedShadow {
    const shadows = readParsedShadows(style);
    if (shadows.length === 0) throw new Error('expected at least one parsed shadow');
    const first = shadows[0];
    if (!first) throw new Error('expected at least one parsed shadow');
    return first;
  }

  it('parses a simple 2-length shadow with color', () => {
    const style = makeStyle({ 'box-shadow': '0 1px 0 rgba(28,26,22,.06)' });
    expandShorthands(style);

    const s = readFirst(style);
    expect(s.inset).toBe(false);
    expect(s.x).toBe(0);
    expect(s.y).toBe(1);
    expect(s.blur).toBe(0);
    expect(s.spread).toBe(0);
    expect(s.color).toBe('rgba(28,26,22,.06)');
  });

  it('parses a full 4-length shadow with negative spread', () => {
    const style = makeStyle({ 'box-shadow': '0 12px 40px -18px rgba(28,26,22,.18)' });
    expandShorthands(style);

    const s = readFirst(style);
    expect(s.x).toBe(0);
    expect(s.y).toBe(12);
    expect(s.blur).toBe(40);
    expect(s.spread).toBe(-18);
  });

  it('honours the inset keyword', () => {
    const style = makeStyle({ 'box-shadow': 'inset 0 2px 4px rgba(0,0,0,0.1)' });
    expandShorthands(style);

    expect(readFirst(style).inset).toBe(true);
  });

  it('splits multiple shadows on top-level commas (not rgba commas)', () => {
    const style = makeStyle({
      'box-shadow': '0 1px 0 rgba(28,26,22,.06), 0 12px 40px -18px rgba(28,26,22,.18)',
    });
    expandShorthands(style);

    const shadows = readParsedShadows(style);
    expect(shadows).toHaveLength(2);
    expect(shadows[0]?.y).toBe(1);
    expect(shadows[1]?.y).toBe(12);
  });

  it('drops malformed entries silently', () => {
    const style = makeStyle({ 'box-shadow': 'nonsense' });
    expandShorthands(style);

    expect(readParsedShadows(style)).toHaveLength(0);
  });

  it('removes the raw shorthand key', () => {
    const style = makeStyle({ 'box-shadow': '0 1px 0 black' });
    expandShorthands(style);

    expect(style.has('box-shadow')).toBe(false);
  });
});

describe('shorthand: filter / backdrop-filter', () => {
  it('extracts blur radius from filter: blur(8px)', () => {
    const style = makeStyle({ filter: 'blur(8px)' });
    expandShorthands(style);

    expect(style.get('__parsed-filter-blur')).toBe('8');
    expect(style.has('filter')).toBe(false);
  });

  it('extracts blur radius from backdrop-filter', () => {
    const style = makeStyle({ 'backdrop-filter': 'blur(12px)' });
    expandShorthands(style);

    expect(style.get('__parsed-backdrop-filter-blur')).toBe('12');
  });

  it('drops non-blur filter functions silently', () => {
    const style = makeStyle({ filter: 'saturate(0.35)' });
    expandShorthands(style);

    expect(style.get('__parsed-filter-blur')).toBeUndefined();
    expect(style.has('filter')).toBe(false);
  });

  it('keeps only the blur portion when mixed with other filters', () => {
    const style = makeStyle({ filter: 'saturate(0.5) blur(4px) contrast(1.1)' });
    expandShorthands(style);

    expect(style.get('__parsed-filter-blur')).toBe('4');
  });
});
