/**
 * Per-frame effect reader.
 *
 * Reads the parsed shadow list stashed by the shorthand expander
 * (`__parsed-box-shadow`) and emits DROP_SHADOW / INNER_SHADOW effects.
 * Also reads blur radii from `__parsed-filter-blur` /
 * `__parsed-backdrop-filter-blur` and emits LAYER_BLUR /
 * BACKGROUND_BLUR. Non-blur `filter` functions were already dropped
 * by the cascade expander (see ADR 0007).
 */

import type { Effect } from '@claude-to-figma/ir';
import { type ComputedStyle, readParsedShadows } from '../cascade/index.js';
import { parseColor } from '../style.js';

export function readEffects(style: ComputedStyle): Effect[] {
  const effects: Effect[] = [];

  for (const shadow of readParsedShadows(style)) {
    const color = parseColor(shadow.color);
    if (!color) continue;
    effects.push({
      type: shadow.inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
      color,
      offset: { x: shadow.x, y: shadow.y },
      radius: shadow.blur,
      spread: shadow.spread,
      visible: true,
    });
  }

  const filterBlur = parseNumberKey(style.get('__parsed-filter-blur'));
  if (filterBlur != null && filterBlur > 0) {
    effects.push({ type: 'LAYER_BLUR', radius: filterBlur, visible: true });
  }

  const backdropBlur = parseNumberKey(style.get('__parsed-backdrop-filter-blur'));
  if (backdropBlur != null && backdropBlur > 0) {
    effects.push({ type: 'BACKGROUND_BLUR', radius: backdropBlur, visible: true });
  }

  return effects;
}

function parseNumberKey(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
