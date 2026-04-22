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
import { parseAspectRatio, parseGridTracks, parseLineHeight, parsePx } from '../style.js';
import { measureText, measuredText } from './measure.js';

export interface ComputedGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayoutMap = Map<P5Element, ComputedGeometry>;

export interface TextMeasurement {
  width: number;
  height: number;
  lineCount: number;
}

export interface ComputeLayoutOptions {
  /**
   * Real text measurements captured from headless Chromium during
   * `--hydrate` (see ADR 0006). Keyed by `data-c2f-mid` attribute.
   * When present for an element, overrides the `measureText` heuristic.
   */
  textMeasurements?: ReadonlyMap<string, TextMeasurement>;
  /**
   * Width of the root layout container in px. Used to resolve %-widths
   * at the root and to enable block-centring emulation / grid-track
   * sizing when the HTML's body has no explicit CSS width (the common
   * case for hydrated real-world pages). Typically the `--viewport`
   * the conversion ran at.
   */
  viewportWidth?: number;
}

/**
 * Build a Yoga tree mirroring the parse5 element tree, run layout, and
 * return parent-relative geometry for every visited element.
 */
export function computeLayout(
  root: P5Element,
  styles: Map<P5Element, ComputedStyle>,
  opts: ComputeLayoutOptions = {},
): LayoutMap {
  const yogaByEl = new Map<P5Element, YogaNode>();
  const measurements = opts.textMeasurements;

  const buildYoga = (el: P5Element, availableContentWidth: number | undefined): YogaNode => {
    const yoga = Yoga.Node.create();
    yogaByEl.set(el, yoga);
    const style = styles.get(el) ?? new Map();
    applyYogaStyle(yoga, style);

    // `<svg width="14" height="14">` and `<img width="800" height="600">`
    // carry intrinsic dimensions on the HTML element itself, not in CSS.
    // Browsers fold these into flow sizing; yoga needs us to forward them
    // when CSS hasn't already set the width/height. Without this, SVG
    // icons land in the tree at 0×0 — no rendered geometry, no pixels.
    const tagLower = el.tagName.toLowerCase();
    if (tagLower === 'svg' || tagLower === 'img') {
      if (!style.has('width')) {
        const w = parsePx(attrValue(el, 'width'));
        if (w != null) yoga.setWidth(w);
      }
      if (!style.has('height')) {
        const h = parsePx(attrValue(el, 'height'));
        if (h != null) yoga.setHeight(h);
      }
    }

    if (isTextElement(el, style.get('display'))) {
      // TEXT nodes never have children — yoga measures them via the callback.
      yoga.setMeasureFunc(buildMeasureFn(el, style, measurements));
      return yoga;
    }

    // Block auto-centring emulation. Yoga's flex auto-margin rule collapses
    // an unsized cross-axis child with auto margins to intrinsic size, then
    // centres it. CSS block layout would stretch the child to max-width
    // first. Setting width = min(available, max-width) gives the block
    // behaviour (closes gap #8 in docs/quality-gap-report.md).
    if (availableContentWidth != null && !style.has('width')) {
      const maxWidth = parsePx(style.get('max-width'));
      if (maxWidth != null && hasAutoHorizontalMargin(style)) {
        yoga.setWidth(Math.min(availableContentWidth, maxWidth));
      }
    }

    // Compute this element's own content width so children can use it as
    // their available width. Grid track sizing (ADR 0008) needs it to
    // resolve cell widths against gap + track count in px.
    const myContentWidth = computeContentWidth(style, availableContentWidth);

    // Grid track widths in px, if this element is a grid container.
    // Weighted fr values are honoured — `1.15fr 1fr` produces unequal
    // tracks. Fixed px tracks take their declared size first; remaining
    // space splits by fr weight. Falls back to equal distribution when
    // content width isn't known.
    const trackWidths = computeGridTrackWidths(style, myContentWidth);

    let index = 0;
    for (const child of el.childNodes) {
      if (isElement(child)) {
        if (IGNORED_TAGS.has(child.tagName.toLowerCase())) continue;
        const childYoga = buildYoga(child, myContentWidth);
        if (trackWidths) {
          const w = trackWidths[index % trackWidths.length];
          if (w != null) applyGridCellSize(childYoga, styles.get(child), w);
        }
        yoga.insertChild(childYoga, index);
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

  const yogaRoot = buildYoga(root, opts.viewportWidth);
  yogaRoot.calculateLayout(opts.viewportWidth, undefined, undefined);

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

function buildMeasureFn(
  el: P5Element,
  style: ComputedStyle,
  measurements?: ReadonlyMap<string, TextMeasurement>,
) {
  const hit = measurements && lookupMeasurement(el, measurements);
  if (hit) return measuredText(hit);

  const fontSize = parsePx(style.get('font-size')) ?? 16;
  const lineHeight = parseLineHeight(style.get('line-height')) ?? { unit: 'AUTO' };
  return measureText({
    characters: collectInnerText(el),
    fontSize,
    lineHeight,
  });
}

function lookupMeasurement(
  el: P5Element,
  measurements: ReadonlyMap<string, TextMeasurement>,
): TextMeasurement | undefined {
  const mid = el.attrs.find((a) => a.name === 'data-c2f-mid')?.value;
  return mid ? measurements.get(mid) : undefined;
}

/** Same heuristic, but the parent's resolved style provides the font size /
 * line-height (since bare-text nodes inherit typography from their parent). */
function buildBareTextMeasureFn(characters: string, parentStyle: ComputedStyle) {
  const fontSize = parsePx(parentStyle.get('font-size')) ?? 16;
  const lineHeight = parseLineHeight(parentStyle.get('line-height')) ?? { unit: 'AUTO' };
  return measureText({ characters, fontSize, lineHeight });
}

// ---------------------------------------------------------------------------
// Grid helpers (ADR 0008)
// ---------------------------------------------------------------------------

/**
 * Compute each grid column's px width for the given container style.
 * Returns undefined when the element isn't a grid, the tracks don't
 * parse, or the container width is unknown (for tracks with only
 * fr weights we can't resolve them to px).
 */
function computeGridTrackWidths(
  style: ComputedStyle,
  contentWidth: number | undefined,
): number[] | undefined {
  const display = (style.get('display') ?? '').toLowerCase();
  if (display !== 'grid' && display !== 'inline-grid') return undefined;
  const tracks = parseGridTracks(style.get('grid-template-columns'));
  if (!tracks || tracks.length === 0) return undefined;
  if (contentWidth == null) {
    // Fallback: equal distribution (we don't know per-track px without
    // a container width for resolving fr weights).
    return undefined;
  }
  const colGap = readColumnGap(style);
  const totalGap = Math.max(0, (tracks.length - 1) * colGap);
  let fixedTotal = 0;
  let frTotal = 0;
  for (const t of tracks) {
    if (t.px != null) fixedTotal += t.px;
    else frTotal += t.fr ?? 1;
  }
  const frSpace = Math.max(0, contentWidth - totalGap - fixedTotal);
  const frUnit = frTotal > 0 ? frSpace / frTotal : 0;
  return tracks.map((t) => (t.px != null ? t.px : (t.fr ?? 1) * frUnit));
}

/**
 * Set a grid cell's yoga width so that N cells + (N-1) × col-gap lands
 * exactly on the container's content width. Yoga then wraps the (N+1)th
 * cell naturally because the main-axis sum would exceed the container.
 * Children with explicit CSS `width` or `flex-basis` keep their own
 * sizing — we only size the unopinionated cells.
 */
function applyGridCellSize(
  childYoga: YogaNode,
  childStyle: ComputedStyle | undefined,
  trackWidth: number,
): void {
  if (childStyle?.has('width') || childStyle?.has('flex-basis')) return;
  childYoga.setWidth(trackWidth);
}

/**
 * Compute this element's content width (inner available width for its
 * children) given its parent's available content width. CSS `width`
 * takes precedence; otherwise the element inherits the parent's content
 * width minus its own horizontal margin. Returns undefined when no
 * ancestor had a known width — in that case grid-track sizing bails
 * and cells fall back to yoga's default intrinsic sizing.
 */
function computeContentWidth(
  style: ComputedStyle,
  parentContentWidth: number | undefined,
): number | undefined {
  const cssWidth = parsePx(style.get('width'));
  const maxWidth = parsePx(style.get('max-width'));
  let myWidth = cssWidth ?? parentContentWidth;
  if (myWidth == null) return undefined;
  if (cssWidth == null) {
    const marginL = readEdgePx(style, 'margin', 'left');
    const marginR = readEdgePx(style, 'margin', 'right');
    myWidth = Math.max(0, myWidth - marginL - marginR);
  }
  // Honour max-width so children of a `.wrap { max-width: 1280 }` see the
  // clamped 1280 available, not the 1440 viewport. Otherwise grid track
  // sizing comes out too wide and cells overflow their parent.
  if (maxWidth != null && myWidth > maxWidth) myWidth = maxWidth;
  const padL = readEdgePx(style, 'padding', 'left');
  const padR = readEdgePx(style, 'padding', 'right');
  return Math.max(0, myWidth - padL - padR);
}

/**
 * Read a per-edge padding / margin value. Longhand wins when present
 * (`padding-left: 24px`); otherwise falls back to expanding the 1–4
 * value shorthand (`padding: 0 64`). Returns 0 when neither is set
 * or when the value is non-numeric (`auto`, `inherit`, etc.).
 */
function readEdgePx(
  style: ComputedStyle,
  prop: 'padding' | 'margin',
  edge: 'top' | 'right' | 'bottom' | 'left',
): number {
  const longhand = parsePx(style.get(`${prop}-${edge}`));
  if (longhand != null) return longhand;
  const shorthand = style.get(prop);
  if (!shorthand) return 0;
  const parts = shorthand.trim().split(/\s+/);
  const a = parsePx(parts[0]);
  const b = parts[1] !== undefined ? parsePx(parts[1]) : a;
  const c = parts[2] !== undefined ? parsePx(parts[2]) : a;
  const d = parts[3] !== undefined ? parsePx(parts[3]) : b;
  const top = a ?? 0;
  const right = b ?? 0;
  const bottom = c ?? 0;
  const left = d ?? 0;
  switch (edge) {
    case 'top':
      return top;
    case 'right':
      return right;
    case 'bottom':
      return bottom;
    case 'left':
      return left;
  }
}

/**
 * True when CSS declared an auto value on the child's left or right
 * margin — either as a longhand or inside a `margin:` shorthand. Used to
 * decide whether block-centring emulation should kick in.
 */
function hasAutoHorizontalMargin(style: ComputedStyle): boolean {
  if (style.get('margin-left')?.toLowerCase() === 'auto') return true;
  if (style.get('margin-right')?.toLowerCase() === 'auto') return true;
  const shorthand = style.get('margin');
  if (!shorthand) return false;
  const parts = shorthand.trim().toLowerCase().split(/\s+/);
  // `margin: auto` → auto on all 4.
  if (parts.length === 1) return parts[0] === 'auto';
  // 2 or 3 values: the second value is horizontal (right + left).
  if (parts[1] === 'auto') return true;
  // 4 values: top right bottom left. Check right and left.
  if (parts.length === 4 && parts[3] === 'auto') return true;
  return false;
}

function readColumnGap(style: ComputedStyle): number {
  const colGap = parsePx(style.get('column-gap'));
  if (colGap != null) return colGap;
  const gap = style.get('gap');
  if (!gap) return 0;
  // `gap: <row> <column>`; column defaults to row when omitted.
  const parts = gap.trim().split(/\s+/);
  const second = parts[1] !== undefined ? parsePx(parts[1]) : parsePx(parts[0]);
  return second ?? 0;
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
  const isGrid = display === 'grid' || display === 'inline-grid';

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
  const aspectRatio = parseAspectRatio(style.get('aspect-ratio'));
  if (aspectRatio != null) node.setAspectRatio(aspectRatio);
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

  // Margin (auto allowed — `margin: 0 auto` centers a max-width child) ------
  applyMarginEdge(style.get('margin-top'), node, Edge.Top);
  applyMarginEdge(style.get('margin-right'), node, Edge.Right);
  applyMarginEdge(style.get('margin-bottom'), node, Edge.Bottom);
  applyMarginEdge(style.get('margin-left'), node, Edge.Left);
  applyMarginShorthand(style.get('margin'), node);

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

  // Flex / grid container ---------------------------------------------------
  // Yoga's default flex direction is COLUMN, which gives us block-like
  // stacking by default. Flex containers honour CSS flex-direction; grid
  // containers are forced to row + wrap per ADR 0008 so tracks map onto
  // flex-wrap cells. Non-flex/non-grid falls back to COLUMN (block stack).
  if (isGrid) {
    node.setFlexDirection(FlexDirection.Row);
    node.setFlexWrap(Wrap.Wrap);

    const justify = style.get('justify-content');
    if (justify) node.setJustifyContent(toJustify(justify));

    const align = style.get('align-items');
    if (align) node.setAlignItems(toAlign(align));

    applyGapShorthand(style.get('gap'), node);
    applyEdgeLength(style.get('row-gap'), (v) => node.setGap(Gutter.Row, v));
    applyEdgeLength(style.get('column-gap'), (v) => node.setGap(Gutter.Column, v));
  } else if (isFlex) {
    const dir = (style.get('flex-direction') ?? 'row').toLowerCase();
    node.setFlexDirection(toFlexDirection(dir));

    const wrap = (style.get('flex-wrap') ?? 'nowrap').toLowerCase();
    node.setFlexWrap(toWrap(wrap));

    const justify = style.get('justify-content');
    if (justify) node.setJustifyContent(toJustify(justify));

    const align = style.get('align-items');
    if (align) node.setAlignItems(toAlign(align));

    // gap shorthand (1 or 2 values) + per-axis longhands
    applyGapShorthand(style.get('gap'), node);
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

/**
 * Margin accepts `auto` (yoga honours it for flex auto-margin semantics —
 * auto margins on cross-axis centre the child, enabling `max-width +
 * margin: 0 auto` CSS centring through the default block path).
 */
function applyMarginEdge(value: string | undefined, node: YogaNode, edge: Edge): void {
  const v = toYogaLength(value);
  if (v == null) return;
  if (v === 'auto') {
    node.setMarginAuto(edge);
    return;
  }
  node.setMargin(edge, v);
}

function applyMarginShorthand(value: string | undefined, node: YogaNode): void {
  if (!value) return;
  const parts = value.trim().split(/\s+/);
  const a = parts[0];
  const b = parts[1] ?? a;
  const c = parts[2] ?? a;
  const d = parts[3] ?? b;
  applyMarginEdge(a, node, Edge.Top);
  applyMarginEdge(b, node, Edge.Right);
  applyMarginEdge(c, node, Edge.Bottom);
  applyMarginEdge(d, node, Edge.Left);
}

/**
 * `gap` shorthand accepts 1 or 2 values: `gap: <row-gap> [<column-gap>]`.
 * Single-value shorthand goes to both axes; two-value splits row vs column.
 */
function applyGapShorthand(value: string | undefined, node: YogaNode): void {
  if (!value) return;
  const parts = value.trim().split(/\s+/);
  const row = toYogaLength(parts[0]);
  const col = parts[1] !== undefined ? toYogaLength(parts[1]) : row;
  if (row != null && row !== 'auto') node.setGap(Gutter.Row, row);
  if (col != null && col !== 'auto') node.setGap(Gutter.Column, col);
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

function attrValue(el: P5Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}
