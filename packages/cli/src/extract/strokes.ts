/**
 * Per-frame stroke reader.
 *
 * Consumes the per-side border longhands produced by the cascade's
 * shorthand expansion (`border-{top|right|bottom|left}-{width|style|color}`).
 * Emits at most one Stroke per frame — Figma's stroke model has one
 * paint + weight per frame, so per-edge CSS fidelity collapses here.
 *
 * Uses the first usable side it finds; when sides differ the others
 * are silently dropped. Per-edge stroke support would need a schema
 * extension and is deferred (see ADR 0007).
 */

import type { Stroke } from '@claude-to-figma/ir';
import type { ComputedStyle } from '../cascade/index.js';
import { type LengthContext, parseColor, parsePx } from '../style.js';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

export function readStroke(style: ComputedStyle, ctx: LengthContext = {}): Stroke | undefined {
  for (const side of SIDES) {
    const width = parsePx(style.get(`border-${side}-width`), ctx);
    const styleToken = style.get(`border-${side}-style`)?.toLowerCase();
    const color = parseColor(style.get(`border-${side}-color`));

    if (width == null || width <= 0) continue;
    if (styleToken === 'none' || styleToken === 'hidden') continue;
    if (!color) continue;

    return {
      paint: { type: 'SOLID', color, opacity: 1, visible: true },
      weight: width,
      align: 'INSIDE',
    };
  }
  return undefined;
}
