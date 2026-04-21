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
  type TextNode,
  type TextStyle,
  type VectorNode,
} from '@claude-to-figma/ir';
import { type DefaultTreeAdapterTypes, parse } from 'parse5';
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
  parseColor,
  parseFontFamily,
  parseLetterSpacing,
  parseLineHeight,
  parsePx,
  parseTextAlign,
  parseTextDecoration,
  parseTextTransform,
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
   * Root container width in px. Enables block-centring emulation and
   * grid-track sizing when the HTML's body has no explicit CSS width
   * — typically the `--viewport` the conversion ran at.
   */
  viewportWidth?: number;
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
  });

  const ctx: BuildContext = {
    warnings: [...collected.warnings],
    idCounter: 0,
    fontKeys: new Set(),
    fonts: [],
    styles: cascade.styles,
    layout,
    bodyEl: body,
  };

  const root = buildFrameFromElement(body, ctx, 'root');
  registerFont(ctx, DEFAULT_TEXT_STYLE.fontFamily, DEFAULT_TEXT_STYLE.fontStyle);

  const baseDocument: IRDocument = {
    version: IR_VERSION,
    name: opts.name ?? 'Untitled',
    root,
    styles: { paints: [], texts: [] },
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
    },
  };
}

// ---------------------------------------------------------------------------
// Element walker
// ---------------------------------------------------------------------------

function buildNodeFromElement(el: P5Element, ctx: BuildContext): IRNode | null {
  const tag = el.tagName.toLowerCase();
  if (IGNORED_TAGS.has(tag)) return null;

  if (tag === 'img') return buildImage(el, ctx);
  if (tag === 'svg') return buildVector(el, ctx);
  if (tag === 'br') return null;

  if (TEXT_TAGS.has(tag) && containsOnlyText(el)) {
    return buildText(el, ctx);
  }

  return buildFrameFromElement(el, ctx);
}

function buildFrameFromElement(el: P5Element, ctx: BuildContext, idHint?: string): FrameNode {
  const style = styleOf(ctx, el);
  const geometry = geometryOf(ctx, el);
  const fills = readBackgroundFills(style);
  const cornerRadius = parsePx(style.get('border-radius'));
  const layout = mapFlexContainer(style);

  const children: IRNode[] = [];
  for (const child of el.childNodes) {
    const built = buildChild(child, el, ctx);
    if (!built) continue;
    decorateChildLayout(built, el, child, ctx);
    children.push(built);
  }

  const stroke = readStroke(style);
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
  const characters = collectInnerText(el);
  if (!characters) return null;

  const style = styleOf(ctx, el);
  const textStyle = resolveTextStyle(style);
  registerFont(ctx, textStyle.fontFamily, textStyle.fontStyle);

  const fillColor = parseColor(style.get('color'));
  const fills: Paint[] = fillColor
    ? [{ type: 'SOLID', color: fillColor, opacity: 1, visible: true }]
    : DEFAULT_TEXT_FILLS;

  return {
    type: 'TEXT',
    id: nextId(ctx, 'text'),
    name: nameFor(el, characters.slice(0, 32)),
    geometry: geometryOf(ctx, el),
    opacity: parseOpacity(style),
    visible: true,
    characters,
    textStyle,
    fills,
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

function buildVector(el: P5Element, ctx: BuildContext): VectorNode {
  const style = styleOf(ctx, el);
  const geometry = geometryOf(ctx, el);
  const raw = collectAllPaths(el).join(' ');
  const path = normalizeSvgPath(raw);
  if (!path) ctx.warnings.push('<svg> had no <path d="..."> — emitted with empty path');

  return {
    type: 'VECTOR',
    id: nextId(ctx, 'vector'),
    name: nameFor(el),
    geometry,
    opacity: parseOpacity(style),
    visible: true,
    path,
    fills: [],
    strokes: [],
  };
}

/**
 * Normalize an SVG `d` attribute into the whitespace-separated tokens
 * Figma's vector path parser expects. Compact SVG (`M0,65L100,50`) parses
 * fine in browsers but Figma reads `M0` as a command literal and rejects
 * it with `Invalid command at M0,65`.
 */
function normalizeSvgPath(d: string): string {
  if (!d) return '';
  return (
    d
      // Insert a space before every command letter (M, L, C, Q, Z, H, V, A, S, T,
      // and lowercase variants) so they're never glued to a number.
      .replace(/([A-Za-z])/g, ' $1 ')
      // Replace commas with spaces — Figma wants whitespace between args.
      .replace(/,/g, ' ')
      // Collapse runs of whitespace.
      .replace(/\s+/g, ' ')
      .trim()
  );
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
    const textStyle = resolveTextStyle(parentStyle);
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

function collectAllPaths(el: P5Element): string[] {
  const out: string[] = [];
  const walk = (node: P5Element) => {
    for (const c of node.childNodes) {
      if (!isElement(c)) continue;
      const tag = c.tagName.toLowerCase();
      if (tag === 'path') {
        const d = getAttr(c, 'd');
        if (d) out.push(d);
      } else {
        const synthesised = shapeToPath(c, tag);
        if (synthesised) out.push(synthesised);
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
      // Clockwise, starting at the top-left tangent of the top-left corner arc.
      return `M${x + rxc} ${y} H${x + w - rxc} A${rxc} ${ryc} 0 0 1 ${x + w} ${y + ryc} V${y + h - ryc} A${rxc} ${ryc} 0 0 1 ${x + w - rxc} ${y + h} H${x + rxc} A${rxc} ${ryc} 0 0 1 ${x} ${y + h - ryc} V${y + ryc} A${rxc} ${ryc} 0 0 1 ${x + rxc} ${y} Z`;
    }
    return `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
  }
  if (tag === 'circle') {
    const cx = num(getAttr(el, 'cx')) ?? 0;
    const cy = num(getAttr(el, 'cy')) ?? 0;
    const r = num(getAttr(el, 'r'));
    if (r == null || r <= 0) return undefined;
    // Two half-arcs to trace a full circle.
    return `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
  }
  if (tag === 'ellipse') {
    const cx = num(getAttr(el, 'cx')) ?? 0;
    const cy = num(getAttr(el, 'cy')) ?? 0;
    const rx = num(getAttr(el, 'rx'));
    const ry = num(getAttr(el, 'ry'));
    if (rx == null || ry == null || rx <= 0 || ry <= 0) return undefined;
    return `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
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

function resolveTextStyle(style: ComputedStyle): TextStyle {
  const family = parseFontFamily(style.get('font-family')) ?? DEFAULT_TEXT_STYLE.fontFamily;
  const italic = (style.get('font-style')?.toLowerCase() ?? '').includes('italic');
  const figmaStyle = style.get('font-weight')
    ? weightToFigmaStyle(style.get('font-weight'), italic)
    : italic
      ? weightToFigmaStyle('400', true)
      : DEFAULT_TEXT_STYLE.fontStyle;
  const size = parsePx(style.get('font-size')) ?? DEFAULT_TEXT_STYLE.fontSize;
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
  const id = getAttr(el, 'id');
  if (id) return id;
  const cls = getAttr(el, 'class');
  if (cls) return `.${cls.trim().split(/\s+/)[0]}`;
  if (fallback) return fallback;
  return el.tagName.toLowerCase();
}

function nextId(ctx: BuildContext, prefix: string): string {
  ctx.idCounter += 1;
  return `${prefix}-${ctx.idCounter}`;
}
