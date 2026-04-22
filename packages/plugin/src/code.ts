/// <reference types="@figma/plugin-typings" />
import {
  type ComponentDef,
  type EffectStyleDef,
  type FontManifestEntry,
  type IRDocument,
  IRDocumentSchema,
  type IRNode,
  type Effect as IrEffect,
  type Paint as IrPaint,
  type Stroke as IrStroke,
  type PaintStyleDef,
  type TextStyleDef,
} from '@claude-to-figma/ir';
import type { ZodIssue } from 'zod';

figma.showUI(__html__, { width: 440, height: 520, title: 'claude-to-figma' });

type UiMessage = { type: 'build'; ir: string } | { type: 'ping' };

figma.ui.onmessage = async (msg: UiMessage) => {
  if (msg.type === 'ping') {
    figma.ui.postMessage({ type: 'pong' });
    return;
  }
  if (msg.type === 'build') {
    try {
      const parsed = parseIr(msg.ir);
      const result = await build(parsed);
      figma.ui.postMessage({ type: 'build:ok', nodeId: result.rootId, stats: result.stats });
      figma.notify(`Built ${result.stats.nodes} nodes, ${result.stats.components} components.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: 'build:error', message });
      figma.notify(`Build failed: ${message}`, { error: true });
    }
  }
};

function parseIr(text: string): IRDocument {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
  const res = IRDocumentSchema.safeParse(json);
  if (!res.success) {
    const issues = res.error.issues
      .slice(0, 5)
      .map((i: ZodIssue) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`IR validation failed:\n${issues}`);
  }
  return res.data;
}

// ---------------------------------------------------------------------------
// Build pipeline
// ---------------------------------------------------------------------------

interface BuildContext {
  paintStyles: Map<string, PaintStyle>;
  textStyles: Map<string, TextStyle>;
  effectStyles: Map<string, EffectStyle>;
  components: Map<string, ComponentNode>;
  stats: { nodes: number; components: number };
}

async function build(doc: IRDocument): Promise<{ rootId: string; stats: BuildContext['stats'] }> {
  await preloadFonts(doc.fonts, doc);

  const ctx: BuildContext = {
    paintStyles: new Map(),
    textStyles: new Map(),
    effectStyles: new Map(),
    components: new Map(),
    stats: { nodes: 0, components: 0 },
  };

  for (const p of doc.styles.paints) registerPaintStyle(ctx, p);
  for (const t of doc.styles.texts) await registerTextStyle(ctx, t);
  for (const e of doc.styles.effects) registerEffectStyle(ctx, e);
  for (const c of doc.components) await registerComponent(ctx, c);

  const root = await buildNode(doc.root, ctx);
  figma.currentPage.appendChild(root);

  // Collect the component masters into a sibling frame to the right of the
  // page. Without this, `figma.createComponent()` orphans auto-attach to
  // currentPage at (0,0) — they land on top of the page content instead of
  // being tucked away like a real Figma component library.
  if (ctx.components.size > 0) {
    const library = figma.createFrame();
    library.name = 'Components';
    library.layoutMode = 'VERTICAL';
    library.itemSpacing = 48;
    library.paddingTop = 48;
    library.paddingRight = 48;
    library.paddingBottom = 48;
    library.paddingLeft = 48;
    library.primaryAxisSizingMode = 'AUTO';
    library.counterAxisSizingMode = 'AUTO';
    library.fills = [{ type: 'SOLID', color: { r: 0.96, g: 0.96, b: 0.98 } }];
    for (const component of ctx.components.values()) library.appendChild(component);
    figma.currentPage.appendChild(library);
    const rootWidth = 'width' in root ? root.width : 0;
    library.x = ('x' in root ? root.x : 0) + rootWidth + 200;
    library.y = 'y' in root ? root.y : 0;
    figma.viewport.scrollAndZoomIntoView([root, library]);
  } else {
    figma.viewport.scrollAndZoomIntoView([root]);
  }

  return { rootId: root.id, stats: ctx.stats };
}

// ---------------------------------------------------------------------------
// Font preload
// ---------------------------------------------------------------------------

async function preloadFonts(manifest: FontManifestEntry[], doc: IRDocument): Promise<void> {
  const needed = new Map<string, FontName>();
  const add = (f: FontName): void => {
    needed.set(`${f.family}::${f.style}`, f);
  };
  for (const f of manifest) add({ family: f.family, style: f.style });
  const walk = (n: IRNode): void => {
    if (n.type === 'TEXT') add({ family: n.textStyle.fontFamily, style: n.textStyle.fontStyle });
    if (n.type === 'FRAME') for (const c of n.children) walk(c);
  };
  walk(doc.root);
  for (const c of doc.components) walk(c.root);
  for (const t of doc.styles.texts) add({ family: t.style.fontFamily, style: t.style.fontStyle });

  const missing: string[] = [];
  await Promise.all(
    [...needed.values()].map(async (font) => {
      try {
        await figma.loadFontAsync(font);
      } catch {
        missing.push(`${font.family} ${font.style}`);
      }
    }),
  );
  if (missing.length > 0) {
    throw new Error(`Missing fonts (install in Figma first):\n  ${missing.join('\n  ')}`);
  }
}

// ---------------------------------------------------------------------------
// Styles registry
// ---------------------------------------------------------------------------

function registerPaintStyle(ctx: BuildContext, def: PaintStyleDef): void {
  const style = figma.createPaintStyle();
  style.name = def.name;
  style.paints = def.paints.map(toFigmaPaint);
  if (def.description) style.description = def.description;
  ctx.paintStyles.set(def.id, style);
}

function registerEffectStyle(ctx: BuildContext, def: EffectStyleDef): void {
  const style = figma.createEffectStyle();
  style.name = def.name;
  style.effects = def.effects.map(toFigmaEffect);
  if (def.description) style.description = def.description;
  ctx.effectStyles.set(def.id, style);
}

async function registerTextStyle(ctx: BuildContext, def: TextStyleDef): Promise<void> {
  const style = figma.createTextStyle();
  style.name = def.name;
  await figma.loadFontAsync({ family: def.style.fontFamily, style: def.style.fontStyle });
  style.fontName = { family: def.style.fontFamily, style: def.style.fontStyle };
  style.fontSize = def.style.fontSize;
  style.lineHeight = def.style.lineHeight;
  style.letterSpacing = def.style.letterSpacing;
  if (def.description) style.description = def.description;
  ctx.textStyles.set(def.id, style);
}

async function registerComponent(ctx: BuildContext, def: ComponentDef): Promise<void> {
  if (def.root.type !== 'FRAME') {
    throw new Error(`Component ${def.id} root must be a FRAME node, got ${def.root.type}`);
  }
  const component = figma.createComponent();
  component.name = def.name;
  applyFrameProps(component, def.root, ctx);
  for (const child of def.root.children) {
    const built = await buildNode(child, ctx);
    component.appendChild(built);
    applyChildLayout(built, child);
  }
  ctx.components.set(def.id, component);
  ctx.stats.components += 1;
}

// ---------------------------------------------------------------------------
// Node building
// ---------------------------------------------------------------------------

async function buildNode(node: IRNode, ctx: BuildContext): Promise<SceneNode> {
  ctx.stats.nodes += 1;
  let built: SceneNode;
  switch (node.type) {
    case 'FRAME':
      built = await buildFrame(node, ctx);
      break;
    case 'TEXT':
      built = await buildText(node, ctx);
      break;
    case 'IMAGE':
      built = buildImage(node);
      break;
    case 'VECTOR':
      built = buildVector(node, ctx);
      break;
    case 'INSTANCE':
      built = await buildInstance(node, ctx);
      break;
  }
  built.setPluginData('irId', node.id);
  return built;
}

async function buildFrame(
  node: Extract<IRNode, { type: 'FRAME' }>,
  ctx: BuildContext,
): Promise<FrameNode> {
  if (node.svgSource) {
    const imported = importSvg(node.svgSource, node.name, node.geometry);
    if (imported) return imported;
  }
  const frame = figma.createFrame();
  applyFrameProps(frame, node, ctx);
  for (const child of node.children) {
    const built = await buildNode(child, ctx);
    frame.appendChild(built);
    applyChildLayout(built, child);
  }
  return frame;
}

/**
 * Import a raw `<svg>...</svg>` markup via Figma's native SVG parser.
 * Returns `undefined` on failure so the caller can fall back to the
 * path-based IR representation. Figma handles viewBox scaling,
 * `currentColor`, stroke-linecap, per-shape attributes — everything
 * the author wrote in the SVG survives the round-trip.
 */
function importSvg(
  source: string,
  name: string,
  geometry: { x: number; y: number; width: number; height: number } | undefined,
): FrameNode | undefined {
  try {
    const imported = figma.createNodeFromSvg(source);
    imported.name = name || 'svg';
    if (geometry) {
      imported.x = geometry.x;
      imported.y = geometry.y;
      if (geometry.width > 0 && geometry.height > 0) {
        imported.resize(geometry.width, geometry.height);
      }
    }
    return imported;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    figma.notify(`Skipped SVG import on "${name}": ${msg}`);
    return undefined;
  }
}

function applyFrameProps(
  frame: FrameNode | ComponentNode,
  node: Extract<IRNode, { type: 'FRAME' }>,
  ctx: BuildContext,
): void {
  if (node.name) frame.name = node.name;

  const layout = node.layout;
  if (layout && layout.layoutMode !== 'NONE') {
    frame.layoutMode = layout.layoutMode;
    frame.itemSpacing = layout.itemSpacing;
    frame.counterAxisSpacing = layout.counterAxisSpacing;
    frame.paddingTop = layout.paddingTop;
    frame.paddingRight = layout.paddingRight;
    frame.paddingBottom = layout.paddingBottom;
    frame.paddingLeft = layout.paddingLeft;
    frame.primaryAxisAlignItems = layout.primaryAxisAlignItems;
    frame.counterAxisAlignItems = layout.counterAxisAlignItems;
    frame.layoutWrap = layout.layoutWrap;
    frame.primaryAxisSizingMode = layout.primaryAxisSizingMode;
    frame.counterAxisSizingMode = layout.counterAxisSizingMode;
    frame.clipsContent = layout.clipsContent;
  }

  if (node.geometry) {
    frame.x = node.geometry.x;
    frame.y = node.geometry.y;
    frame.resize(Math.max(0.01, node.geometry.width), Math.max(0.01, node.geometry.height));
  }

  frame.opacity = node.opacity;
  frame.visible = node.visible;
  if (typeof node.cornerRadius === 'number') frame.cornerRadius = node.cornerRadius;
  // CSS rotate(Ndeg) is clockwise, Figma's `rotation` is anti-clockwise
  // when positive. Flip sign to match.
  if (typeof node.rotation === 'number' && node.rotation !== 0) {
    frame.rotation = -node.rotation;
  }

  frame.fills = node.fills.map(toFigmaPaint);
  if (node.strokes.length > 0) {
    frame.strokes = node.strokes.map((s: IrStroke) => toFigmaPaint(s.paint));
    const first = node.strokes[0];
    if (first) {
      frame.strokeWeight = first.weight;
      frame.strokeAlign = first.align;
    }
  }
  frame.effects = node.effects.map(toFigmaEffect);

  if (node.fillStyleId) {
    const style = ctx.paintStyles.get(node.fillStyleId);
    if (style) frame.fillStyleId = style.id;
  }
  if (node.strokeStyleId) {
    const style = ctx.paintStyles.get(node.strokeStyleId);
    if (style) frame.strokeStyleId = style.id;
  }
  if (node.effectStyleId) {
    const style = ctx.effectStyles.get(node.effectStyleId);
    if (style) frame.effectStyleId = style.id;
  }
}

async function buildText(
  node: Extract<IRNode, { type: 'TEXT' }>,
  ctx: BuildContext,
): Promise<TextNode> {
  const text = figma.createText();
  text.name = node.name || 'Text';
  await figma.loadFontAsync({
    family: node.textStyle.fontFamily,
    style: node.textStyle.fontStyle,
  });
  text.fontName = { family: node.textStyle.fontFamily, style: node.textStyle.fontStyle };
  text.fontSize = node.textStyle.fontSize;
  text.lineHeight = node.textStyle.lineHeight;
  text.letterSpacing = node.textStyle.letterSpacing;
  text.textAlignHorizontal = node.textStyle.textAlign;
  text.textDecoration = node.textStyle.textDecoration;
  text.textCase = node.textStyle.textCase;
  text.characters = node.characters;

  text.opacity = node.opacity;
  text.visible = node.visible;
  text.fills = node.fills.map(toFigmaPaint);

  // Figma TEXT nodes default to `WIDTH_AND_HEIGHT` auto-resize, which
  // grows the node wide enough to fit all characters on one line. That
  // blows past the IR-measured geometry and makes long headings / body
  // copy overflow their parent frame. Set `HEIGHT` so the width is
  // fixed at the IR-measured value and the height auto-grows by wrap.
  if (node.geometry && node.geometry.width > 0) {
    text.textAutoResize = 'HEIGHT';
    text.resize(node.geometry.width, text.height);
    text.x = node.geometry.x;
    text.y = node.geometry.y;
  } else if (node.geometry) {
    text.x = node.geometry.x;
    text.y = node.geometry.y;
  }

  if (node.textStyleId) {
    const style = ctx.textStyles.get(node.textStyleId);
    if (style) text.textStyleId = style.id;
  }
  if (node.fillStyleId) {
    const style = ctx.paintStyles.get(node.fillStyleId);
    if (style) text.fillStyleId = style.id;
  }
  return text;
}

function buildImage(node: Extract<IRNode, { type: 'IMAGE' }>): RectangleNode {
  const rect = figma.createRectangle();
  rect.name = node.name || 'Image';
  if (node.geometry) {
    rect.x = node.geometry.x;
    rect.y = node.geometry.y;
    rect.resize(Math.max(0.01, node.geometry.width), Math.max(0.01, node.geometry.height));
  }
  rect.opacity = node.opacity;
  rect.visible = node.visible;
  if (typeof node.cornerRadius === 'number') rect.cornerRadius = node.cornerRadius;
  rect.fills = node.fills.length
    ? node.fills.map(toFigmaPaint)
    : [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.92 } }];
  return rect;
}

function buildVector(
  node: Extract<IRNode, { type: 'VECTOR' }>,
  ctx: BuildContext,
): VectorNode | FrameNode {
  if (node.svgSource) {
    const imported = importSvg(node.svgSource, node.name, node.geometry);
    if (imported) return imported;
  }
  const v = figma.createVector();
  v.name = node.name || 'Vector';
  if (node.path) {
    // Figma's path parser is stricter than browsers — it can reject paths
    // that render fine in Chrome. Failing soft here means a single bad
    // path emits an empty vector frame instead of aborting the whole build.
    try {
      v.vectorPaths = [{ windingRule: 'NONZERO', data: node.path }];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      figma.notify(`Skipped invalid vector path on "${v.name}": ${msg}`);
    }
  }
  if (node.geometry) {
    v.x = node.geometry.x;
    v.y = node.geometry.y;
  }
  v.opacity = node.opacity;
  v.visible = node.visible;
  v.fills = node.fills.map(toFigmaPaint);
  if (node.strokes.length > 0) {
    v.strokes = node.strokes.map((s: IrStroke) => toFigmaPaint(s.paint));
    const first = node.strokes[0];
    if (first) {
      v.strokeWeight = first.weight;
      v.strokeAlign = first.align;
    }
  }
  if (node.fillStyleId) {
    const style = ctx.paintStyles.get(node.fillStyleId);
    if (style) v.fillStyleId = style.id;
  }
  if (node.strokeStyleId) {
    const style = ctx.paintStyles.get(node.strokeStyleId);
    if (style) v.strokeStyleId = style.id;
  }
  return v;
}

function buildInstance(
  node: Extract<IRNode, { type: 'INSTANCE' }>,
  ctx: BuildContext,
): InstanceNode {
  const component = ctx.components.get(node.componentId);
  if (!component) {
    throw new Error(`Instance references unknown component: ${node.componentId}`);
  }
  const instance = component.createInstance();
  instance.name = node.name || component.name;
  if (node.geometry) {
    instance.x = node.geometry.x;
    instance.y = node.geometry.y;
  }
  instance.opacity = node.opacity;
  instance.visible = node.visible;

  if (node.overrides) applyOverrides(instance, node.overrides);
  return instance;
}

function applyOverrides(
  instance: InstanceNode,
  overrides: NonNullable<Extract<IRNode, { type: 'INSTANCE' }>['overrides']>,
): void {
  const walk = (n: SceneNode): void => {
    const irId = n.getPluginData('irId');
    const override = (irId && overrides[irId]) ?? overrides[n.name];
    if (override && n.type === 'TEXT' && typeof override.characters === 'string') {
      n.characters = override.characters;
    }
    if ('children' in n) {
      for (const child of n.children) walk(child);
    }
  };
  walk(instance);
}

function applyChildLayout(node: SceneNode, ir: IRNode): void {
  const cl = ir.childLayout;
  if (!cl) return;
  if ('layoutPositioning' in node) node.layoutPositioning = cl.layoutPositioning;
  if ('layoutGrow' in node) node.layoutGrow = cl.layoutGrow;
  if ('layoutAlign' in node) node.layoutAlign = cl.layoutAlign;
}

// ---------------------------------------------------------------------------
// Paint / effect mappers
// ---------------------------------------------------------------------------

function toFigmaPaint(p: IrPaint): Paint {
  if (p.type === 'SOLID') {
    return {
      type: 'SOLID',
      color: { r: p.color.r, g: p.color.g, b: p.color.b },
      opacity: p.color.a * p.opacity,
      visible: p.visible,
    };
  }
  if (p.type === 'GRADIENT_LINEAR' || p.type === 'GRADIENT_RADIAL') {
    return {
      type: p.type,
      gradientTransform: p.gradientTransform,
      gradientStops: p.gradientStops.map((s) => ({
        position: s.position,
        color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
      })),
      opacity: p.opacity,
      visible: p.visible,
    };
  }
  // IMAGE fallback — the plugin has no image-asset pipeline yet.
  return {
    type: 'SOLID',
    color: { r: 0.88, g: 0.88, b: 0.9 },
    opacity: p.opacity,
    visible: p.visible,
  };
}

function toFigmaEffect(e: IrEffect): Effect {
  if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
    return {
      type: e.type,
      color: { r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.a },
      offset: e.offset,
      radius: e.radius,
      spread: e.spread,
      visible: e.visible,
      blendMode: 'NORMAL',
    };
  }
  return {
    type: e.type,
    radius: e.radius,
    visible: e.visible,
  };
}
