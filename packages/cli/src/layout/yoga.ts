/**
 * Map cascade-resolved CSS to a Yoga tree, compute layout, and return
 * absolute geometry per element.
 *
 * yoga-layout 3.x ships a preloaded WASM build via top-level await — the
 * import resolves once at module init, after which every Yoga.Node call
 * is synchronous. Memory is freed via `freeRecursive()` on the root.
 */

import Yoga, {
  Align,
  Display,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  type Node as YogaNode,
  PositionType,
  Wrap,
} from 'yoga-layout';
import type { ComputedStyle, P5Element } from '../cascade/index.js';
import { IGNORED_TAGS, collectInnerText, isTextElement } from '../classify.js';
import { parseLineHeight, parsePx } from '../style.js';
import { measureText } from './measure.js';

export interface ComputedGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayoutMap = Map<P5Element, ComputedGeometry>;

/**
 * Build a Yoga tree mirroring the parse5 element tree, run layout, and
 * return parent-relative geometry for every visited element.
 */
export function computeLayout(root: P5Element, styles: Map<P5Element, ComputedStyle>): LayoutMap {
  const yogaByEl = new Map<P5Element, YogaNode>();

  const buildYoga = (el: P5Element): YogaNode => {
    const yoga = Yoga.Node.create();
    yogaByEl.set(el, yoga);
    const style = styles.get(el) ?? new Map();
    applyYogaStyle(yoga, style);

    if (isTextElement(el)) {
      // TEXT nodes never have children — yoga measures them via the callback.
      yoga.setMeasureFunc(buildMeasureFn(el, style));
      return yoga;
    }

    let index = 0;
    for (const child of el.childNodes) {
      if (isElement(child)) {
        if (IGNORED_TAGS.has(child.tagName.toLowerCase())) continue;
        yoga.insertChild(buildYoga(child), index);
        index += 1;
      } else if (child.nodeName === '#text' && 'value' in child) {
        // Bare text inside a frame: the IR walker wraps it in an anonymous
        // TEXT IR node, so yoga needs a matching measure node here or the
        // parent frame collapses to height 0.
        const text = child.value.trim();
        if (!text) continue;
        const textYoga = Yoga.Node.create();
        textYoga.setMeasureFunc(buildBareTextMeasureFn(text, style));
        yoga.insertChild(textYoga, index);
        index += 1;
      }
    }
    return yoga;
  };

  const yogaRoot = buildYoga(root);
  yogaRoot.calculateLayout(undefined, undefined, undefined);

  // Yoga returns parent-relative positions; the IR also wants parent-relative
  // (Figma's appendChild treats x/y as parent-relative). Pass through as-is.
  const result: LayoutMap = new Map();
  for (const [el, yoga] of yogaByEl) {
    const layout = yoga.getComputedLayout();
    result.set(el, {
      x: layout.left,
      y: layout.top,
      width: layout.width,
      height: layout.height,
    });
  }
  yogaRoot.freeRecursive();
  return result;
}

// ---------------------------------------------------------------------------
// Text measurement
// ---------------------------------------------------------------------------

function buildMeasureFn(el: P5Element, style: ComputedStyle) {
  const fontSize = parsePx(style.get('font-size')) ?? 16;
  const lineHeight = parseLineHeight(style.get('line-height')) ?? { unit: 'AUTO' };
  return measureText({
    characters: collectInnerText(el),
    fontSize,
    lineHeight,
  });
}

/** Same heuristic, but the parent's resolved style provides the font size /
 * line-height (since bare-text nodes inherit typography from their parent). */
function buildBareTextMeasureFn(characters: string, parentStyle: ComputedStyle) {
  const fontSize = parsePx(parentStyle.get('font-size')) ?? 16;
  const lineHeight = parseLineHeight(parentStyle.get('line-height')) ?? { unit: 'AUTO' };
  return measureText({ characters, fontSize, lineHeight });
}

// ---------------------------------------------------------------------------
// CSS → Yoga style mapping
// ---------------------------------------------------------------------------

function applyYogaStyle(node: YogaNode, style: ComputedStyle): void {
  // Display ----------------------------------------------------------------
  const display = (style.get('display') ?? 'block').toLowerCase();
  if (display === 'none') {
    node.setDisplay(Display.None);
    return;
  }
  node.setDisplay(Display.Flex);

  const isFlex = display === 'flex' || display === 'inline-flex';

  // Position ---------------------------------------------------------------
  const position = (style.get('position') ?? 'static').toLowerCase();
  if (position === 'absolute' || position === 'fixed') {
    node.setPositionType(PositionType.Absolute);
  } else if (position === 'relative') {
    node.setPositionType(PositionType.Relative);
  } else {
    node.setPositionType(PositionType.Static);
  }

  // top / right / bottom / left
  applyEdgeLength(style.get('top'), (v) => node.setPosition(Edge.Top, v));
  applyEdgeLength(style.get('right'), (v) => node.setPosition(Edge.Right, v));
  applyEdgeLength(style.get('bottom'), (v) => node.setPosition(Edge.Bottom, v));
  applyEdgeLength(style.get('left'), (v) => node.setPosition(Edge.Left, v));

  // Dimensions -------------------------------------------------------------
  applyDimension(style.get('width'), (v) => node.setWidth(v));
  applyDimension(style.get('height'), (v) => node.setHeight(v));
  // min/max accept number or % only, not 'auto'.
  applyEdgeLength(style.get('min-width'), (v) => node.setMinWidth(v));
  applyEdgeLength(style.get('min-height'), (v) => node.setMinHeight(v));
  applyEdgeLength(style.get('max-width'), (v) => node.setMaxWidth(v));
  applyEdgeLength(style.get('max-height'), (v) => node.setMaxHeight(v));

  // Padding (longhands + 1–4 value shorthand) ------------------------------
  applyEdgeLength(style.get('padding-top'), (v) => node.setPadding(Edge.Top, v));
  applyEdgeLength(style.get('padding-right'), (v) => node.setPadding(Edge.Right, v));
  applyEdgeLength(style.get('padding-bottom'), (v) => node.setPadding(Edge.Bottom, v));
  applyEdgeLength(style.get('padding-left'), (v) => node.setPadding(Edge.Left, v));
  applyShorthand(style.get('padding'), (edge, v) => node.setPadding(edge, v));

  // Margin -----------------------------------------------------------------
  applyEdgeLength(style.get('margin-top'), (v) => node.setMargin(Edge.Top, v));
  applyEdgeLength(style.get('margin-right'), (v) => node.setMargin(Edge.Right, v));
  applyEdgeLength(style.get('margin-bottom'), (v) => node.setMargin(Edge.Bottom, v));
  applyEdgeLength(style.get('margin-left'), (v) => node.setMargin(Edge.Left, v));
  applyShorthand(style.get('margin'), (edge, v) => node.setMargin(edge, v));

  // Border (geometry contribution only — paint comes from the cascade) ----
  applyEdgeLength(style.get('border-top-width'), (v) => node.setBorder(Edge.Top, lengthOrZero(v)));
  applyEdgeLength(style.get('border-right-width'), (v) =>
    node.setBorder(Edge.Right, lengthOrZero(v)),
  );
  applyEdgeLength(style.get('border-bottom-width'), (v) =>
    node.setBorder(Edge.Bottom, lengthOrZero(v)),
  );
  applyEdgeLength(style.get('border-left-width'), (v) =>
    node.setBorder(Edge.Left, lengthOrZero(v)),
  );

  // Flex container ---------------------------------------------------------
  // Yoga's default flex direction is COLUMN, which gives us block-like
  // stacking by default. For real flex containers we honour the CSS
  // flex-direction; for non-flex (default block) we force COLUMN explicitly.
  if (isFlex) {
    const dir = (style.get('flex-direction') ?? 'row').toLowerCase();
    node.setFlexDirection(toFlexDirection(dir));

    const wrap = (style.get('flex-wrap') ?? 'nowrap').toLowerCase();
    node.setFlexWrap(toWrap(wrap));

    const justify = style.get('justify-content');
    if (justify) node.setJustifyContent(toJustify(justify));

    const align = style.get('align-items');
    if (align) node.setAlignItems(toAlign(align));

    // gap shorthand or per-axis longhands
    applyEdgeLength(style.get('gap'), (v) => node.setGap(Gutter.All, v));
    applyEdgeLength(style.get('row-gap'), (v) => node.setGap(Gutter.Row, v));
    applyEdgeLength(style.get('column-gap'), (v) => node.setGap(Gutter.Column, v));
  } else {
    node.setFlexDirection(FlexDirection.Column);
  }

  // Flex item --------------------------------------------------------------
  const flexGrow = style.get('flex-grow');
  if (flexGrow != null) {
    const n = Number(flexGrow);
    if (Number.isFinite(n)) node.setFlexGrow(n);
  }
  const flexShrink = style.get('flex-shrink');
  if (flexShrink != null) {
    const n = Number(flexShrink);
    if (Number.isFinite(n)) node.setFlexShrink(n);
  }
  const flexBasis = style.get('flex-basis');
  if (flexBasis != null) {
    const yv = toYogaLength(flexBasis);
    if (yv != null) node.setFlexBasis(yv);
  }
  const alignSelf = style.get('align-self');
  if (alignSelf) node.setAlignSelf(toAlign(alignSelf));
}

// ---------------------------------------------------------------------------
// Length parsing
// ---------------------------------------------------------------------------

type YogaLength = number | `${number}%` | 'auto' | undefined;

function toYogaLength(value: string | undefined): YogaLength {
  if (value == null) return undefined;
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'auto') return 'auto';
  if (v.endsWith('%')) {
    const n = Number(v.slice(0, -1));
    return Number.isFinite(n) ? (`${n}%` as `${number}%`) : undefined;
  }
  if (v === '0') return 0;
  // Strip a px suffix or accept a bare number.
  const match = /^(-?\d+(?:\.\d+)?)(px)?$/i.exec(v);
  if (!match) return undefined;
  return Number(match[1]);
}

function applyDimension(value: string | undefined, set: (v: YogaLength) => void): void {
  const v = toYogaLength(value);
  if (v == null) return;
  set(v);
}

function applyEdgeLength(value: string | undefined, set: (v: number | `${number}%`) => void): void {
  const v = toYogaLength(value);
  if (v == null || v === 'auto') return;
  set(v);
}

function applyShorthand(
  value: string | undefined,
  set: (edge: Edge, v: number | `${number}%`) => void,
): void {
  if (!value) return;
  const parts = value.trim().split(/\s+/).map(toYogaLength);
  const edges = expandShorthand(parts);
  if (!edges) return;
  set(Edge.Top, edges.top);
  set(Edge.Right, edges.right);
  set(Edge.Bottom, edges.bottom);
  set(Edge.Left, edges.left);
}

function expandShorthand(parts: YogaLength[]):
  | {
      top: number | `${number}%`;
      right: number | `${number}%`;
      bottom: number | `${number}%`;
      left: number | `${number}%`;
    }
  | undefined {
  const usable = parts.filter((p): p is number | `${number}%` => p != null && p !== 'auto');
  const a = usable[0];
  if (a == null) return undefined;
  const b = usable[1] ?? a;
  const c = usable[2] ?? a;
  const d = usable[3] ?? b;
  return { top: a, right: b, bottom: c, left: d };
}

function lengthOrZero(v: number | `${number}%`): number {
  return typeof v === 'number' ? v : 0;
}

// ---------------------------------------------------------------------------
// Enum mapping
// ---------------------------------------------------------------------------

function toFlexDirection(v: string): FlexDirection {
  switch (v) {
    case 'row':
      return FlexDirection.Row;
    case 'row-reverse':
      return FlexDirection.RowReverse;
    case 'column-reverse':
      return FlexDirection.ColumnReverse;
    default:
      return FlexDirection.Column;
  }
}

function toWrap(v: string): Wrap {
  if (v === 'wrap') return Wrap.Wrap;
  if (v === 'wrap-reverse') return Wrap.WrapReverse;
  return Wrap.NoWrap;
}

function toJustify(v: string): Justify {
  switch (v.trim().toLowerCase()) {
    case 'flex-end':
    case 'end':
    case 'right':
      return Justify.FlexEnd;
    case 'center':
      return Justify.Center;
    case 'space-between':
      return Justify.SpaceBetween;
    case 'space-around':
      return Justify.SpaceAround;
    case 'space-evenly':
      return Justify.SpaceEvenly;
    default:
      return Justify.FlexStart;
  }
}

function toAlign(v: string): Align {
  switch (v.trim().toLowerCase()) {
    case 'flex-end':
    case 'end':
      return Align.FlexEnd;
    case 'center':
      return Align.Center;
    case 'baseline':
      return Align.Baseline;
    case 'stretch':
      return Align.Stretch;
    case 'flex-start':
    case 'start':
      return Align.FlexStart;
    default:
      return Align.Auto;
  }
}

// ---------------------------------------------------------------------------
// Tree adapter helpers
// ---------------------------------------------------------------------------

function isElement(node: { nodeName: string }): node is P5Element {
  return 'tagName' in node && node.nodeName !== '#text' && node.nodeName !== '#comment';
}
