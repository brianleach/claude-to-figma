/**
 * CSS `linear-gradient(…)` / `radial-gradient(…)` → IR Paint (ADR 0009).
 *
 * The CLI computes the Figma 2×3 gradient transform matrix at emit time
 * so the plugin stays a pass-through. Angular / conic / diamond
 * gradients are deferred.
 *
 * Grammar support (informal):
 *   linear-gradient( [<angle> | to <side>,]? <color-stop> [, <color-stop>]+ )
 *   radial-gradient( [<shape-size-position>,]? <color-stop> [, <color-stop>]+ )
 *
 * Shape / size / position on radial gradients are parsed and discarded —
 * Figma's default (ellipse, farthest-corner, centre) is the output. See
 * the ADR for the full consequence list.
 */

import type { GradientStop, GradientTransform, Paint } from '@claude-to-figma/ir';
import { parseColor } from '../style.js';

export function parseCssGradient(value: string | undefined): Paint | undefined {
  if (!value) return undefined;
  const v = value.trim();
  const linearMatch = /^linear-gradient\s*\(\s*([\s\S]+)\s*\)\s*$/i.exec(v);
  if (linearMatch?.[1]) return parseLinearGradient(linearMatch[1]);
  const radialMatch = /^radial-gradient\s*\(\s*([\s\S]+)\s*\)\s*$/i.exec(v);
  if (radialMatch?.[1]) return parseRadialGradient(radialMatch[1]);
  return undefined;
}

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

function parseLinearGradient(inner: string): Paint | undefined {
  const parts = splitTopLevel(inner, ',');
  if (parts.length < 2) return undefined;

  // First part is either a direction/angle or the first color stop.
  const firstDirection = parseDirection(parts[0] ?? '');
  let angleDeg = 180; // CSS default is `to bottom`.
  let stopParts: string[];
  if (firstDirection != null) {
    angleDeg = firstDirection;
    stopParts = parts.slice(1);
  } else {
    stopParts = parts;
  }

  const stops = parseStops(stopParts);
  if (stops.length < 2) return undefined;

  return {
    type: 'GRADIENT_LINEAR',
    gradientTransform: linearTransformForAngle(angleDeg),
    gradientStops: stops,
    opacity: 1,
    visible: true,
  };
}

/**
 * Parse a CSS angle expression (`45deg`, `0.5turn`, `0.25rad`) or a
 * direction keyword (`to right`, `to bottom left`). Returns the CSS-
 * convention angle in degrees (0 = up, 90 = right, 180 = down, …)
 * or undefined when the token isn't a direction.
 */
function parseDirection(token: string): number | undefined {
  const t = token.trim().toLowerCase();
  if (!t) return undefined;

  // Numeric angle: 45deg, 0.5turn, 1rad, 100grad, or a bare number (treated as deg).
  const angle = parseAngle(t);
  if (angle != null) return angle;

  // Keyword direction: `to right`, `to bottom left`, etc.
  if (!t.startsWith('to ')) return undefined;
  const sides = t.slice(3).split(/\s+/).filter(Boolean);
  const hasTop = sides.includes('top');
  const hasBottom = sides.includes('bottom');
  const hasLeft = sides.includes('left');
  const hasRight = sides.includes('right');
  if (hasTop && hasRight) return 45;
  if (hasBottom && hasRight) return 135;
  if (hasBottom && hasLeft) return 225;
  if (hasTop && hasLeft) return 315;
  if (hasTop) return 0;
  if (hasRight) return 90;
  if (hasBottom) return 180;
  if (hasLeft) return 270;
  return undefined;
}

function parseAngle(t: string): number | undefined {
  const match = /^(-?\d+(?:\.\d+)?)(deg|turn|rad|grad)?$/i.exec(t);
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = (match[2] ?? 'deg').toLowerCase();
  if (unit === 'deg') return n;
  if (unit === 'turn') return n * 360;
  if (unit === 'rad') return (n * 180) / Math.PI;
  if (unit === 'grad') return (n * 360) / 400;
  return undefined;
}

/**
 * CSS angle θ (0 = up, 90 = right, 180 = down, 270 = left) →
 * 2×3 affine matrix that maps the gradient's canonical unit line
 * [(0,0) → (1,0)] onto the gradient line in paint space, with (0,1)
 * as the perpendicular. Center of paint-local space is (0.5, 0.5).
 */
function linearTransformForAngle(angleDeg: number): GradientTransform {
  const rad = (angleDeg * Math.PI) / 180;
  // Direction vector in paint-local coords (y axis points down).
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  // Perpendicular: rotate direction 90° CCW → (-dy, dx).
  // Matrix: [[dx, -dy, cx - dx/2], [dy, dx, cy - dy/2]] with center (0.5, 0.5).
  return [
    [dx, -dy, 0.5 - dx / 2],
    [dy, dx, 0.5 - dy / 2],
  ];
}

// ---------------------------------------------------------------------------
// Radial
// ---------------------------------------------------------------------------

function parseRadialGradient(inner: string): Paint | undefined {
  const parts = splitTopLevel(inner, ',');
  if (parts.length < 2) return undefined;

  // Detect a leading shape/size/position token. If parseColor on the
  // first part fails AND it doesn't look like a stop (no colour-able
  // leading token), treat it as the shape descriptor and discard.
  const firstStop = tryParseStop(parts[0] ?? '');
  const stopParts = firstStop ? parts : parts.slice(1);
  const stops = parseStops(stopParts);
  if (stops.length < 2) return undefined;

  return {
    type: 'GRADIENT_RADIAL',
    gradientTransform: radialDefaultTransform(),
    gradientStops: stops,
    opacity: 1,
    visible: true,
  };
}

/**
 * Figma's default radial gradient transform — centre at (0.5, 0.5)
 * with a radius that reaches (1, 0.5) on the x-axis and (0.5, 1) on
 * the y-axis (ellipse fitting the paint bounds).
 */
function radialDefaultTransform(): GradientTransform {
  return [
    [0.5, 0, 0.5],
    [0, 0.5, 0.5],
  ];
}

// ---------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------

function parseStops(parts: string[]): GradientStop[] {
  const parsed: { color: GradientStop['color']; position?: number }[] = [];
  for (const raw of parts) {
    const stop = tryParseStop(raw);
    if (stop) parsed.push(stop);
  }
  if (parsed.length < 2) return [];

  // Assign positions to stops without an explicit one: first = 0, last = 1,
  // intermediates spaced evenly (per CSS spec). Skipping mid-point colour hints.
  const result: GradientStop[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    if (!p) continue;
    let position = p.position;
    if (position == null) {
      if (i === 0) position = 0;
      else if (i === parsed.length - 1) position = 1;
      else position = i / (parsed.length - 1);
    }
    result.push({ position: clamp01(position), color: p.color });
  }
  return result;
}

function tryParseStop(raw: string): { color: GradientStop['color']; position?: number } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Extract colour (may contain spaces inside rgba()/hsl()) and optional
  // trailing length/percentage. Strategy: find the last top-level whitespace
  // and check if the trailing token looks like a length/percentage.
  const tokens = splitTopLevel(trimmed, ' ');
  if (tokens.length === 0) return null;

  // Try: last token = length, rest = colour.
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1] ?? '';
    const pos = parsePosition(last);
    if (pos != null) {
      const colorStr = tokens.slice(0, -1).join(' ');
      const color = parseColor(colorStr);
      if (color) return { color, position: pos };
    }
  }

  // Otherwise: the whole thing is a colour.
  const color = parseColor(trimmed);
  if (!color) return null;
  return { color };
}

function parsePosition(token: string): number | undefined {
  const t = token.trim().toLowerCase();
  if (t.endsWith('%')) {
    const n = Number(t.slice(0, -1));
    return Number.isFinite(n) ? clamp01(n / 100) : undefined;
  }
  // px — convert to a fraction assuming 1 unit = 1px (Figma normalises later).
  // For gradient stops it's uncommon to see px; percent is dominant.
  if (t.endsWith('px')) {
    const n = Number(t.slice(0, -2));
    return Number.isFinite(n) ? Math.max(0, n) : undefined;
  }
  return undefined;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ---------------------------------------------------------------------------
// Top-level tokenizer (paren-aware)
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
    if (depth === 0 && matchesSep(ch, separator)) {
      if (current.trim()) out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function matchesSep(ch: string, sep: ' ' | ','): boolean {
  if (sep === ',') return ch === ',';
  return ch === ' ' || ch === '\t' || ch === '\n';
}
