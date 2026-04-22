/**
 * Effect-style extraction — collect every unique Effect[] stack across
 * the IR (including component masters), name them by dominant radius,
 * and stamp the matching `effectStyleId` on every FRAME that carries
 * them. Designers can then edit one shadow and have all linked frames
 * update, instead of chasing identical inline values node-by-node.
 *
 * Naming heuristic — pick the largest radius across the stack, then:
 *   - LAYER_BLUR / BACKGROUND_BLUR stacks → `blur/*` or `backdrop-blur/*`
 *     (sm ≤ 4, md ≤ 12, lg ≤ 24, xl > 24).
 *   - DROP_SHADOW / INNER_SHADOW stacks → `shadow/*` at the same buckets.
 *   - Mixed stacks (shadow + blur in the same style, rare) → `fx/*`.
 *   - Collisions inside a bucket get a `-2`, `-3` numeric suffix. Rare.
 */

import type { Effect, EffectStyleDef, IRDocument, IRNode } from '@claude-to-figma/ir';

interface EffectUsage {
  effects: Effect[];
  key: string;
  count: number;
  styleId?: string;
  styleName?: string;
}

export function extractEffectStyles(doc: IRDocument): {
  styles: EffectStyleDef[];
  styleIdByKey: Map<string, string>;
} {
  const usage = new Map<string, EffectUsage>();
  collect(doc.root, usage);
  for (const def of doc.components) collect(def.root, usage);
  if (usage.size === 0) {
    return { styles: [], styleIdByKey: new Map() };
  }
  assignNames(usage);

  const styles: EffectStyleDef[] = [];
  const styleIdByKey = new Map<string, string>();
  const named = [...usage.values()]
    .filter((u): u is EffectUsage & { styleId: string; styleName: string } => Boolean(u.styleId))
    .sort((a, b) => a.styleId.localeCompare(b.styleId));
  for (const u of named) {
    styles.push({ id: u.styleId, name: u.styleName, effects: u.effects });
    styleIdByKey.set(u.key, u.styleId);
  }
  return { styles, styleIdByKey };
}

export function applyEffectStyles(doc: IRDocument, styleIdByKey: Map<string, string>): IRDocument {
  return {
    ...doc,
    root: applyToNode(doc.root, styleIdByKey),
    components: doc.components.map((c) => ({ ...c, root: applyToNode(c.root, styleIdByKey) })),
  };
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

function collect(node: IRNode, usage: Map<string, EffectUsage>): void {
  if (node.type === 'FRAME') {
    if (node.effects.length > 0) {
      const key = effectStackKey(node.effects);
      let entry = usage.get(key);
      if (!entry) {
        entry = { effects: node.effects, key, count: 0 };
        usage.set(key, entry);
      }
      entry.count += 1;
    }
    for (const child of node.children) collect(child, usage);
  }
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

function assignNames(usage: Map<string, EffectUsage>): void {
  const byBucket = new Map<string, EffectUsage[]>();
  for (const entry of [...usage.values()].sort(orderForNaming)) {
    const bucket = pickBucket(entry.effects);
    let arr = byBucket.get(bucket);
    if (!arr) {
      arr = [];
      byBucket.set(bucket, arr);
    }
    arr.push(entry);
  }

  for (const [bucket, entries] of byBucket) {
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry) continue;
      const id = i === 0 ? bucket : `${bucket}-${i + 1}`;
      entry.styleId = id;
      entry.styleName = id;
    }
  }
}

function orderForNaming(a: EffectUsage, b: EffectUsage): number {
  // Frequency desc, then largest radius desc (so the dominant shadow
  // takes the plain bucket slot when two collide), then key.
  if (b.count !== a.count) return b.count - a.count;
  const ar = maxRadius(a.effects);
  const br = maxRadius(b.effects);
  if (br !== ar) return br - ar;
  return a.key.localeCompare(b.key);
}

function pickBucket(effects: Effect[]): string {
  const family = familyFor(effects);
  const r = maxRadius(effects);
  const size = r <= 4 ? 'sm' : r <= 12 ? 'md' : r <= 24 ? 'lg' : 'xl';
  return `${family}/${size}`;
}

function familyFor(effects: Effect[]): string {
  let hasShadow = false;
  let hasLayerBlur = false;
  let hasBackdropBlur = false;
  for (const e of effects) {
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') hasShadow = true;
    else if (e.type === 'LAYER_BLUR') hasLayerBlur = true;
    else if (e.type === 'BACKGROUND_BLUR') hasBackdropBlur = true;
  }
  if (hasShadow && !hasLayerBlur && !hasBackdropBlur) return 'shadow';
  if (!hasShadow && hasLayerBlur && !hasBackdropBlur) return 'blur';
  if (!hasShadow && !hasLayerBlur && hasBackdropBlur) return 'backdrop-blur';
  return 'fx';
}

function maxRadius(effects: Effect[]): number {
  let max = 0;
  for (const e of effects) if (e.radius > max) max = e.radius;
  return max;
}

// ---------------------------------------------------------------------------
// Apply pass
// ---------------------------------------------------------------------------

function applyToNode(node: IRNode, byKey: Map<string, string>): IRNode {
  if (node.type === 'FRAME') {
    const next: IRNode = { ...node, children: node.children.map((c) => applyToNode(c, byKey)) };
    if (node.effects.length > 0) {
      const id = byKey.get(effectStackKey(node.effects));
      if (id) (next as typeof node).effectStyleId = id;
    }
    return next;
  }
  return node;
}

// ---------------------------------------------------------------------------
// Key — stable hash of the effect stack. Arrays are ordered, so identical
// box-shadow lists in the same source order collapse; CSS doesn't let you
// reorder a shadow list without visible change, so order is meaningful.
// ---------------------------------------------------------------------------

export function effectStackKey(effects: Effect[]): string {
  return JSON.stringify(effects.map(normalizeForKey));
}

function normalizeForKey(e: Effect): unknown {
  if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
    return {
      t: e.type,
      c: roundColor(e.color),
      ox: round(e.offset.x),
      oy: round(e.offset.y),
      r: round(e.radius),
      s: round(e.spread),
      v: e.visible,
    };
  }
  return { t: e.type, r: round(e.radius), v: e.visible };
}

function roundColor(c: { r: number; g: number; b: number; a: number }): string {
  return `${round(c.r)}|${round(c.g)}|${round(c.b)}|${round(c.a)}`;
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
