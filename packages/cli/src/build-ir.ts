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
  parseStylesheets,
} from './cascade/index.js';
import { detectComponents } from './detect/index.js';
import { extractTokens } from './extract/index.js';
import { type LayoutMap, computeLayout, mapFlexChild, mapFlexContainer } from './layout/index.js';
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
  const layout = computeLayout(cascadeRoot, cascade.styles);

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

  const frame: FrameNode = {
    type: 'FRAME',
    id: idHint ?? nextId(ctx, el.tagName),
    name: nameFor(el),
    geometry,
    opacity: parseOpacity(style),
    visible: true,
    fills,
    strokes: [],
    effects: [],
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
  const path = collectFirstPath(el) ?? '';
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

function collectFirstPath(el: P5Element): string | undefined {
  for (const c of el.childNodes) {
    if (isElement(c)) {
      if (c.tagName.toLowerCase() === 'path') {
        const d = getAttr(c, 'd');
        if (d) return d;
      }
      const inner = collectFirstPath(c);
      if (inner) return inner;
    }
  }
  return undefined;
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
  const bg = style.get('background-color') ?? style.get('background');
  const color = parseColor(bg);
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
