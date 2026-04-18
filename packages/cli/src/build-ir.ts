/**
 * HTML parse5 tree → IRDocument.
 *
 * M2 only handles inline styles. The walker classifies each element as a
 * FRAME, TEXT, IMAGE, or VECTOR node and emits geometry strictly from
 * inline width/height/top/left. Anything that needs the cascade or a layout
 * engine is deferred to M3 / M4.
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

type P5ChildNode = DefaultTreeAdapterTypes.ChildNode;
type P5Document = DefaultTreeAdapterTypes.Document;
type P5Element = DefaultTreeAdapterTypes.Element;
type P5TextNode = DefaultTreeAdapterTypes.TextNode;
import {
  parseColor,
  parseFontFamily,
  parseInlineStyle,
  parseLetterSpacing,
  parseLineHeight,
  parsePx,
  parseTextAlign,
  parseTextDecoration,
  parseTextTransform,
  weightToFigmaStyle,
} from './style.js';

const TEXT_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'span',
  'a',
  'label',
  'li',
  'strong',
  'em',
  'b',
  'i',
  'small',
  'button',
  'caption',
  'figcaption',
  'blockquote',
  'pre',
  'code',
]);

const IGNORED_TAGS = new Set(['script', 'style', 'meta', 'link', 'title', 'head', 'noscript']);

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

interface BuildContext {
  warnings: string[];
  idCounter: number;
  fontKeys: Set<string>;
  fonts: FontManifestEntry[];
  inheritedTextStyle: TextStyle;
  inheritedTextColor: Paint[] | undefined;
}

export interface ConvertResult {
  document: IRDocument;
  warnings: string[];
  stats: { nodes: number };
}

export interface ConvertOptions {
  name?: string;
}

export function convertHtml(html: string, opts: ConvertOptions = {}): ConvertResult {
  const tree = parse(html) as P5Document;
  const body = findElement(tree.childNodes, 'body');
  const ctx: BuildContext = {
    warnings: [],
    idCounter: 0,
    fontKeys: new Set(),
    fonts: [],
    inheritedTextStyle: DEFAULT_TEXT_STYLE,
    inheritedTextColor: undefined,
  };

  if (!body) {
    throw new Error('parse5 returned a document without a <body> — this should be unreachable');
  }
  const root = buildFrameFromElement(body, ctx, 'root');

  registerFont(ctx, DEFAULT_TEXT_STYLE.fontFamily, DEFAULT_TEXT_STYLE.fontStyle);

  const document: IRDocument = {
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

  return { document, warnings: ctx.warnings, stats: { nodes: ctx.idCounter } };
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
    return buildText(el, ctx, tag);
  }

  return buildFrameFromElement(el, ctx);
}

function buildFrameFromElement(el: P5Element, ctx: BuildContext, idHint?: string): FrameNode {
  const style = parseInlineStyle(getAttr(el, 'style'));
  const geometry = readGeometry(style);
  const fills = readBackgroundFills(style);

  const cornerRadius = parsePx(style.get('border-radius'));

  const inheritedReset = pushInheritance(ctx, style);
  const children: IRNode[] = [];
  for (const child of el.childNodes) {
    const built = buildChild(child, ctx);
    if (built) children.push(built);
  }
  popInheritance(ctx, inheritedReset);

  if (!geometry) {
    ctx.warnings.push(`frame <${el.tagName}> has no inline width/height — defaulted to 0×0`);
  }

  const frame: FrameNode = {
    type: 'FRAME',
    id: idHint ?? nextId(ctx, el.tagName),
    name: nameFor(el),
    geometry: geometry ?? { x: 0, y: 0, width: 0, height: 0 },
    opacity: parseOpacity(style),
    visible: true,
    fills,
    strokes: [],
    effects: [],
    children,
  };
  if (cornerRadius != null) frame.cornerRadius = cornerRadius;
  return frame;
}

function buildText(el: P5Element, ctx: BuildContext, _tag: string): TextNode | null {
  const characters = collectText(el);
  if (!characters) return null;

  const style = parseInlineStyle(getAttr(el, 'style'));
  const textStyle = resolveTextStyle(ctx.inheritedTextStyle, style);
  registerFont(ctx, textStyle.fontFamily, textStyle.fontStyle);

  const fillColor = parseColor(style.get('color'));
  const fills: Paint[] = fillColor
    ? [{ type: 'SOLID', color: fillColor, opacity: 1, visible: true }]
    : (ctx.inheritedTextColor ?? [
        { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true },
      ]);

  const geometry = readGeometry(style);

  return {
    type: 'TEXT',
    id: nextId(ctx, 'text'),
    name: nameFor(el, characters.slice(0, 32)),
    geometry,
    opacity: parseOpacity(style),
    visible: true,
    characters,
    textStyle,
    fills,
  };
}

function buildImage(el: P5Element, ctx: BuildContext): ImageNode {
  const style = parseInlineStyle(getAttr(el, 'style'));
  const widthAttr = parsePx(getAttr(el, 'width'));
  const heightAttr = parsePx(getAttr(el, 'height'));
  const geometry = readGeometry(style) ?? {
    x: 0,
    y: 0,
    width: widthAttr ?? 0,
    height: heightAttr ?? 0,
  };
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
  const style = parseInlineStyle(getAttr(el, 'style'));
  const geometry = readGeometry(style);
  const path = collectFirstPath(el) ?? '';
  if (!path) ctx.warnings.push(`<svg> had no <path d="..."> — emitted with empty path`);

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

function buildChild(child: P5ChildNode, ctx: BuildContext): IRNode | null {
  if (isElement(child)) return buildNodeFromElement(child, ctx);
  if (isTextNode(child)) {
    const trimmed = child.value.trim();
    if (!trimmed) return null;
    // Bare text directly inside a frame: wrap in an anonymous TEXT node.
    return {
      type: 'TEXT',
      id: nextId(ctx, 'text'),
      name: trimmed.slice(0, 32) || 'Text',
      opacity: 1,
      visible: true,
      characters: trimmed,
      textStyle: ctx.inheritedTextStyle,
      fills: ctx.inheritedTextColor ?? [
        { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true },
      ],
    };
  }
  return null;
}

function containsOnlyText(el: P5Element): boolean {
  return el.childNodes.every((c: P5ChildNode) => {
    if (isTextNode(c)) return true;
    if (isElement(c)) {
      const tag = c.tagName.toLowerCase();
      return tag === 'br' || (TEXT_TAGS.has(tag) && containsOnlyText(c));
    }
    return false;
  });
}

function collectText(el: P5Element): string {
  let out = '';
  for (const c of el.childNodes) {
    if (isTextNode(c)) out += c.value;
    else if (isElement(c)) {
      if (c.tagName.toLowerCase() === 'br') out += '\n';
      else out += collectText(c);
    }
  }
  return out.replace(/\s+/g, ' ').trim();
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
// Style application
// ---------------------------------------------------------------------------

function readGeometry(
  style: ReturnType<typeof parseInlineStyle>,
): { x: number; y: number; width: number; height: number } | undefined {
  const w = parsePx(style.get('width'));
  const h = parsePx(style.get('height'));
  const x = parsePx(style.get('left')) ?? 0;
  const y = parsePx(style.get('top')) ?? 0;
  if (w == null && h == null) return undefined;
  return { x, y, width: w ?? 0, height: h ?? 0 };
}

function readBackgroundFills(style: ReturnType<typeof parseInlineStyle>): Paint[] {
  const bg = style.get('background-color') ?? style.get('background');
  const color = parseColor(bg);
  if (!color) return [];
  return [{ type: 'SOLID', color, opacity: 1, visible: true }];
}

function parseOpacity(style: ReturnType<typeof parseInlineStyle>): number {
  const raw = style.get('opacity');
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function resolveTextStyle(
  inherited: TextStyle,
  style: ReturnType<typeof parseInlineStyle>,
): TextStyle {
  const family = parseFontFamily(style.get('font-family')) ?? inherited.fontFamily;
  const italic = (style.get('font-style')?.toLowerCase() ?? '').includes('italic');
  const figmaStyle = style.get('font-weight')
    ? weightToFigmaStyle(style.get('font-weight'), italic)
    : italic
      ? weightToFigmaStyle('400', true)
      : inherited.fontStyle;
  const size = parsePx(style.get('font-size')) ?? inherited.fontSize;
  const lineHeight = parseLineHeight(style.get('line-height')) ?? inherited.lineHeight;
  const letterSpacing = parseLetterSpacing(style.get('letter-spacing')) ?? inherited.letterSpacing;
  const textAlign = parseTextAlign(style.get('text-align')) ?? inherited.textAlign;
  const textDecoration =
    parseTextDecoration(style.get('text-decoration')) ?? inherited.textDecoration;
  const textCase = parseTextTransform(style.get('text-transform')) ?? inherited.textCase;

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

function pushInheritance(
  ctx: BuildContext,
  style: ReturnType<typeof parseInlineStyle>,
): { textStyle: TextStyle; textColor: Paint[] | undefined } {
  const prev = { textStyle: ctx.inheritedTextStyle, textColor: ctx.inheritedTextColor };
  ctx.inheritedTextStyle = resolveTextStyle(ctx.inheritedTextStyle, style);
  const color = parseColor(style.get('color'));
  if (color) {
    ctx.inheritedTextColor = [{ type: 'SOLID', color, opacity: 1, visible: true }];
  }
  return prev;
}

function popInheritance(
  ctx: BuildContext,
  prev: { textStyle: TextStyle; textColor: Paint[] | undefined },
): void {
  ctx.inheritedTextStyle = prev.textStyle;
  ctx.inheritedTextColor = prev.textColor;
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

