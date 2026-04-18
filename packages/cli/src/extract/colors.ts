/**
 * Paint extraction — collect every unique SOLID color across the IR
 * (including inside component masters), name them, and stamp the
 * matching `fillStyleId` on every node that uses each one.
 *
 * Naming heuristic (per KICKSTART):
 *   1. Pure white / pure black → `color/white` / `color/black` regardless
 *      of frequency. They're nearly always structural (background, text)
 *      not brand, so naming them `color/primary` would mislead.
 *   2. Of the remaining colors, the top three by usage frequency get
 *      `color/primary`, `color/secondary`, `color/accent`.
 *   3. Everything else falls back to `color/{6-char-hex}`.
 */

import type { Color, IRDocument, IRNode, Paint, PaintStyleDef } from '@claude-to-figma/ir';

/** Narrowed alias for the SOLID branch of the discriminated Paint union. */
type SolidPaint = Extract<Paint, { type: 'SOLID' }>;

interface PaintUsage {
  color: Color;
  hex: string;
  count: number;
  /** Stable key used for dedup before the public id is decided. */
  key: string;
  /** Final assigned style id, set after naming. */
  styleId?: string;
  styleName?: string;
}

const TARGET_NAMES = ['color/primary', 'color/secondary', 'color/accent'] as const;

/**
 * Walk the document, collect unique solid paints, and return both the
 * paint-style registry and a side map keyed by colorKey → styleId for
 * the apply pass.
 */
export function extractPaintStyles(doc: IRDocument): {
  styles: PaintStyleDef[];
  styleIdByColorKey: Map<string, string>;
} {
  const usage = new Map<string, PaintUsage>();
  collectPaints(doc.root, usage);
  for (const def of doc.components) collectPaints(def.root, usage);
  if (usage.size === 0) {
    return { styles: [], styleIdByColorKey: new Map() };
  }
  assignNames(usage);

  const styles: PaintStyleDef[] = [];
  const styleIdByColorKey = new Map<string, string>();
  const named = [...usage.values()]
    .filter((u): u is PaintUsage & { styleId: string; styleName: string } => Boolean(u.styleId))
    .sort((a, b) => a.styleId.localeCompare(b.styleId));
  for (const u of named) {
    styles.push({ id: u.styleId, name: u.styleName, paints: [solidPaint(u.color)] });
    styleIdByColorKey.set(u.key, u.styleId);
  }
  return { styles, styleIdByColorKey };
}

/**
 * Re-walk the tree (and component masters), set `fillStyleId` on every
 * FRAME / TEXT whose first solid fill matches a registered style.
 *
 * Returns a mutated copy of `doc` — original is untouched.
 */
export function applyPaintStyles(
  doc: IRDocument,
  styleIdByColorKey: Map<string, string>,
): IRDocument {
  return {
    ...doc,
    root: applyToNode(doc.root, styleIdByColorKey),
    components: doc.components.map((c) => ({ ...c, root: applyToNode(c.root, styleIdByColorKey) })),
  };
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

function collectPaints(node: IRNode, usage: Map<string, PaintUsage>): void {
  switch (node.type) {
    case 'FRAME':
      for (const fill of node.fills) recordPaint(fill, usage);
      for (const child of node.children) collectPaints(child, usage);
      break;
    case 'TEXT':
      for (const fill of node.fills) recordPaint(fill, usage);
      break;
    case 'IMAGE':
    case 'VECTOR':
      for (const fill of node.fills) recordPaint(fill, usage);
      break;
    case 'INSTANCE':
      // Instance fills come from the component master; nothing to harvest.
      break;
  }
}

function recordPaint(paint: Paint, usage: Map<string, PaintUsage>): void {
  if (paint.type !== 'SOLID') return;
  const key = colorKey(paint.color);
  let entry = usage.get(key);
  if (!entry) {
    entry = { color: paint.color, hex: hexOf(paint.color), count: 0, key };
    usage.set(key, entry);
  }
  entry.count += 1;
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

function assignNames(usage: Map<string, PaintUsage>): void {
  const entries = [...usage.values()];

  // 1. Special-case pure black + pure white.
  for (const e of entries) {
    if (e.hex === 'ffffff') {
      e.styleId = 'color/white';
      e.styleName = 'color/white';
    } else if (e.hex === '000000') {
      e.styleId = 'color/black';
      e.styleName = 'color/black';
    }
  }

  // 2. Top N (by frequency, ties broken by hex) → primary / secondary / accent.
  const remaining = entries
    .filter((e) => !e.styleId)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.hex.localeCompare(b.hex);
    });
  for (let i = 0; i < Math.min(TARGET_NAMES.length, remaining.length); i += 1) {
    const target = TARGET_NAMES[i];
    const entry = remaining[i];
    if (!target || !entry) continue;
    entry.styleId = target;
    entry.styleName = target;
  }

  // 3. Everything else: `color/{hex}` (alpha appended when not 1).
  for (const e of entries) {
    if (e.styleId) continue;
    const id = e.color.a === 1 ? `color/${e.hex}` : `color/${e.hex}${alphaHex(e.color.a)}`;
    e.styleId = id;
    e.styleName = id;
  }
}

// ---------------------------------------------------------------------------
// Apply pass
// ---------------------------------------------------------------------------

function applyToNode(node: IRNode, byKey: Map<string, string>): IRNode {
  switch (node.type) {
    case 'FRAME':
      return {
        ...node,
        ...withStyleId(node.fills, byKey, node.fillStyleId),
        children: node.children.map((c) => applyToNode(c, byKey)),
      };
    case 'TEXT':
      return { ...node, ...withStyleId(node.fills, byKey, node.fillStyleId) };
    default:
      return node;
  }
}

function withStyleId(
  fills: Paint[],
  byKey: Map<string, string>,
  current: string | undefined,
): { fillStyleId?: string } {
  // Only consider the first solid fill — the IR currently models layered
  // fills as an array, but Figma paint styles wrap a single (or paint-set)
  // value. The plugin already understands `fillStyleId` as referencing the
  // entire paints array of the registered style.
  const first = fills.find((f): f is SolidPaint => f.type === 'SOLID');
  if (!first) return current ? { fillStyleId: current } : {};
  const id = byKey.get(colorKey(first.color));
  return id ? { fillStyleId: id } : current ? { fillStyleId: current } : {};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function colorKey(c: Color): string {
  // Round to 4 decimal places so "near-equal" colors from float math collapse.
  const r = Math.round(c.r * 10_000) / 10_000;
  const g = Math.round(c.g * 10_000) / 10_000;
  const b = Math.round(c.b * 10_000) / 10_000;
  const a = Math.round(c.a * 10_000) / 10_000;
  return `${r}|${g}|${b}|${a}`;
}

export function hexOf(c: Color): string {
  const to2 = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, '0');
  return `${to2(c.r)}${to2(c.g)}${to2(c.b)}`;
}

function alphaHex(a: number): string {
  return Math.round(a * 255)
    .toString(16)
    .padStart(2, '0');
}

function solidPaint(color: Color): Paint {
  return { type: 'SOLID', color, opacity: 1, visible: true };
}
