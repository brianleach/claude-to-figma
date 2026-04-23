/**
 * HTML parse5 tree → IRDocument.
 *
 * The walker is a thin shell. Two engines do the real work:
 *   - cascade/  resolves CSS into a Map<Element, ComputedStyle>
 *   - layout/   feeds the cascade output to yoga and returns a
 *               Map<Element, Geometry> with parent-relative x/y/w/h
 *
 * Each element's IR fields come from those two maps plus a few
 * walker-local concerns: name + id assignment, font registration,
 * text/frame/image/vector classification (see classify.ts), and per-text
 * fill resolution from the cascade's color property.
 */

import {
  type FontManifestEntry,
  type FrameNode,
  type IRDocument,
  type IRNode,
  IR_VERSION,
  type ImageNode,
  type Paint,
  type Stroke,
  type TextNode,
  type TextRun,
  type TextStyle,
  type VectorNode,
} from '@claude-to-figma/ir';
import { type DefaultTreeAdapterTypes, parse, serializeOuter } from 'parse5';
import {
  type ComputedStyle,
  collectStylesheets,
  computeCascade,
  parseCssGradient,
  parseStylesheets,
} from './cascade/index.js';
import { detectComponents } from './detect/index.js';
import { extractTokens, readEffects, readStroke } from './extract/index.js';
import {
  type LayoutMap,
  type TextMeasurement,
  computeLayout,
  mapFlexChild,
  mapFlexContainer,
} from './layout/index.js';
import {
  type LengthContext,
  parseColor,
  parseFontFamily,
  parseLetterSpacing,
  parseLineHeight,
  parsePx,
  parseTextAlign,
  parseTextDecoration,
  parseTextTransform,
  parseTransformRotation,
  weightToFigmaStyle,
} from './style.js';

type P5ChildNode = DefaultTreeAdapterTypes.ChildNode;
type P5Document = DefaultTreeAdapterTypes.Document;
type P5Element = DefaultTreeAdapterTypes.Element;
type P5TextNode = DefaultTreeAdapterTypes.TextNode;

import { IGNORED_TAGS, TEXT_TAGS, collectInnerText, containsOnlyText } from './classify.js';

const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontStyle: 'Regular',
  fontSize: 16,
  lineHeight: { unit: 'AUTO' },
  letterSpacing: { unit: 'PIXELS', value: 0 },
  textAlign: 'LEFT',
  textDecoration: 'NONE',
  textCase: 'ORIGINAL',
};

const DEFAULT_TEXT_FILLS: Paint[] = [
  { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true },
];

const EMPTY_STYLE: ComputedStyle = new Map();

interface BuildContext {
  warnings: string[];
  idCounter: number;
  fontKeys: Set<string>;
  fonts: FontManifestEntry[];
  styles: Map<P5Element, ComputedStyle>;
  layout: LayoutMap;
  /** The body element — its IR frame is forced to (0,0) so the IR roots cleanly. */
  bodyEl: P5Element;
  /** Shared context for rem / vw / vh resolution inside this conversion. */
  lengthCtx: LengthContext;
  /** Snapshot lookup keyed by `data-c2f-sid`; see ConvertOptions.snapshots. */
  snapshots?: ReadonlyMap<string, import('./hydrate.js').SnapshotResult>;
}

export interface ConvertResult {
  document: IRDocument;
  warnings: string[];
  stats: {
    nodes: number;
    components: number;
    instances: number;
    paintStyles: number;
    textStyles: number;
    effectStyles: number;
  };
}

export interface ConvertOptions {
  name?: string;
  /** Directory the input HTML lives in. Used to resolve relative `<link>` hrefs. */
  baseDir?: string;
  /**
   * Minimum number of identical subtrees needed to promote them to a
   * shared component. Default 3. Set to 0 (or any value > tree size) to
   * disable component detection entirely.
   */
  componentThreshold?: number;
  /**
   * Real text measurements captured from headless Chromium during
   * `--hydrate` (see ADR 0006). Keyed by `data-c2f-mid` attribute on the
   * post-render DOM elements. When an element carries a stamp and the
   * map has a matching entry, the layout engine uses the measurement
   * instead of the `0.55 × fontSize × chars` heuristic.
   */
  textMeasurements?: ReadonlyMap<string, TextMeasurement>;
  /**
   * Snapshots captured by `--hydrate` for every element carrying
   * `data-c2f="snapshot"`. The walker replaces the whole subtree with
   * a single IMAGE IR node pointing at the snapshot's data URI, so the
   * Figma plugin pastes a pixel-perfect asset in place of reconstructing
   * decorative regions as editable Frame trees.
   */
  snapshots?: ReadonlyMap<string, import('./hydrate.js').SnapshotResult>;
  /**
   * Root container width in px. Enables block-centring emulation and
   * grid-track sizing when the HTML's body has no explicit CSS width
   * — typically the `--viewport` the conversion ran at.
   */
  viewportWidth?: number;
  /**
   * Root container height in px. Used to resolve `vh` lengths. Defaults
   * downstream in `computeLayout` to 900 when omitted.
   */
  viewportHeight?: number;
}

export function convertHtml(html: string, opts: ConvertOptions = {}): ConvertResult {
  const tree = parse(html) as P5Document;
  const body = findElement(tree.childNodes, 'body');
  if (!body) {
    throw new Error('parse5 returned a document without a <body> — this should be unreachable');
  }
  const head = findElement(tree.childNodes, 'head');

  const collected = collectStylesheets(body, { baseDir: opts.baseDir }, head);
  const rules = parseStylesheets(collected.sheets.map((s) => s.css));
  const htmlEl = findElement(tree.childNodes, 'html');
  const cascadeRoot = htmlEl ?? body;
  const cascade = computeCascade(rules, cascadeRoot);
  const layout = computeLayout(cascadeRoot, cascade.styles, {
    textMeasurements: opts.textMeasurements,
    viewportWidth: opts.viewportWidth,
    viewportHeight: opts.viewportHeight,
  });

  const rootStyle = cascade.styles.get(cascadeRoot);
  const lengthCtx: LengthContext = {
    rootFontSize: rootStyle ? (parsePx(rootStyle.get('font-size')) ?? 16) : 16,
    viewportWidth: opts.viewportWidth ?? 1440,
    viewportHeight: opts.viewportHeight ?? 900,
  };

  const ctx: BuildContext = {
    warnings: [...collected.warnings],
    idCounter: 0,
    fontKeys: new Set(),
    fonts: [],
    styles: cascade.styles,
    layout,
    bodyEl: body,
    lengthCtx,
    snapshots: opts.snapshots,
  };

  const root = buildFrameFromElement(body, ctx, 'root');
  // A designer opening the file expects the top-level frame to read like
  // the page, not the literal `<body>` tag. Use the document name if it
  // carries useful signal, else "Page".
  if (!getAttr(body, 'id') && !getAttr(body, 'class')) {
    root.name = opts.name && !/\.(html|json)$/i.test(opts.name) ? opts.name : 'Page';
  }
  registerFont(ctx, DEFAULT_TEXT_STYLE.fontFamily, DEFAULT_TEXT_STYLE.fontStyle);

  const baseDocument: IRDocument = {
    version: IR_VERSION,
    name: opts.name ?? 'Untitled',
    root,
    styles: { paints: [], texts: [], effects: [] },
    components: [],
    fonts: ctx.fonts,
    images: [],
    metadata: {
      generator: '@claude-to-figma/cli',
      source: opts.name,
    },
  };

  const detection = detectComponents(baseDocument, { threshold: opts.componentThreshold });
  const extraction = extractTokens(detection.document);

  return {
    document: extraction.document,
    warnings: ctx.warnings,
    stats: {
      nodes: ctx.idCounter,
      components: detection.stats.components,
      instances: detection.stats.instances,
      paintStyles: extraction.stats.paints,
      textStyles: extraction.stats.texts,
      effectStyles: extraction.stats.effects,
    },
  };
}

// ---------------------------------------------------------------------------
// Element walker
// ---------------------------------------------------------------------------

function buildNodeFromElement(el: P5Element, ctx: BuildContext): IRNode | null {
  const tag = el.tagName.toLowerCase();
  if (IGNORED_TAGS.has(tag)) return null;

  // Author-marked snapshot regions win before any other classification:
  // the whole subtree is replaced with a single IMAGE IR node pointing
  // at the Chromium-captured PNG. Designers edit / replace the image
  // just like they would any other asset in a Figma file, instead of
  // trying to tweak nested Frame trees we reconstructed from CSS.
  const snapshotNode = maybeBuildSnapshot(el, ctx);
  if (snapshotNode) return snapshotNode;

  if (tag === 'img') return buildImage(el, ctx);
  if (tag === 'svg') return buildVector(el, ctx);
  if (tag === 'br') return null;

  // Honor CSS `display` when deciding whether a text-tag is a TEXT node
  // or a FRAME. `<a class="btn">` with `display: inline-flex` needs to
  // be a FRAME so its padding / border / background render. Same story
  // for a plain `<span class="figma-tag">` pill — even without an explicit
  // `display` keyword, any box-level styling (background, border-radius,
  // padding, border) means the author wanted a rendered box, not inline
  // text. TEXT nodes can't carry those so we promote to a FRAME.
  const cssStyle = styleOf(ctx, el);
  const display = cssStyle.get('display');
  if (
    TEXT_TAGS.has(tag) &&
    containsOnlyText(el) &&
    !isContainerDisplay(display) &&
    !hasBoxStyling(cssStyle)
  ) {
    const textNode = buildText(el, ctx);
    if (textNode) return textNode;
    // Empty text-tag (e.g. `<span></span>` used as a decoration — the
    // titlebar dots or an `.eyebrow .dot`). buildText returns null when
    // there's no text content; fall through to the frame path so the
    // element's width / height / background / border-radius still render.
  }

  return buildFrameFromElement(el, ctx);
}

/**
 * A text-tag element carries box styling when it has a background, a
 * border, a border-radius, or non-zero padding. In CSS that draws a
 * pill / chip / card around the inline text — which our IR can only
 * represent as a FRAME with a child TEXT. Inline defaults (no bg,
 * no border, no radius, no padding) keep the TEXT-leaf shortcut.
 */
function hasBoxStyling(style: ComputedStyle): boolean {
  if (style.has('background') || style.has('background-color')) return true;
  if (style.has('border-radius')) return true;
  if (
    style.has('border') ||
    style.has('border-top') ||
    style.has('border-right') ||
    style.has('border-bottom') ||
    style.has('border-left') ||
    style.has('border-width') ||
    style.has('border-top-width') ||
    style.has('border-right-width') ||
    style.has('border-bottom-width') ||
    style.has('border-left-width')
  ) {
    return true;
  }
  for (const prop of ['padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left']) {
    const raw = style.get(prop);
    if (raw && raw.trim() !== '0' && raw.trim() !== '0px') return true;
  }
  return false;
}

function isContainerDisplay(display: string | undefined): boolean {
  if (!display) return false;
  const d = display.toLowerCase();
  return d === 'flex' || d === 'inline-flex' || d === 'grid' || d === 'inline-grid';
}

function buildFrameFromElement(el: P5Element, ctx: BuildContext, idHint?: string): FrameNode {
  const style = styleOf(ctx, el);
  const geometry = geometryOf(ctx, el);
  const fills = readBackgroundFills(style);
  // `border-radius: 50%` on a square element is the idiomatic CSS for a
  // circle — resolve it as half the element's smaller dimension. Figma's
  // `cornerRadius` caps at `min(w,h)/2` anyway, so this is the same value
  // the browser renders.
  const cornerRadius = readCornerRadius(style.get('border-radius'), geometry, ctx.lengthCtx);
  const layout = mapFlexContainer(style, ctx.lengthCtx);

  const children: IRNode[] = [];
  for (const child of el.childNodes) {
    const built = buildChild(child, el, ctx);
    if (!built) continue;
    decorateChildLayout(built, el, child, ctx);
    children.push(built);
  }

  const stroke = readStroke(style, ctx.lengthCtx);
  const effects = readEffects(style);

  const frame: FrameNode = {
    type: 'FRAME',
    id: idHint ?? nextId(ctx, el.tagName),
    name: nameFor(el),
    geometry,
    opacity: parseOpacity(style),
    visible: true,
    fills,
    strokes: stroke ? [stroke] : [],
    effects,
    children,
  };
  if (layout) frame.layout = layout;
  if (cornerRadius != null) frame.cornerRadius = cornerRadius;
  // CSS `overflow: hidden | clip | scroll | auto` all clip their children
  // visually — all three map to `clipsContent: true` in Figma. `visible`
  // (the default) and `unset` leave clipping off.
  const overflow = (style.get('overflow') ?? '').trim().toLowerCase();
  if (overflow === 'hidden' || overflow === 'clip' || overflow === 'scroll' || overflow === 'auto') {
    frame.clipsContent = true;
  }
  const rotation = parseTransformRotation(style.get('transform'));
  if (rotation != null) frame.rotation = rotation;
  return frame;
}

/**
 * Decorate the just-built IR node with `childLayout` if its parent element
 * is a flex container. The decoration is structural metadata for the Figma
 * plugin (layoutPositioning, layoutGrow, layoutAlign) — geometry already
 * came from yoga.
 */
function decorateChildLayout(
  built: IRNode,
  parentEl: P5Element,
  childNode: P5ChildNode,
  ctx: BuildContext,
): void {
  if (!isElement(childNode)) return;
  const parentStyle = styleOf(ctx, parentEl);
  const childStyle = styleOf(ctx, childNode);
  const childLayout = mapFlexChild(parentStyle, childStyle);
  if (childLayout) built.childLayout = childLayout;
}

function buildText(el: P5Element, ctx: BuildContext): TextNode | null {
  const style = styleOf(ctx, el);
  const rootTextStyle = resolveTextStyle(style, ctx.lengthCtx);
  registerFont(ctx, rootTextStyle.fontFamily, rootTextStyle.fontStyle);

  const rootFills = resolveTextFills(style);

  const { characters, runs } = collectStyledRuns(el, ctx, rootTextStyle, rootFills);
  if (!characters) return null;

  const node: TextNode = {
    type: 'TEXT',
    id: nextId(ctx, 'text'),
    name: nameFor(el, characters.slice(0, 32)),
    geometry: geometryOf(ctx, el),
    opacity: parseOpacity(style),
    visible: true,
    characters,
    textStyle: rootTextStyle,
    fills: rootFills,
  };
  if (runs.length > 1 && runsAreNonUniform(runs)) {
    node.runs = runs;
    // Also register every run's font so the plugin can pre-load them.
    for (const run of runs) registerFont(ctx, run.textStyle.fontFamily, run.textStyle.fontStyle);
  }
  return node;
}

/** Resolve the `fills` array for a text element from its `color` property. */
function resolveTextFills(style: ComputedStyle): Paint[] {
  const fillColor = parseColor(style.get('color'));
  return fillColor
    ? [{ type: 'SOLID', color: fillColor, opacity: 1, visible: true }]
    : DEFAULT_TEXT_FILLS;
}

/**
 * Walk the text element's children, producing segments with their
 * resolved style / fills, then collapse whitespace across boundaries so
 * the result matches `collectInnerText`'s single-string output while
 * preserving per-range style info.
 */
function collectStyledRuns(
  el: P5Element,
  ctx: BuildContext,
  rootStyle: TextStyle,
  rootFills: Paint[],
): { characters: string; runs: TextRun[] } {
  interface RawSegment {
    text: string;
    textStyle: TextStyle;
    fills: Paint[];
  }

  const segments: RawSegment[] = [];

  const walk = (node: P5Element, inheritedStyle: TextStyle, inheritedFills: Paint[]): void => {
    for (const child of node.childNodes) {
      if (isTextNode(child)) {
        segments.push({ text: child.value, textStyle: inheritedStyle, fills: inheritedFills });
        continue;
      }
      if (!('tagName' in child)) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') {
        segments.push({ text: '\n', textStyle: inheritedStyle, fills: inheritedFills });
        continue;
      }
      if (!TEXT_TAGS.has(tag)) continue;
      const childCss = styleOf(ctx, child);
      const childStyle = resolveTextStyle(childCss, ctx.lengthCtx);
      const childFills = resolveTextFills(childCss);
      walk(child, childStyle, childFills);
    }
  };

  walk(el, rootStyle, rootFills);

  // Collapse whitespace across segment boundaries: within a segment run
  // /\s+/ into a single space; at boundaries, drop a leading space when
  // the accumulated string already ends with one.
  let characters = '';
  const runs: TextRun[] = [];
  for (const seg of segments) {
    let text = seg.text.replace(/\s+/g, ' ');
    if (characters.endsWith(' ') || characters.length === 0) {
      text = text.replace(/^ /, '');
    }
    if (!text) continue;
    const start = characters.length;
    characters += text;
    runs.push({ start, end: characters.length, textStyle: seg.textStyle, fills: seg.fills });
  }

  // Trim trailing space, shrinking the final run if it ends there.
  while (characters.endsWith(' ')) {
    characters = characters.slice(0, -1);
    const last = runs[runs.length - 1];
    if (last) {
      last.end = characters.length;
      if (last.end <= last.start) runs.pop();
    }
  }

  return { characters, runs };
}

/** True when at least one run's style or fills differ from run[0]. */
function runsAreNonUniform(runs: TextRun[]): boolean {
  const first = runs[0];
  if (!first) return false;
  const firstStyleKey = JSON.stringify(first.textStyle);
  const firstFillsKey = JSON.stringify(first.fills);
  for (let i = 1; i < runs.length; i += 1) {
    const r = runs[i];
    if (!r) continue;
    if (JSON.stringify(r.textStyle) !== firstStyleKey) return true;
    if (JSON.stringify(r.fills) !== firstFillsKey) return true;
  }
  return false;
}

/**
 * If this element was flagged with `data-c2f="snapshot"` AND Playwright
 * captured a PNG for it during `--hydrate`, emit a single IMAGE IR node
 * with the data URI as its `imageRef`. Returns null otherwise (falls
 * through to the regular walker path).
 *
 * The element MUST have a `data-c2f-sid="sN"` stamp from hydrate.ts —
 * without a sid we have no snapshot to reference, and without hydrate
 * running there are no snapshots at all. In that case we log a warning
 * so the author knows why their marked subtree still rendered as a
 * Frame tree.
 */
function maybeBuildSnapshot(el: P5Element, ctx: BuildContext): ImageNode | null {
  const marker = getAttr(el, 'data-c2f');
  if (marker !== 'snapshot') return null;
  const sid = getAttr(el, 'data-c2f-sid');
  if (!sid || !ctx.snapshots) {
    ctx.warnings.push(
      `Element marked data-c2f="snapshot" but no capture available (pass --hydrate to enable).`,
    );
    return null;
  }
  const snapshot = ctx.snapshots.get(sid);
  if (!snapshot) return null;

  const style = styleOf(ctx, el);
  return {
    type: 'IMAGE',
    id: nextId(ctx, 'snapshot'),
    name: nameFor(el),
    geometry: geometryOf(ctx, el),
    opacity: parseOpacity(style),
    visible: true,
    imageRef: snapshot.dataUri,
    scaleMode: 'FILL',
    fills: [],
  };
}

function buildImage(el: P5Element, ctx: BuildContext): ImageNode {
  const style = styleOf(ctx, el);
  const geometry = geometryOf(ctx, el);
  const ref = getAttr(el, 'src') ?? '';
  if (!ref) ctx.warnings.push('<img> missing src — emitted with empty imageRef');

  return {
    type: 'IMAGE',
    id: nextId(ctx, 'image'),
    name: nameFor(el, getAttr(el, 'alt')),
    geometry,
    opacity: parseOpacity(style),
    visible: true,
    imageRef: ref,
    scaleMode: 'FILL',
    fills: [],
  };
}

/**
 * SVG rendering strategy. Single-shape SVGs emit one VECTOR (unchanged
 * from M8). Multi-shape SVGs emit a FRAME with one VECTOR per shape —
 * each VECTOR carries the shape's own `fill` / `stroke` / `stroke-width`
 * (inherited from the `<svg>` element when absent on the shape). Without
 * this, every child SVG shape rendered as an invisible blob because we
 * emitted a single VECTOR with empty fills and strokes.
 */
function buildVector(el: P5Element, ctx: BuildContext): IRNode {
  const style = styleOf(ctx, el);
  const geometry = geometryOf(ctx, el);
  const shapes = collectShapes(el);

  if (shapes.length === 0) {
    ctx.warnings.push('<svg> had no <path d="..."> — emitted with empty path');
    return {
      type: 'VECTOR',
      id: nextId(ctx, 'vector'),
      name: nameFor(el),
      geometry,
      opacity: parseOpacity(style),
      visible: true,
      path: '',
      fills: [],
      strokes: [],
    };
  }

  // Inherit paint attributes from the <svg> element so `fill="none"
  // stroke="#1C1A16"` at the root applies to children that don't override.
  const svgFill = getAttr(el, 'fill');
  const svgStroke = getAttr(el, 'stroke');
  const svgStrokeWidth = Number(getAttr(el, 'stroke-width'));
  const inherited = {
    fill: svgFill,
    stroke: svgStroke,
    strokeWidth: Number.isFinite(svgStrokeWidth) ? svgStrokeWidth : undefined,
  };
  const opacity = parseOpacity(style);

  // `fill="currentColor"` / `stroke="currentColor"` resolves to the
  // inherited CSS `color` property on the <svg> element — that's how
  // most icon sets colour themselves without hardcoding the palette.
  const currentColor = style.get('color');
  const resolveCurrent = (paint: string | undefined): string | undefined => {
    if (!paint) return paint;
    return paint.toLowerCase() === 'currentcolor' ? currentColor : paint;
  };

  const buildShape = (
    shape: SvgShape,
    idx: number,
    childGeometry: VectorNode['geometry'],
  ): VectorNode => {
    const effectiveFill = resolveCurrent(shape.fill ?? inherited.fill);
    const effectiveStroke = resolveCurrent(shape.stroke ?? inherited.stroke);
    const effectiveStrokeW = shape.strokeWidth ?? inherited.strokeWidth ?? 1;

    const fills: Paint[] = [];
    if (effectiveFill && effectiveFill !== 'none') {
      const c = parseColor(effectiveFill);
      if (c) fills.push({ type: 'SOLID', color: c, opacity: 1, visible: true });
    }
    const strokes: Stroke[] = [];
    if (effectiveStroke && effectiveStroke !== 'none') {
      const c = parseColor(effectiveStroke);
      if (c) {
        strokes.push({
          paint: { type: 'SOLID', color: c, opacity: 1, visible: true },
          weight: effectiveStrokeW,
          // SVG strokes are centered by default; matches Figma's CENTER alignment.
          align: 'CENTER',
        });
      }
    }

    return {
      type: 'VECTOR',
      id: nextId(ctx, 'path'),
      name: `Path ${idx + 1}`,
      geometry: childGeometry,
      opacity,
      visible: true,
      path: normalizeSvgPath(shape.path),
      fills,
      strokes,
    };
  };

  // Capture the raw `<svg>...</svg>` markup so the Figma plugin can import
  // it via `createNodeFromSvg(...)` and get viewBox / stroke-linecap /
  // per-shape attributes handled natively, instead of our (lossy) path
  // rewrite. `currentColor` is resolved here (not at Figma-import time)
  // because `createNodeFromSvg` has no CSS context to inherit from.
  const svgSource = safeSerializeSvg(el, currentColor);

  if (shapes.length === 1) {
    const only = shapes[0];
    if (!only) {
      throw new Error('unreachable: shapes.length === 1 but shapes[0] is undefined');
    }
    const v = buildShape(only, 0, geometry);
    // Preserve the old name when there's only one shape — the outer <svg>'s
    // id / class is what users will recognise in the layer panel.
    v.name = nameFor(el);
    if (svgSource) v.svgSource = svgSource;
    return v;
  }

  const children: IRNode[] = shapes.map((shape, i) =>
    buildShape(shape, i, { x: 0, y: 0, width: geometry.width, height: geometry.height }),
  );
  const wrapper: FrameNode = {
    type: 'FRAME',
    id: nextId(ctx, 'svg'),
    name: nameFor(el),
    geometry,
    opacity,
    visible: true,
    fills: [],
    strokes: [],
    effects: [],
    children,
  };
  if (svgSource) wrapper.svgSource = svgSource;
  return wrapper;
}

/**
 * Serialize an `<svg>` element back to its outer markup for the plugin
 * to import via `figma.createNodeFromSvg(...)`. Returns `undefined` if
 * parse5's serializer throws — the path-based IR fallback stays intact.
 *
 * `currentColor` references in the markup are rewritten to the resolved
 * CSS `color` at this element. Figma's SVG parser has no CSS context to
 * do that inheritance itself, so `currentColor` icons would otherwise
 * render as black / transparent instead of the intended palette colour.
 */
function safeSerializeSvg(el: P5Element, resolvedColor: string | undefined): string | undefined {
  try {
    let out = serializeOuter(el);
    if (resolvedColor) {
      out = out.replace(/currentColor/gi, resolvedColor);
    }
    return out;
  } catch {
    return undefined;
  }
}

/**
 * Normalize an SVG `d` attribute into Figma-parseable path data.
 *
 * Two transforms:
 *   1. Whitespace-separate every command letter so compact forms like
 *      `M0,65L100,50` don't get parsed as a single literal command.
 *   2. Expand H / V (absolute horizontal / vertical line) into L. Figma's
 *      vector parser rejects H / V with "Invalid command at H". We track
 *      the current point while walking the command list so H becomes
 *      `L x currentY` and V becomes `L currentX y`.
 */
function normalizeSvgPath(d: string): string {
  if (!d) return '';
  const tokens = tokenizeSvgPath(d);
  return expandCommands(tokens);
}

/**
 * Tokenize an SVG path `d` attribute into command letters and numeric args.
 * Handles the tricky cases the previous regex-split didn't:
 *   - Concatenated numbers with sign transitions (`0-2.53` → `0`, `-2.53`).
 *   - Chained decimals (`.4.07.55` → `.4`, `.07`, `.55`).
 *   - Exponents (`1e-3`, `1.5e+2`).
 */
function tokenizeSvgPath(d: string): string[] {
  const tokens: string[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null = re.exec(d);
  while (m !== null) {
    tokens.push((m[1] ?? m[2]) as string);
    m = re.exec(d);
  }
  return tokens;
}

function expandCommands(tokens: string[]): string {
  const out: string[] = [];
  let cmd: string | null = null;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (!tok) {
      i += 1;
      continue;
    }
    if (/^[A-Za-z]$/.test(tok)) {
      cmd = tok;
      // Z / z has no args — close path, reset current point to subpath start.
      if (cmd === 'Z' || cmd === 'z') {
        out.push(tok);
        cx = startX;
        cy = startY;
        cmd = null;
        i += 1;
        continue;
      }
      // Defer emitting the command letter — H/V and A rewrite it.
      i += 1;
      continue;
    }
    // Numeric token — consume as argument group based on current command.
    if (cmd == null) {
      out.push(tok);
      i += 1;
      continue;
    }
    const groupSize = argCount(cmd);
    if (groupSize === 0) {
      out.push(tok);
      i += 1;
      continue;
    }
    const args = tokens.slice(i, i + groupSize).filter(Boolean);
    if (args.length < groupSize) break;
    i += groupSize;

    const rel: boolean = cmd === cmd.toLowerCase();
    switch (cmd) {
      case 'H':
      case 'h': {
        const x = Number(args[0]);
        const nx = rel ? cx + x : x;
        out.push(rel ? 'l' : 'L', String(nx - (rel ? cx : 0)), rel ? '0' : String(cy));
        cx = nx;
        break;
      }
      case 'V':
      case 'v': {
        const y = Number(args[0]);
        const ny = rel ? cy + y : y;
        out.push(rel ? 'l' : 'L', rel ? '0' : String(cx), String(ny - (rel ? cy : 0)));
        cy = ny;
        break;
      }
      case 'A':
      case 'a': {
        const rx = Number(args[0]);
        const ry = Number(args[1]);
        const phi = Number(args[2]);
        const largeArc = Number(args[3]) ? 1 : 0;
        const sweep = Number(args[4]) ? 1 : 0;
        const ex = Number(args[5]);
        const ey = Number(args[6]);
        const nx = rel ? cx + ex : ex;
        const ny = rel ? cy + ey : ey;
        // Figma's vector parser rejects `A` — lower each arc to one or more
        // absolute cubic Béziers.
        const cubics = arcToCubics(cx, cy, rx, ry, phi, largeArc, sweep, nx, ny);
        for (const c of cubics) {
          out.push(
            'C',
            String(c.c1x),
            String(c.c1y),
            String(c.c2x),
            String(c.c2y),
            String(c.x),
            String(c.y),
          );
        }
        cx = nx;
        cy = ny;
        break;
      }
      default: {
        out.push(cmd, ...args);
        if (args.length >= 2) {
          const xi = Number(args[args.length - 2]);
          const yi = Number(args[args.length - 1]);
          const nx = rel ? cx + xi : xi;
          const ny = rel ? cy + yi : yi;
          cx = nx;
          cy = ny;
          if (cmd === 'M' || cmd === 'm') {
            startX = nx;
            startY = ny;
            // Subsequent implicit commands after M are treated as L.
            cmd = rel ? 'l' : 'L';
          }
        }
        break;
      }
    }
  }
  return out.join(' ');
}

/**
 * SVG arc → cubic Bézier approximation.
 *
 * Implements the endpoint-to-center parameterization from
 * https://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes, then splits
 * the arc into ≤ π/2 sweep segments and approximates each with a standard
 * four-control-point cubic. The returned cubics are in absolute coordinates.
 */
function arcToCubics(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
): Array<{ c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }> {
  if (x1 === x2 && y1 === y2) return [];
  // Zero-radius arc degenerates to a line.
  if (rxIn === 0 || ryIn === 0) {
    return [{ c1x: x1, c1y: y1, c2x: x2, c2y: y2, x: x2, y: y2 }];
  }
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const denom = rx2 * y1p2 + ry2 * x1p2;
  let factor = denom === 0 ? 0 : (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / denom;
  if (factor < 0) factor = 0;
  factor = Math.sqrt(factor) * (largeArc === sweep ? -1 : 1);
  const cxp = factor * ((rx * y1p) / ry);
  const cyp = factor * -((ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const vAngle = (ux: number, uy: number, vx: number, vy: number): number => {
    const n = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let cosA = (ux * vx + uy * vy) / n;
    if (cosA < -1) cosA = -1;
    if (cosA > 1) cosA = 1;
    const sign = ux * vy - uy * vx < 0 ? -1 : 1;
    return sign * Math.acos(cosA);
  };

  const theta1 = vAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let deltaTheta = vAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (sweep === 0 && deltaTheta > 0) deltaTheta -= 2 * Math.PI;
  if (sweep === 1 && deltaTheta < 0) deltaTheta += 2 * Math.PI;

  const segments = Math.max(1, Math.ceil(Math.abs(deltaTheta) / (Math.PI / 2)));
  const delta = deltaTheta / segments;
  const t = (4 / 3) * Math.tan(delta / 4);

  const result: Array<{
    c1x: number;
    c1y: number;
    c2x: number;
    c2y: number;
    x: number;
    y: number;
  }> = [];
  let theta = theta1;
  for (let i = 0; i < segments; i += 1) {
    const nextTheta = theta + delta;
    const cos1 = Math.cos(theta);
    const sin1 = Math.sin(theta);
    const cos2 = Math.cos(nextTheta);
    const sin2 = Math.sin(nextTheta);

    const p1x = cos1;
    const p1y = sin1;
    const p2x = cos1 - t * sin1;
    const p2y = sin1 + t * cos1;
    const p3x = cos2 + t * sin2;
    const p3y = sin2 - t * cos2;
    const p4x = cos2;
    const p4y = sin2;

    const toWorld = (ux: number, uy: number): [number, number] => {
      const sx = ux * rx;
      const sy = uy * ry;
      return [cosPhi * sx - sinPhi * sy + cx, sinPhi * sx + cosPhi * sy + cy];
    };
    // Skip p1 — it's the previous segment's endpoint (already emitted).
    void p1x;
    void p1y;
    const [c1x, c1y] = toWorld(p2x, p2y);
    const [c2x, c2y] = toWorld(p3x, p3y);
    const [endX, endY] = toWorld(p4x, p4y);

    result.push({ c1x, c1y, c2x, c2y, x: endX, y: endY });
    theta = nextTheta;
  }

  return result;
}

function argCount(cmd: string): number {
  switch (cmd.toLowerCase()) {
    case 'z':
      return 0;
    case 'h':
    case 'v':
      return 1;
    case 'm':
    case 'l':
    case 't':
      return 2;
    case 's':
    case 'q':
      return 4;
    case 'c':
      return 6;
    case 'a':
      return 7;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Children helpers
// ---------------------------------------------------------------------------

function buildChild(child: P5ChildNode, parent: P5Element, ctx: BuildContext): IRNode | null {
  if (isElement(child)) return buildNodeFromElement(child, ctx);
  if (isTextNode(child)) {
    const trimmed = child.value.trim();
    if (!trimmed) return null;
    // Bare text directly inside a frame: wrap in an anonymous TEXT node.
    // Inherits typography + color from the parent frame's computed style.
    const parentStyle = styleOf(ctx, parent);
    const textStyle = resolveTextStyle(parentStyle, ctx.lengthCtx);
    registerFont(ctx, textStyle.fontFamily, textStyle.fontStyle);
    const fillColor = parseColor(parentStyle.get('color'));
    return {
      type: 'TEXT',
      id: nextId(ctx, 'text'),
      name: trimmed.slice(0, 32) || 'Text',
      opacity: 1,
      visible: true,
      characters: trimmed,
      textStyle,
      fills: fillColor
        ? [{ type: 'SOLID', color: fillColor, opacity: 1, visible: true }]
        : DEFAULT_TEXT_FILLS,
    };
  }
  return null;
}

interface SvgShape {
  path: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

/**
 * Walk the SVG tree and collect every renderable shape, preserving the
 * per-shape paint attributes so the builder can emit one VECTOR per
 * shape with its own fills + strokes. Replaces the M8 `collectAllPaths`
 * which concatenated every shape's `d` into a single path string,
 * throwing away per-shape paint.
 */
function collectShapes(el: P5Element): SvgShape[] {
  const out: SvgShape[] = [];
  const walk = (node: P5Element) => {
    for (const c of node.childNodes) {
      if (!isElement(c)) continue;
      const tag = c.tagName.toLowerCase();
      const strokeWidth = Number(getAttr(c, 'stroke-width'));
      const common = {
        fill: getAttr(c, 'fill'),
        stroke: getAttr(c, 'stroke'),
        strokeWidth: Number.isFinite(strokeWidth) ? strokeWidth : undefined,
      };
      if (tag === 'path') {
        const d = getAttr(c, 'd');
        if (d) out.push({ path: d, ...common });
      } else {
        const synthesised = shapeToPath(c, tag);
        if (synthesised) out.push({ path: synthesised, ...common });
      }
      walk(c);
    }
  };
  walk(el);
  return out;
}

/**
 * Convert basic SVG shape primitives to path `d` data so they survive the
 * pipeline as a single VECTOR. Ellipse and circle use two half-arcs per
 * SVG spec. Unknown elements return undefined.
 */
function shapeToPath(el: P5Element, tag: string): string | undefined {
  if (tag === 'rect') {
    const x = num(getAttr(el, 'x')) ?? 0;
    const y = num(getAttr(el, 'y')) ?? 0;
    const w = num(getAttr(el, 'width'));
    const h = num(getAttr(el, 'height'));
    if (w == null || h == null || w <= 0 || h <= 0) return undefined;
    const rx = num(getAttr(el, 'rx'));
    const ry = num(getAttr(el, 'ry')) ?? rx;
    if (rx != null && ry != null && rx > 0 && ry > 0) {
      const rxc = Math.min(rx, w / 2);
      const ryc = Math.min(ry, h / 2);
      return roundedRectPath(x, y, w, h, rxc, ryc);
    }
    return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
  }
  if (tag === 'circle') {
    const cx = num(getAttr(el, 'cx')) ?? 0;
    const cy = num(getAttr(el, 'cy')) ?? 0;
    const r = num(getAttr(el, 'r'));
    if (r == null || r <= 0) return undefined;
    return ellipsePath(cx, cy, r, r);
  }
  if (tag === 'ellipse') {
    const cx = num(getAttr(el, 'cx')) ?? 0;
    const cy = num(getAttr(el, 'cy')) ?? 0;
    const rx = num(getAttr(el, 'rx'));
    const ry = num(getAttr(el, 'ry'));
    if (rx == null || ry == null || rx <= 0 || ry <= 0) return undefined;
    return ellipsePath(cx, cy, rx, ry);
  }
  if (tag === 'line') {
    const x1 = num(getAttr(el, 'x1')) ?? 0;
    const y1 = num(getAttr(el, 'y1')) ?? 0;
    const x2 = num(getAttr(el, 'x2')) ?? 0;
    const y2 = num(getAttr(el, 'y2')) ?? 0;
    return `M${x1} ${y1} L${x2} ${y2}`;
  }
  if (tag === 'polygon' || tag === 'polyline') {
    const pts = pointsToPairs(getAttr(el, 'points'));
    if (pts.length < 2) return undefined;
    const [first, ...rest] = pts;
    if (!first) return undefined;
    let d = `M${first[0]} ${first[1]}`;
    for (const [px, py] of rest) d += ` L${px} ${py}`;
    if (tag === 'polygon') d += ' Z';
    return d;
  }
  return undefined;
}

function num(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Magic cubic-bezier constant for approximating a quarter-ellipse. The
 * standard approximation places control points at k × radius along each
 * tangent from the endpoint. Figma's vector parser rejects SVG's `A`
 * (arc) command, so shape synthesis lowers circles / ellipses /
 * rounded-rect corners to four cubic Béziers.
 */
const ARC_BEZIER_K = 0.5522847498307936;

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  const kx = rx * ARC_BEZIER_K;
  const ky = ry * ARC_BEZIER_K;
  return [
    `M ${cx + rx} ${cy}`,
    `C ${cx + rx} ${cy - ky} ${cx + kx} ${cy - ry} ${cx} ${cy - ry}`,
    `C ${cx - kx} ${cy - ry} ${cx - rx} ${cy - ky} ${cx - rx} ${cy}`,
    `C ${cx - rx} ${cy + ky} ${cx - kx} ${cy + ry} ${cx} ${cy + ry}`,
    `C ${cx + kx} ${cy + ry} ${cx + rx} ${cy + ky} ${cx + rx} ${cy}`,
    'Z',
  ].join(' ');
}

function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  rxc: number,
  ryc: number,
): string {
  const k = ARC_BEZIER_K;
  const kx = rxc * k;
  const ky = ryc * k;
  // Clockwise, starting at the top-left tangent of the top-left corner
  // arc. Each corner is one cubic Bézier; each edge is an L.
  return [
    `M ${x + rxc} ${y}`,
    `L ${x + w - rxc} ${y}`,
    // TR corner
    `C ${x + w - rxc + kx} ${y} ${x + w} ${y + ryc - ky} ${x + w} ${y + ryc}`,
    `L ${x + w} ${y + h - ryc}`,
    // BR corner
    `C ${x + w} ${y + h - ryc + ky} ${x + w - rxc + kx} ${y + h} ${x + w - rxc} ${y + h}`,
    `L ${x + rxc} ${y + h}`,
    // BL corner
    `C ${x + rxc - kx} ${y + h} ${x} ${y + h - ryc + ky} ${x} ${y + h - ryc}`,
    `L ${x} ${y + ryc}`,
    // TL corner
    `C ${x} ${y + ryc - ky} ${x + rxc - kx} ${y} ${x + rxc} ${y}`,
    'Z',
  ].join(' ');
}

function pointsToPairs(raw: string | undefined): Array<[number, number]> {
  if (!raw) return [];
  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const x = Number(tokens[i]);
    const y = Number(tokens[i + 1]);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Style application — operates on a ComputedStyle (Map<string, string>)
// ---------------------------------------------------------------------------

function geometryOf(
  ctx: BuildContext,
  el: P5Element,
): { x: number; y: number; width: number; height: number } {
  const layout = ctx.layout.get(el);
  if (!layout) return { x: 0, y: 0, width: 0, height: 0 };
  // Body anchors the IR — drop its parent-relative position (which is html-relative)
  // so the root frame sits at (0, 0).
  const isBody = el === ctx.bodyEl;
  return {
    x: isBody ? 0 : layout.x,
    y: isBody ? 0 : layout.y,
    width: layout.width,
    height: layout.height,
  };
}

/**
 * Parse `border-radius` in either px or % form.
 *
 *   `border-radius: 8px`  → 8
 *   `border-radius: 50%`  → min(w, h) / 2 (Figma caps there anyway)
 *
 * Ignores the shorthand's more exotic forms (per-corner longhands,
 * `<h-radius> / <v-radius>` elliptical syntax) — they hit the single-value
 * fast path by using `border-radius` itself.
 */
function readCornerRadius(
  value: string | undefined,
  geometry: { width: number; height: number },
  ctx: LengthContext,
): number | undefined {
  if (!value) return undefined;
  const px = parsePx(value, ctx);
  if (px != null) return px;
  const pct = /^(-?\d+(?:\.\d+)?)%$/i.exec(value.trim());
  if (pct && pct[1] != null) {
    const smaller = Math.min(geometry.width, geometry.height);
    return (Number(pct[1]) / 100) * smaller;
  }
  return undefined;
}

function readBackgroundFills(style: ComputedStyle): Paint[] {
  // `background-color` is always a solid fill. `background` (shorthand)
  // can carry gradients or images; try gradient first, then solid colour.
  const bgColorOnly = style.get('background-color');
  const bg = style.get('background');

  const gradient = parseCssGradient(bg);
  if (gradient) return [gradient];

  const color = parseColor(bgColorOnly ?? bg);
  if (!color) return [];
  return [{ type: 'SOLID', color, opacity: 1, visible: true }];
}

function parseOpacity(style: ComputedStyle): number {
  const raw = style.get('opacity');
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function resolveTextStyle(style: ComputedStyle, ctx: LengthContext = {}): TextStyle {
  const family = parseFontFamily(style.get('font-family')) ?? DEFAULT_TEXT_STYLE.fontFamily;
  const italic = (style.get('font-style')?.toLowerCase() ?? '').includes('italic');
  const figmaStyle = style.get('font-weight')
    ? weightToFigmaStyle(style.get('font-weight'), italic)
    : italic
      ? weightToFigmaStyle('400', true)
      : DEFAULT_TEXT_STYLE.fontStyle;
  const size = parsePx(style.get('font-size'), ctx) ?? DEFAULT_TEXT_STYLE.fontSize;
  const lineHeight = parseLineHeight(style.get('line-height')) ?? DEFAULT_TEXT_STYLE.lineHeight;
  const letterSpacing =
    parseLetterSpacing(style.get('letter-spacing')) ?? DEFAULT_TEXT_STYLE.letterSpacing;
  const textAlign = parseTextAlign(style.get('text-align')) ?? DEFAULT_TEXT_STYLE.textAlign;
  const textDecoration =
    parseTextDecoration(style.get('text-decoration')) ?? DEFAULT_TEXT_STYLE.textDecoration;
  const textCase = parseTextTransform(style.get('text-transform')) ?? DEFAULT_TEXT_STYLE.textCase;

  return {
    fontFamily: family,
    fontStyle: figmaStyle,
    fontSize: size,
    lineHeight,
    letterSpacing,
    textAlign,
    textDecoration,
    textCase,
  };
}

function styleOf(ctx: BuildContext, el: P5Element): ComputedStyle {
  return ctx.styles.get(el) ?? EMPTY_STYLE;
}

function registerFont(ctx: BuildContext, family: string, fontStyle: string): void {
  const key = `${family}::${fontStyle}`;
  if (ctx.fontKeys.has(key)) return;
  ctx.fontKeys.add(key);
  ctx.fonts.push({ family, style: fontStyle });
}

// ---------------------------------------------------------------------------
// Tree adapter helpers
// ---------------------------------------------------------------------------

function isElement(node: P5ChildNode): node is P5Element {
  return 'tagName' in node && node.nodeName !== '#text' && node.nodeName !== '#comment';
}

function isTextNode(node: P5ChildNode): node is P5TextNode {
  return node.nodeName === '#text';
}

function findElement(nodes: ReadonlyArray<P5ChildNode>, tag: string): P5Element | undefined {
  for (const n of nodes) {
    if (isElement(n)) {
      if (n.tagName.toLowerCase() === tag) return n;
      const inner = findElement(n.childNodes, tag);
      if (inner) return inner;
    }
  }
  return undefined;
}

function getAttr(el: P5Element, name: string): string | undefined {
  return el.attrs.find((a: { name: string; value: string }) => a.name === name)?.value;
}

function nameFor(el: P5Element, fallback?: string): string {
  // Class names win over IDs when both are present — real pages commonly
  // carry both (class="hero" id="hero") and the class-derived title case
  // reads better. Stripped-leading-dot names like ".hero-grid" from the
  // old nameFor become "Hero Grid" here.
  const cls = getAttr(el, 'class');
  if (cls) {
    const first = cls.trim().split(/\s+/)[0];
    if (first) return toTitleCase(first);
  }
  // IDs fall back next, also title-cased so a section with `id="how"`
  // becomes "How" in the Figma layer panel (not the DOM-shaped "how").
  const id = getAttr(el, 'id');
  if (id) return toTitleCase(id);
  if (fallback) return fallback;
  // Semantic HTML5 landmarks → Title Case. Generic divs / spans stay
  // lowercase so they're easy to spot-and-rename.
  const tag = el.tagName.toLowerCase();
  if (SEMANTIC_TAGS.has(tag)) return toTitleCase(tag);
  return tag;
}

const SEMANTIC_TAGS = new Set([
  'header',
  'nav',
  'main',
  'article',
  'section',
  'aside',
  'footer',
  'figure',
  'figcaption',
  'form',
  'dialog',
]);

function toTitleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function nextId(ctx: BuildContext, prefix: string): string {
  ctx.idCounter += 1;
  return `${prefix}-${ctx.idCounter}`;
}
