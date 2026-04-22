/**
 * Shorthand expansion registry (see ADR 0007).
 *
 * Runs once per element after the cascade resolves `!important`,
 * inheritance, and `var()`. Each registered expander takes the raw
 * shorthand value and returns a set of longhand declarations to merge
 * into the computed-style map. The shorthand key itself is dropped
 * after expansion so consumers never see it.
 *
 * Existing longhands are not overridden — if the cascade already has
 * `border-top-width: 2px` (from a later, more specific declaration),
 * expanding `border: 1px solid red` won't clobber it. Per-side
 * shorthands are processed before the omnibus `border:` to keep the
 * "narrow then wide" pattern working on common CSS.
 *
 * `box-shadow` and `filter` are not classical CSS shorthands (no set
 * of named longhands), but they're parsed here too because the pattern
 * fits: one input value → a set of normalised keys the extractors can
 * read without re-parsing. Parsed shadow lists and filter blur radii
 * are stashed under `__parsed-*` keys because the cascade's contract
 * is `Map<string, string>` and widening it would have a larger blast
 * radius than the prefix trick.
 */

import type { ComputedStyle } from './types.js';

type Expander = (value: string) => Record<string, string>;

const BORDER_STYLE_KEYWORDS = new Set([
  'none',
  'hidden',
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
]);

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Side = (typeof SIDES)[number];

/**
 * Processed in order. Per-side shorthands first so that a pattern like:
 *   border: 1px solid #ccc;
 *   border-top: 2px dashed red;
 * produces per-side longhands from the more specific `border-top` first,
 * then `border` fills remaining sides without clobbering.
 */
const REGISTRY: Array<[string, Expander]> = [
  ['border-top', (v) => expandBorderSide('top', v)],
  ['border-right', (v) => expandBorderSide('right', v)],
  ['border-bottom', (v) => expandBorderSide('bottom', v)],
  ['border-left', (v) => expandBorderSide('left', v)],
  ['border', expandBorderAll],
  ['box-shadow', expandBoxShadow],
  ['filter', expandFilter],
  ['backdrop-filter', expandBackdropFilter],
  ['place-items', expandPlaceItems],
  ['place-content', expandPlaceContent],
  ['place-self', expandPlaceSelf],
];

export function expandShorthands(style: ComputedStyle): void {
  for (const [prop, expander] of REGISTRY) {
    const value = style.get(prop);
    if (value == null) continue;
    const expanded = expander(value);
    for (const [key, val] of Object.entries(expanded)) {
      if (!style.has(key)) style.set(key, val);
    }
    style.delete(prop);
  }
}

// ---------------------------------------------------------------------------
// Border
// ---------------------------------------------------------------------------

interface BorderTriple {
  width?: string;
  style?: string;
  color?: string;
}

/**
 * Split a `border`-style value into its three optional components.
 * Grammar: `[<width>] [<style>] [<color>]` in any order. The color
 * component may contain spaces (rgba(...)) so we greedily peel width
 * and style off the ends and treat the remainder as color.
 */
function parseBorderValue(value: string): BorderTriple {
  const tokens = splitTopLevel(value.trim(), ' ');
  const result: BorderTriple = {};
  const remaining: string[] = [];

  for (const token of tokens) {
    if (result.width == null && isBorderWidthToken(token)) {
      result.width = token;
      continue;
    }
    if (result.style == null && BORDER_STYLE_KEYWORDS.has(token.toLowerCase())) {
      result.style = token.toLowerCase();
      continue;
    }
    remaining.push(token);
  }

  if (remaining.length > 0) result.color = remaining.join(' ');
  return result;
}

function isBorderWidthToken(token: string): boolean {
  const t = token.toLowerCase();
  if (t === 'thin' || t === 'medium' || t === 'thick') return true;
  if (t === '0') return true;
  return /^-?\d+(?:\.\d+)?(px|em|rem|%)?$/i.test(t);
}

function expandBorderAll(value: string): Record<string, string> {
  const parsed = parseBorderValue(value);
  const out: Record<string, string> = {};
  for (const side of SIDES) applyBorderSide(out, side, parsed);
  return out;
}

function expandBorderSide(side: Side, value: string): Record<string, string> {
  const parsed = parseBorderValue(value);
  const out: Record<string, string> = {};
  applyBorderSide(out, side, parsed);
  return out;
}

function applyBorderSide(out: Record<string, string>, side: Side, parsed: BorderTriple): void {
  if (parsed.width != null) out[`border-${side}-width`] = parsed.width;
  if (parsed.style != null) out[`border-${side}-style`] = parsed.style;
  if (parsed.color != null) out[`border-${side}-color`] = parsed.color;
}

// ---------------------------------------------------------------------------
// Box-shadow
// ---------------------------------------------------------------------------

export interface ParsedShadow {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

/**
 * Parse a `box-shadow` value into a list of ParsedShadow. Grammar:
 *   [inset?] <offset-x> <offset-y> [<blur>] [<spread>] [<color>]
 * Multiple shadows are comma-separated. We split on top-level commas
 * (so an rgba(r, g, b, a) color doesn't terminate a shadow).
 */
function expandBoxShadow(value: string): Record<string, string> {
  const parts = splitTopLevel(value.trim(), ',');
  const parsed: ParsedShadow[] = [];
  for (const part of parts) {
    const shadow = parseShadow(part.trim());
    if (shadow) parsed.push(shadow);
  }
  if (parsed.length === 0) return {};
  return { '__parsed-box-shadow': JSON.stringify(parsed) };
}

function parseShadow(input: string): ParsedShadow | null {
  if (!input) return null;
  const tokens = splitTopLevel(input, ' ');

  let inset = false;
  const lengthsOrColors: string[] = [];
  for (const token of tokens) {
    if (token.toLowerCase() === 'inset') {
      inset = true;
      continue;
    }
    lengthsOrColors.push(token);
  }

  // Greedily read leading length tokens; the tail is the color.
  const lengths: number[] = [];
  let colorIdx = lengthsOrColors.length;
  for (let i = 0; i < lengthsOrColors.length; i++) {
    const raw = lengthsOrColors[i];
    if (raw == null) break;
    const n = parseLength(raw);
    if (n == null) {
      colorIdx = i;
      break;
    }
    lengths.push(n);
  }
  const color = lengthsOrColors.slice(colorIdx).join(' ').trim() || 'rgba(0,0,0,1)';

  // Need at least offset-x and offset-y.
  if (lengths.length < 2) return null;
  const x = lengths[0] ?? 0;
  const y = lengths[1] ?? 0;
  const blur = lengths[2] ?? 0;
  const spread = lengths[3] ?? 0;
  return { inset, x, y, blur, spread, color };
}

function parseLength(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (t === '0') return 0;
  const match = /^(-?\d+(?:\.\d+)?)(px)?$/i.exec(t);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

export function readParsedShadows(style: ComputedStyle): ParsedShadow[] {
  const raw = style.get('__parsed-box-shadow');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ParsedShadow[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Filter / backdrop-filter
// ---------------------------------------------------------------------------

/**
 * Walk `filter: …` tokens and keep only `blur(<length>)`. Figma has no
 * equivalent for saturate / contrast / brightness / hue-rotate / invert /
 * grayscale / sepia / drop-shadow-as-filter so they're dropped silently.
 * The extractor logs a warning when this happens.
 */
function expandFilter(value: string): Record<string, string> {
  const radius = extractBlurRadius(value);
  if (radius == null) return {};
  return { '__parsed-filter-blur': String(radius) };
}

function expandBackdropFilter(value: string): Record<string, string> {
  const radius = extractBlurRadius(value);
  if (radius == null) return {};
  return { '__parsed-backdrop-filter-blur': String(radius) };
}

function extractBlurRadius(value: string): number | null {
  const match = /\bblur\(\s*([^)]+)\s*\)/i.exec(value);
  if (!match) return null;
  return parseLength(match[1] ?? '') ?? null;
}

// ---------------------------------------------------------------------------
// Top-level splitter — respects balanced parens so rgba(a, b, c, d) doesn't
// get cut in half by a separator inside.
// ---------------------------------------------------------------------------

function splitTopLevel(value: string, separator: ' ' | ','): string[] {
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
    if (depth === 0 && matchesSeparator(ch, separator)) {
      if (current.length > 0) out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.length > 0) out.push(current);
  return out;
}

function matchesSeparator(ch: string, sep: ' ' | ','): boolean {
  if (sep === ',') return ch === ',';
  return ch === ' ' || ch === '\t' || ch === '\n';
}

// ---------------------------------------------------------------------------
// place-* shorthands (grid / flex alignment)
// ---------------------------------------------------------------------------

/**
 * `place-items: <align-items> [<justify-items>]` — single-value form
 * applies to both axes (e.g. `place-items: center`). Without this
 * expansion, a grid child with `place-items: center` on the parent has
 * no `align-items`, so `mapFlexChild` falls back to CSS's `stretch`
 * default and stretches the child — wrong for centered grid cells.
 */
function expandPlaceItems(value: string): Record<string, string> {
  const parts = splitTopLevel(value.trim(), ' ');
  const a = parts[0];
  if (!a) return {};
  const b = parts[1] ?? a;
  return { 'align-items': a, 'justify-items': b };
}

function expandPlaceContent(value: string): Record<string, string> {
  const parts = splitTopLevel(value.trim(), ' ');
  const a = parts[0];
  if (!a) return {};
  const b = parts[1] ?? a;
  return { 'align-content': a, 'justify-content': b };
}

function expandPlaceSelf(value: string): Record<string, string> {
  const parts = splitTopLevel(value.trim(), ' ');
  const a = parts[0];
  if (!a) return {};
  const b = parts[1] ?? a;
  return { 'align-self': a, 'justify-self': b };
}
