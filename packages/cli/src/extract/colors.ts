/**
 * Paint extraction — collect every unique SOLID color across the IR
 * (including inside component masters), name them, and stamp the
 * matching `fillStyleId` on every node that uses each one.
 *
 * Naming per ADR 0010 (supersedes ADR 0005's frequency-only scheme):
 *   1. Pure white / pure black → `color/white` / `color/black` regardless
 *      of role or frequency. They're nearly always structural.
 *   2. Each colour is tagged with its per-role usage counts (background,
 *      text, stroke, icon). Colours used non-trivially (>= 20%) in two
 *      or more roles go to the `brand/*` bucket; single-role colours
 *      fall into their dominant role's bucket (`surface/*`, `ink/*`,
 *      `border/*`, `icon/*`).
 *   3. Within each bucket, top-N by total count get the named slots
 *      (`primary`, `secondary`, `tertiary`, `muted`, `subtle`). The
 *      tail falls back to `color/{6-char-hex}`.
 */

import type { Color, IRDocument, IRNode, Paint, PaintStyleDef } from '@claude-to-figma/ir';

/** Narrowed alias for the SOLID branch of the discriminated Paint union. */
type SolidPaint = Extract<Paint, { type: 'SOLID' }>;

type Role = 'background' | 'text' | 'stroke' | 'icon';

interface PaintUsage {
  color: Color;
  hex: string;
  key: string;
  roles: Record<Role, number>;
  total: number;
  styleId?: string;
  styleName?: string;
}

/** Slot names per bucket. Order is slot priority — top-N colours fill slots
 * in order; once slots are exhausted, remaining colours go to the hex tail. */
const BUCKET_SLOTS = {
  brand: ['brand/primary', 'brand/accent', 'brand/secondary'],
  surface: ['surface/primary', 'surface/secondary', 'surface/tertiary'],
  ink: ['ink/primary', 'ink/muted', 'ink/subtle'],
  border: ['border/default', 'border/subtle'],
  icon: ['icon/primary', 'icon/secondary'],
} as const;

type Bucket = keyof typeof BUCKET_SLOTS;

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
      for (const fill of node.fills) recordPaint(fill, 'background', usage);
      for (const stroke of node.strokes) recordPaint(stroke.paint, 'stroke', usage);
      for (const child of node.children) collectPaints(child, usage);
      break;
    case 'TEXT':
      for (const fill of node.fills) recordPaint(fill, 'text', usage);
      break;
    case 'VECTOR':
      for (const fill of node.fills) recordPaint(fill, 'icon', usage);
      for (const stroke of node.strokes) recordPaint(stroke.paint, 'icon', usage);
      break;
    case 'IMAGE':
      for (const fill of node.fills) recordPaint(fill, 'background', usage);
      break;
    case 'INSTANCE':
      // Instance fills come from the component master; nothing to harvest.
      break;
  }
}

function recordPaint(paint: Paint, role: Role, usage: Map<string, PaintUsage>): void {
  if (paint.type !== 'SOLID') return;
  const key = colorKey(paint.color);
  let entry = usage.get(key);
  if (!entry) {
    entry = {
      color: paint.color,
      hex: hexOf(paint.color),
      key,
      roles: { background: 0, text: 0, stroke: 0, icon: 0 },
      total: 0,
    };
    usage.set(key, entry);
  }
  entry.roles[role] += 1;
  entry.total += 1;
}

// ---------------------------------------------------------------------------
// Naming (ADR 0010)
// ---------------------------------------------------------------------------

function assignNames(usage: Map<string, PaintUsage>): void {
  const entries = [...usage.values()];

  // 1. Structural pure-white / pure-black special case.
  for (const e of entries) {
    if (e.hex === 'ffffff') {
      e.styleId = 'color/white';
      e.styleName = 'color/white';
    } else if (e.hex === '000000') {
      e.styleId = 'color/black';
      e.styleName = 'color/black';
    }
  }

  // 2. Bucket remaining entries by role.
  const buckets: Record<Bucket, PaintUsage[]> = {
    brand: [],
    surface: [],
    ink: [],
    border: [],
    icon: [],
  };
  for (const e of entries) {
    if (e.styleId) continue;
    buckets[classifyRole(e)].push(e);
  }

  // 3. Rank within each bucket by total count, assign named slots.
  for (const [bucket, list] of Object.entries(buckets) as Array<[Bucket, PaintUsage[]]>) {
    const slots = BUCKET_SLOTS[bucket];
    list.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.hex.localeCompare(b.hex);
    });
    for (let i = 0; i < Math.min(slots.length, list.length); i += 1) {
      const entry = list[i];
      const slot = slots[i];
      if (!entry || !slot) continue;
      entry.styleId = slot;
      entry.styleName = slot;
    }
  }

  // 4. Tail: `color/{hex}` for colours beyond their bucket's slot count.
  for (const e of entries) {
    if (e.styleId) continue;
    const id = e.color.a === 1 ? `color/${e.hex}` : `color/${e.hex}${alphaHex(e.color.a)}`;
    e.styleId = id;
    e.styleName = id;
  }
}

function classifyRole(u: PaintUsage): Bucket {
  // Saturated colours (appreciable chroma) are brand — regardless of role
  // breakdown. Near-neutrals (dark text, light backgrounds) go to their
  // dominant-role bucket even when they span multiple roles. Without this,
  // a dark ink used on text + stroke + the footer's dark bg would land in
  // `brand/primary`, which is semantically wrong.
  if (isSaturated(u.color)) return 'brand';

  // Neutral colour used non-trivially across 2+ roles — still put it in
  // its dominant-role bucket, not brand. (Happens for e.g. a mid-grey
  // used as both subdued text and a divider stroke.)
  const order: Array<[Role, Bucket]> = [
    ['background', 'surface'],
    ['text', 'ink'],
    ['stroke', 'border'],
    ['icon', 'icon'],
  ];
  let bestRole: Role = 'background';
  let bestCount = -1;
  for (const [role] of order) {
    if (u.roles[role] > bestCount) {
      bestRole = role;
      bestCount = u.roles[role];
    }
  }
  return (order.find(([r]) => r === bestRole)?.[1] ?? 'surface') as Bucket;
}

/**
 * Approximation of HSL saturation / chroma — (max - min) of the RGB
 * channels, normalised. Tuned threshold (0.15) catches colours like
 * `#B5471F` (chroma 0.59) and rejects near-neutrals like `#1C1A16`
 * (chroma 0.024). Alpha is ignored — transparency doesn't change hue.
 */
function isSaturated(c: Color): boolean {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  return max - min > 0.15;
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
        ...withStrokeStyleId(node.strokes, byKey, node.strokeStyleId),
        children: node.children.map((c) => applyToNode(c, byKey)),
      };
    case 'TEXT':
      return { ...node, ...withStyleId(node.fills, byKey, node.fillStyleId) };
    case 'VECTOR':
      return {
        ...node,
        ...withStyleId(node.fills, byKey, node.fillStyleId),
        ...withStrokeStyleId(node.strokes, byKey, node.strokeStyleId),
      };
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

function withStrokeStyleId(
  strokes: { paint: Paint }[],
  byKey: Map<string, string>,
  current: string | undefined,
): { strokeStyleId?: string } {
  // Mirror withStyleId for strokes. Figma's PaintStyle API doesn't carry
  // weight/align, so those still live on the Stroke object — but the paint
  // half links to the same paint style as any matching fill (already named
  // via the border/* role bucket in ADR 0010).
  const first = strokes[0]?.paint;
  if (!first || first.type !== 'SOLID') return current ? { strokeStyleId: current } : {};
  const id = byKey.get(colorKey((first as SolidPaint).color));
  return id ? { strokeStyleId: id } : current ? { strokeStyleId: current } : {};
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
