/**
 * Text-style extraction — collect every unique TextStyle combo across the
 * IR (including component masters), name them with size buckets, and
 * stamp the matching `textStyleId` on every TEXT node.
 *
 * Naming heuristic:
 *   - Buckets by font-size, with weight nudging styles into the heading
 *     family even at smaller sizes:
 *       size ≥ 32                  → heading/xl
 *       size ≥ 24                  → heading/lg
 *       size ≥ 18 OR (size ≥ 16 AND bold-ish) → heading/md
 *       size ≥ 16                  → body/lg
 *       size ≥ 14                  → body/md
 *       size ≥ 12                  → body/sm
 *       size < 12                  → caption
 *   - When a bucket holds only one style, that style gets the plain
 *     bucket name (`heading/md`). When two or more distinct styles
 *     share a bucket, each gets a weight-suffixed variant
 *     (`heading/md-medium`, `heading/md-bold`) so the semantic prefix
 *     survives. Remaining ties within the same `bucket-weight` get a
 *     numeric suffix (`heading/md-medium-2`) — rare.
 */

import type { IRDocument, IRNode, TextStyle, TextStyleDef } from '@claude-to-figma/ir';

interface TextStyleUsage {
  style: TextStyle;
  /** Stable key used for dedup. */
  key: string;
  count: number;
  styleId?: string;
  styleName?: string;
}

const BOLD_STYLES = new Set(['Bold', 'Semi Bold', 'Extra Bold', 'Black']);

export function extractTextStyles(doc: IRDocument): {
  styles: TextStyleDef[];
  styleIdByKey: Map<string, string>;
} {
  const usage = new Map<string, TextStyleUsage>();
  collectStyles(doc.root, usage);
  for (const def of doc.components) collectStyles(def.root, usage);
  if (usage.size === 0) {
    return { styles: [], styleIdByKey: new Map() };
  }
  assignNames(usage);

  const styles: TextStyleDef[] = [];
  const styleIdByKey = new Map<string, string>();
  const named = [...usage.values()]
    .filter((u): u is TextStyleUsage & { styleId: string; styleName: string } => Boolean(u.styleId))
    .sort((a, b) => a.styleId.localeCompare(b.styleId));
  for (const u of named) {
    styles.push({ id: u.styleId, name: u.styleName, style: u.style });
    styleIdByKey.set(u.key, u.styleId);
  }
  return { styles, styleIdByKey };
}

export function applyTextStyles(doc: IRDocument, styleIdByKey: Map<string, string>): IRDocument {
  return {
    ...doc,
    root: applyToNode(doc.root, styleIdByKey),
    components: doc.components.map((c) => ({ ...c, root: applyToNode(c.root, styleIdByKey) })),
  };
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

function collectStyles(node: IRNode, usage: Map<string, TextStyleUsage>): void {
  switch (node.type) {
    case 'FRAME':
      for (const child of node.children) collectStyles(child, usage);
      break;
    case 'TEXT': {
      const key = textStyleKey(node.textStyle);
      let entry = usage.get(key);
      if (!entry) {
        entry = { style: node.textStyle, key, count: 0 };
        usage.set(key, entry);
      }
      entry.count += 1;
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

function assignNames(usage: Map<string, TextStyleUsage>): void {
  // Group by bucket so we can detect collisions.
  const byBucket = new Map<string, TextStyleUsage[]>();
  for (const entry of [...usage.values()].sort(orderForNaming)) {
    const bucket = pickBucket(entry.style);
    let arr = byBucket.get(bucket);
    if (!arr) {
      arr = [];
      byBucket.set(bucket, arr);
    }
    arr.push(entry);
  }

  for (const [bucket, entries] of byBucket) {
    if (entries.length === 1) {
      const only = entries[0];
      if (!only) continue;
      only.styleId = bucket;
      only.styleName = bucket;
      continue;
    }
    // Multiple styles share a bucket — suffix each with its weight slug
    // so the semantic prefix survives. Ties within the same weight get
    // a numeric tail.
    const seen = new Map<string, number>();
    for (const e of entries) {
      const base = `${bucket}-${slug(e.style.fontStyle)}`;
      const n = seen.get(base) ?? 0;
      const id = n === 0 ? base : `${base}-${n + 1}`;
      seen.set(base, n + 1);
      e.styleId = id;
      e.styleName = id;
    }
  }
}

function orderForNaming(a: TextStyleUsage, b: TextStyleUsage): number {
  // Frequency desc, then size desc, then key for tiebreak.
  if (b.count !== a.count) return b.count - a.count;
  if (b.style.fontSize !== a.style.fontSize) return b.style.fontSize - a.style.fontSize;
  return a.key.localeCompare(b.key);
}

function pickBucket(style: TextStyle): string {
  const size = style.fontSize;
  const heavy = BOLD_STYLES.has(style.fontStyle);
  if (size >= 32) return 'heading/xl';
  if (size >= 24) return 'heading/lg';
  if (size >= 18) return 'heading/md';
  if (size >= 16 && heavy) return 'heading/md';
  if (size >= 16) return 'body/lg';
  if (size >= 14) return 'body/md';
  if (size >= 12) return 'body/sm';
  return 'caption';
}

function slug(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-');
}

// ---------------------------------------------------------------------------
// Apply pass
// ---------------------------------------------------------------------------

function applyToNode(node: IRNode, byKey: Map<string, string>): IRNode {
  switch (node.type) {
    case 'FRAME':
      return { ...node, children: node.children.map((c) => applyToNode(c, byKey)) };
    case 'TEXT': {
      const id = byKey.get(textStyleKey(node.textStyle));
      return id ? { ...node, textStyleId: id } : node;
    }
    default:
      return node;
  }
}

// ---------------------------------------------------------------------------
// Key
// ---------------------------------------------------------------------------

export function textStyleKey(s: TextStyle): string {
  return JSON.stringify({
    family: s.fontFamily,
    style: s.fontStyle,
    size: s.fontSize,
    lh: s.lineHeight,
    ls: s.letterSpacing,
    align: s.textAlign,
    deco: s.textDecoration,
    case: s.textCase,
  });
}
