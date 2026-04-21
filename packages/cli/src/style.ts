/**
 * Inline-style parsing — `style="color: red; padding: 8px"` → typed map.
 * M2 only handles inline styles. M3 will replace this with the cascade engine.
 */

import type { Color, LetterSpacing, LineHeight } from '@claude-to-figma/ir';

export type InlineStyle = Map<string, string>;

/** Split a `style="..."` attribute into a normalized property → value map. */
export function parseInlineStyle(value: string | undefined): InlineStyle {
  const out: InlineStyle = new Map();
  if (!value) return out;
  for (const decl of value.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (prop && val) out.set(prop, val);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Length parsing — px / unitless number → number; everything else → undefined.
// M3 will add em/rem/% via the cascade engine.
// ---------------------------------------------------------------------------

export function parsePx(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === '0') return 0;
  const match = /^(-?\d+(?:\.\d+)?)(px)?$/i.exec(trimmed);
  if (!match) return undefined;
  return Number(match[1]);
}

// ---------------------------------------------------------------------------
// Color parsing — hex (#rgb, #rgba, #rrggbb, #rrggbbaa), rgb(), rgba(), named.
// ---------------------------------------------------------------------------

const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  transparent: [0, 0, 0],
};

export function parseColor(value: string | undefined): Color | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  if (v.startsWith('#')) {
    const hex = v.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = Number.parseInt(`${hex[0]}${hex[0]}`, 16);
      const g = Number.parseInt(`${hex[1]}${hex[1]}`, 16);
      const b = Number.parseInt(`${hex[2]}${hex[2]}`, 16);
      const a = hex.length === 4 ? Number.parseInt(`${hex[3]}${hex[3]}`, 16) / 255 : 1;
      return { r: r / 255, g: g / 255, b: b / 255, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b].some(Number.isNaN)) return undefined;
      return { r: r / 255, g: g / 255, b: b / 255, a };
    }
    return undefined;
  }

  const rgb = /^rgba?\(\s*([^)]+)\s*\)$/i.exec(v);
  if (rgb?.[1]) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return undefined;
    const r = parseChannel(parts[0]);
    const g = parseChannel(parts[1]);
    const b = parseChannel(parts[2]);
    const a = parts.length >= 4 ? parseAlpha(parts[3]) : 1;
    if (r == null || g == null || b == null || a == null) return undefined;
    return { r, g, b, a };
  }

  const named = NAMED_COLORS[v];
  if (named) {
    return { r: named[0] / 255, g: named[1] / 255, b: named[2] / 255, a: 1 };
  }
  return undefined;
}

function parseChannel(part: string | undefined): number | undefined {
  if (!part) return undefined;
  if (part.endsWith('%')) {
    const n = Number(part.slice(0, -1));
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : undefined;
  }
  const n = Number(part);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 255)) : undefined;
}

function parseAlpha(part: string | undefined): number | undefined {
  if (!part) return undefined;
  if (part.endsWith('%')) {
    const n = Number(part.slice(0, -1));
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : undefined;
  }
  const n = Number(part);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : undefined;
}

// ---------------------------------------------------------------------------
// Typography helpers
// ---------------------------------------------------------------------------

/** Map a CSS font-weight (numeric or keyword) to a Figma font-style name. */
export function weightToFigmaStyle(weight: string | undefined, italic: boolean): string {
  const base = (() => {
    if (!weight) return 'Regular';
    const w = weight.trim().toLowerCase();
    if (w === 'bold') return 'Bold';
    if (w === 'normal') return 'Regular';
    const n = Number(w);
    if (!Number.isFinite(n)) return 'Regular';
    if (n <= 100) return 'Thin';
    if (n <= 200) return 'Extra Light';
    if (n <= 300) return 'Light';
    if (n <= 400) return 'Regular';
    if (n <= 500) return 'Medium';
    if (n <= 600) return 'Semi Bold';
    if (n <= 700) return 'Bold';
    if (n <= 800) return 'Extra Bold';
    return 'Black';
  })();
  if (!italic) return base;
  return base === 'Regular' ? 'Italic' : `${base} Italic`;
}

/**
 * CSS generic font keywords. They aren't real installed fonts, so emitting
 * one in the IR's font manifest causes the Figma plugin to fail with a
 * missing-fonts error. We skip them and pick the next real family in the
 * stack; if every item in the stack is generic, fall back to undefined
 * (which the walker resolves to the default text style's Inter).
 */
const GENERIC_FONT_KEYWORDS = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  '-apple-system',
  'blinkmacsystemfont',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
]);

export function parseFontFamily(value: string | undefined): string | undefined {
  if (!value) return undefined;
  for (const raw of value.split(',')) {
    const cleaned = raw.trim().replace(/^["']|["']$/g, '');
    if (!cleaned) continue;
    if (GENERIC_FONT_KEYWORDS.has(cleaned.toLowerCase())) continue;
    return cleaned;
  }
  return undefined;
}

export function parseLineHeight(value: string | undefined): LineHeight | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'normal') return { unit: 'AUTO' };
  if (v.endsWith('%')) {
    const n = Number(v.slice(0, -1));
    return Number.isFinite(n) && n > 0 ? { unit: 'PERCENT', value: n } : undefined;
  }
  if (v.endsWith('px')) {
    const n = Number(v.slice(0, -2));
    return Number.isFinite(n) && n > 0 ? { unit: 'PIXELS', value: n } : undefined;
  }
  // Unitless multiplier — convert to PERCENT.
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return { unit: 'PERCENT', value: n * 100 };
  return undefined;
}

export function parseLetterSpacing(value: string | undefined): LetterSpacing | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'normal') return { unit: 'PIXELS', value: 0 };
  if (v.endsWith('%')) {
    const n = Number(v.slice(0, -1));
    return Number.isFinite(n) ? { unit: 'PERCENT', value: n } : undefined;
  }
  const n = parsePx(v);
  return n != null ? { unit: 'PIXELS', value: n } : undefined;
}

export function parseTextAlign(
  value: string | undefined,
): 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED' | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'left' || v === 'start') return 'LEFT';
  if (v === 'center') return 'CENTER';
  if (v === 'right' || v === 'end') return 'RIGHT';
  if (v === 'justify') return 'JUSTIFIED';
  return undefined;
}

export function parseTextDecoration(
  value: string | undefined,
): 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH' | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v.includes('underline')) return 'UNDERLINE';
  if (v.includes('line-through')) return 'STRIKETHROUGH';
  if (v === 'none') return 'NONE';
  return undefined;
}

export function parseTextTransform(
  value: string | undefined,
): 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'uppercase') return 'UPPER';
  if (v === 'lowercase') return 'LOWER';
  if (v === 'capitalize') return 'TITLE';
  if (v === 'none') return 'ORIGINAL';
  return undefined;
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/**
 * Count the tracks in a `grid-template-columns` (or -rows) value. Per ADR
 * 0008, we only need the track count — per-track sizing is ignored and
 * every cell is treated as 1fr. Handles `repeat(N, …)`, space-separated
 * track lists (`1fr 1fr 1fr`, `200px 200px`), mixed fixed/fractional
 * (`1fr auto 1fr`), and nested function calls like `minmax(100px, 1fr)`
 * by tokenising at the top level (respecting parens).
 */
export function parseGridTrackCount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'none') return undefined;
  const tokens = splitTopLevel(trimmed);
  let count = 0;
  for (const token of tokens) {
    const repeatMatch = /^repeat\(\s*(\d+)\s*,/i.exec(token);
    if (repeatMatch) {
      const n = Number(repeatMatch[1]);
      if (Number.isFinite(n) && n > 0) count += n;
      continue;
    }
    if (token) count += 1;
  }
  return count > 0 ? count : undefined;
}

/**
 * Split on top-level whitespace, respecting balanced parens. A nested
 * function call like `minmax(100px, 1fr)` stays as one token.
 */
function splitTopLevel(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (depth === 0 && /\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}
