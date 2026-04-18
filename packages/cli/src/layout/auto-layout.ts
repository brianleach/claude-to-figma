/**
 * CSS flex → Figma auto-layout mapping.
 *
 * Input: cascade-resolved ComputedStyle for an element (and its parent for
 * child-side decisions).
 * Output: IR `LayoutProps` for flex containers, IR `ChildLayout` for items
 * inside flex containers.
 *
 * Yoga still computes the geometry — this module's only job is to mark
 * flex frames so the Figma plugin builds them as real auto-layout frames
 * (`frame.layoutMode = HORIZONTAL/VERTICAL`) instead of plain frames with
 * absolute child positions.
 */

import type { ChildLayout, LayoutProps } from '@claude-to-figma/ir';
import type { ComputedStyle } from '../cascade/index.js';
import { parsePx } from '../style.js';

/**
 * Returns `LayoutProps` when this element is a flex container, otherwise
 * `undefined`. Padding always carries through (Figma honors padding even
 * on non-auto-layout frames if `layoutMode != NONE`, but on plain frames
 * it's ignored — so we only emit on flex containers).
 */
export function mapFlexContainer(style: ComputedStyle): LayoutProps | undefined {
  const display = (style.get('display') ?? '').toLowerCase();
  if (display !== 'flex' && display !== 'inline-flex') return undefined;

  const flexDirection = (style.get('flex-direction') ?? 'row').toLowerCase();
  const layoutMode: 'HORIZONTAL' | 'VERTICAL' =
    flexDirection === 'column' || flexDirection === 'column-reverse' ? 'VERTICAL' : 'HORIZONTAL';

  const wrap = (style.get('flex-wrap') ?? 'nowrap').toLowerCase();
  const layoutWrap: 'NO_WRAP' | 'WRAP' =
    wrap === 'wrap' || wrap === 'wrap-reverse' ? 'WRAP' : 'NO_WRAP';

  const padding = readPadding(style);

  // Gap → itemSpacing (main axis) + counterAxisSpacing (cross axis).
  // CSS `row-gap` is the gap between rows (cross axis in horizontal flex,
  // main axis in vertical). `column-gap` is the inverse. The shorthand
  // `gap` sets both.
  const { itemSpacing, counterAxisSpacing } = readGaps(style, layoutMode);

  return {
    layoutMode,
    itemSpacing,
    counterAxisSpacing,
    paddingTop: padding.top,
    paddingRight: padding.right,
    paddingBottom: padding.bottom,
    paddingLeft: padding.left,
    primaryAxisAlignItems: mapPrimaryAxis(style.get('justify-content')),
    counterAxisAlignItems: mapCounterAxis(style.get('align-items')),
    layoutWrap,
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    clipsContent: false,
  };
}

/**
 * Decorate a child of an auto-layout parent with `ChildLayout`. Returns
 * `undefined` when the parent is not a flex container — in that case the
 * child needs no per-child layout metadata.
 */
export function mapFlexChild(
  parentStyle: ComputedStyle,
  childStyle: ComputedStyle,
): ChildLayout | undefined {
  const parentDisplay = (parentStyle.get('display') ?? '').toLowerCase();
  if (parentDisplay !== 'flex' && parentDisplay !== 'inline-flex') return undefined;

  const childPosition = (childStyle.get('position') ?? 'static').toLowerCase();
  const layoutPositioning: 'AUTO' | 'ABSOLUTE' =
    childPosition === 'absolute' || childPosition === 'fixed' ? 'ABSOLUTE' : 'AUTO';

  const flexGrow = Number(childStyle.get('flex-grow') ?? '0');

  // align-items defaults to `stretch` in CSS. Figma's counterAxisAlignItems
  // has no STRETCH value — instead per-child layoutAlign STRETCH does the
  // job. So if `align-self` is unset and parent's `align-items` is stretch
  // (or unset → CSS default), the child should stretch on the cross axis.
  const alignSelf = (childStyle.get('align-self') ?? '').toLowerCase();
  const parentAlignItems = (parentStyle.get('align-items') ?? 'stretch').toLowerCase();
  const stretches =
    alignSelf === 'stretch' ||
    (alignSelf === '' && (parentAlignItems === 'stretch' || parentAlignItems === 'normal'));
  const layoutAlign: 'INHERIT' | 'STRETCH' = stretches ? 'STRETCH' : 'INHERIT';

  return {
    layoutPositioning,
    layoutGrow: Number.isFinite(flexGrow) && flexGrow > 0 ? flexGrow : 0,
    layoutAlign,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readPadding(style: ComputedStyle): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  // Longhands win when present.
  const top = parsePx(style.get('padding-top'));
  const right = parsePx(style.get('padding-right'));
  const bottom = parsePx(style.get('padding-bottom'));
  const left = parsePx(style.get('padding-left'));

  const shorthand = expandShorthand(style.get('padding'));
  return {
    top: top ?? shorthand.top,
    right: right ?? shorthand.right,
    bottom: bottom ?? shorthand.bottom,
    left: left ?? shorthand.left,
  };
}

function expandShorthand(value: string | undefined): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  if (!value) return { top: 0, right: 0, bottom: 0, left: 0 };
  const parts = value
    .trim()
    .split(/\s+/)
    .map((p) => parsePx(p) ?? 0);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? a;
  const c = parts[2] ?? a;
  const d = parts[3] ?? b;
  return { top: a, right: b, bottom: c, left: d };
}

function readGaps(
  style: ComputedStyle,
  layoutMode: 'HORIZONTAL' | 'VERTICAL',
): { itemSpacing: number; counterAxisSpacing: number } {
  // gap shorthand: `gap: <row-gap> [<column-gap>]`
  const gap = style.get('gap');
  let rowGap = parsePx(style.get('row-gap'));
  let colGap = parsePx(style.get('column-gap'));
  if (gap) {
    const parts = gap.trim().split(/\s+/);
    const r = parsePx(parts[0]);
    const c = parts[1] !== undefined ? parsePx(parts[1]) : r;
    if (rowGap == null && r != null) rowGap = r;
    if (colGap == null && c != null) colGap = c;
  }
  rowGap ??= 0;
  colGap ??= 0;

  // CSS row-gap = between rows (cross axis in horizontal flow).
  // CSS column-gap = between columns (cross axis in vertical flow).
  if (layoutMode === 'HORIZONTAL') {
    return { itemSpacing: colGap, counterAxisSpacing: rowGap };
  }
  return { itemSpacing: rowGap, counterAxisSpacing: colGap };
}

function mapPrimaryAxis(value: string | undefined): 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'flex-end':
    case 'end':
    case 'right':
      return 'MAX';
    case 'center':
      return 'CENTER';
    case 'space-between':
      return 'SPACE_BETWEEN';
    // Figma has no SPACE_AROUND / SPACE_EVENLY — collapse to SPACE_BETWEEN
    // since visually it's the closest auto-layout primitive that distributes
    // gaps. Yoga still computes the exact CSS positions for the geometry,
    // so the absolute pixels reflect the original CSS faithfully even if a
    // designer later edits the auto-layout frame.
    case 'space-around':
    case 'space-evenly':
      return 'SPACE_BETWEEN';
    default:
      return 'MIN';
  }
}

function mapCounterAxis(value: string | undefined): 'MIN' | 'CENTER' | 'MAX' | 'BASELINE' {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'flex-end':
    case 'end':
      return 'MAX';
    case 'center':
      return 'CENTER';
    case 'baseline':
      return 'BASELINE';
    // align-items: stretch → counter-axis MIN + per-child layoutAlign STRETCH
    // (handled in mapFlexChild). We leave the parent at MIN here so children
    // that don't opt out via align-self end up sized to fill the container.
    default:
      return 'MIN';
  }
}
