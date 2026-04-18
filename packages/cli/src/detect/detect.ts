/**
 * Component detection — identify subtrees that repeat at least `threshold`
 * times, promote them to component definitions, and rewrite the tree to
 * use INSTANCE nodes that reference those components.
 *
 * M6 scope:
 *   - Conservative variant detection: only group subtrees with identical
 *     hashes (see ./hash.ts). Different fills, layouts, structure, etc.
 *     do NOT collapse to a single component.
 *   - TEXT.characters differences become per-instance overrides.
 *   - IMAGE.imageRef differences are tolerated (instances point at the
 *     same component) but the IR's override schema can't yet carry per-
 *     instance image refs; for M6 the instance silently uses the master's
 *     image. Acceptable for the M6 fixtures (identical cards) and noted
 *     for the M7+ token/style work.
 *   - No nested component detection within an already-promoted master.
 */

import type {
  FrameNode,
  IRDocument,
  IRNode,
  ImageNode,
  InstanceNode,
  TextNode,
  VectorNode,
} from '@claude-to-figma/ir';
import { hashSubtree } from './hash.js';

export interface DetectOptions {
  /** Minimum number of identical subtrees required to promote. Default 3. */
  threshold?: number;
}

export interface DetectResult {
  document: IRDocument;
  /** How many components were detected and how many instances each one has. */
  stats: { components: number; instances: number };
}

const DEFAULT_THRESHOLD = 3;
const GENERIC_NAME_PATTERN =
  /^(div|section|article|header|footer|main|nav|aside|span|html|body)(-\d+)?$/i;

interface ComponentPlan {
  componentId: string;
  componentName: string;
  master: FrameNode;
  occurrences: FrameNode[];
}

export function detectComponents(doc: IRDocument, opts: DetectOptions = {}): DetectResult {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;

  // 1. Hash every FRAME in the tree. We only promote frames — TEXT/IMAGE/
  //    VECTOR repeats have no useful identity beyond their content.
  const groups = new Map<string, FrameNode[]>();
  collectFrames(doc.root, groups);

  // 2. Filter to groups that meet the threshold, deterministic ordering by
  //    group size descending so larger components come first in the registry.
  const plans = planComponents(groups, threshold, doc);
  if (plans.length === 0) {
    return { document: doc, stats: { components: 0, instances: 0 } };
  }

  // 3. Build masters and rewrite the tree.
  const occurrenceMap = new Map<FrameNode, ComponentPlan>();
  let instanceCount = 0;
  let instanceCounter = 0;
  for (const plan of plans) {
    for (const occ of plan.occurrences) occurrenceMap.set(occ, plan);
    instanceCount += plan.occurrences.length;
  }

  const newRoot = rewrite(doc.root, occurrenceMap, () => ({
    nextId: () => `instance-${++instanceCounter}`,
  }));

  return {
    document: {
      ...doc,
      root: newRoot,
      components: [
        ...doc.components,
        ...plans.map((p) => ({ id: p.componentId, name: p.componentName, root: p.master })),
      ],
    },
    stats: { components: plans.length, instances: instanceCount },
  };
}

// ---------------------------------------------------------------------------
// Hashing pass
// ---------------------------------------------------------------------------

function collectFrames(node: IRNode, out: Map<string, FrameNode[]>): void {
  if (node.type === 'FRAME') {
    const hash = hashSubtree(node);
    let arr = out.get(hash);
    if (!arr) {
      arr = [];
      out.set(hash, arr);
    }
    arr.push(node);
    for (const child of node.children) collectFrames(child, out);
    return;
  }
  // Other node types don't carry children (per IR schema).
}

// ---------------------------------------------------------------------------
// Planning pass — pick which groups become components
// ---------------------------------------------------------------------------

function planComponents(
  groups: Map<string, FrameNode[]>,
  threshold: number,
  doc: IRDocument,
): ComponentPlan[] {
  // Filter to groups that meet the threshold first, then drop groups whose
  // members are nested inside members of OTHER candidate groups. M6 promotes
  // outer patterns only; nested repeat detection is left to a later
  // milestone.
  const candidateGroups = [...groups.entries()].filter(([_, nodes]) => nodes.length >= threshold);
  const allCandidateNodes = new Set(candidateGroups.flatMap(([_, nodes]) => nodes));

  // For each candidate node, collect its FRAME descendants so we can tell if
  // another candidate falls inside it.
  const descendantsOfCandidates = new Set<FrameNode>();
  for (const candidate of allCandidateNodes) {
    for (const descendant of frameDescendants(candidate)) {
      if (allCandidateNodes.has(descendant)) descendantsOfCandidates.add(descendant);
    }
  }

  const plans: ComponentPlan[] = [];
  const usedIds = new Set(doc.components.map((c) => c.id));
  let counter = 0;

  // Sort groups so the planning is deterministic across runs (snapshot-stable).
  // First by size descending, then by hash for tie-breaking.
  const sorted = candidateGroups.sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0] < b[0] ? -1 : 1;
  });

  for (const [_hash, occurrences] of sorted) {
    const outer = occurrences.filter((o) => !descendantsOfCandidates.has(o));
    if (outer.length < threshold) continue;
    const first = outer[0];
    if (!first) continue;

    counter += 1;
    const componentName = pickName(first, counter);
    const componentId = uniqueId(componentName, usedIds);
    usedIds.add(componentId);
    const master = buildMaster(first, componentId);

    plans.push({ componentId, componentName, master, occurrences: outer });
  }

  return plans;
}

function frameDescendants(node: FrameNode): FrameNode[] {
  const out: FrameNode[] = [];
  const walk = (n: FrameNode): void => {
    for (const child of n.children) {
      if (child.type === 'FRAME') {
        out.push(child);
        walk(child);
      }
    }
  };
  walk(node);
  return out;
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

function pickName(node: FrameNode, counter: number): string {
  const raw = node.name?.trim() ?? '';
  if (!raw) return `Component${counter}`;
  // Strip leading dot (".card" → "card") and trailing -N from auto-generated names.
  const cleaned = raw.replace(/^\./, '').replace(/-\d+$/, '');
  if (!cleaned || GENERIC_NAME_PATTERN.test(cleaned)) return `Component${counter}`;
  // Capitalize first character so it reads like a Figma component name.
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function uniqueId(name: string, taken: Set<string>): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'component';
  if (!taken.has(slug)) return slug;
  let i = 2;
  while (taken.has(`${slug}-${i}`)) i += 1;
  return `${slug}-${i}`;
}

// ---------------------------------------------------------------------------
// Master construction — reassign IDs so they're stable across instances
// ---------------------------------------------------------------------------

function buildMaster(occurrence: FrameNode, componentId: string): FrameNode {
  return cloneWithStableIds(occurrence, [componentId]) as FrameNode;
}

function cloneWithStableIds(node: IRNode, path: string[]): IRNode {
  const id = path.join('.');
  switch (node.type) {
    case 'FRAME':
      return {
        ...node,
        id,
        children: node.children.map((c, i) =>
          cloneWithStableIds(c, [...path, `${childKey(c)}-${i}`]),
        ),
      } satisfies FrameNode;
    case 'TEXT':
      return { ...node, id } satisfies TextNode;
    case 'IMAGE':
      return { ...node, id } satisfies ImageNode;
    case 'VECTOR':
      return { ...node, id } satisfies VectorNode;
    case 'INSTANCE':
      return { ...node, id } satisfies InstanceNode;
  }
}

function childKey(node: IRNode): string {
  switch (node.type) {
    case 'TEXT':
      return 'text';
    case 'IMAGE':
      return 'image';
    case 'VECTOR':
      return 'vector';
    case 'INSTANCE':
      return 'instance';
    default:
      return 'frame';
  }
}

// ---------------------------------------------------------------------------
// Tree rewrite — replace each occurrence with an INSTANCE node
// ---------------------------------------------------------------------------

interface RewriteCtx {
  nextId: () => string;
}

function rewrite(
  node: IRNode,
  occurrenceMap: Map<FrameNode, ComponentPlan>,
  makeCtx: () => RewriteCtx,
): IRNode {
  // Lazy-init the ctx so we share the counter across all rewrite calls.
  let ctx: RewriteCtx | null = null;
  const getCtx = () => {
    ctx ??= makeCtx();
    return ctx;
  };

  return walk(node);

  function walk(n: IRNode): IRNode {
    if (n.type === 'FRAME') {
      const plan = occurrenceMap.get(n);
      if (plan) return makeInstance(n, plan, getCtx());
      return { ...n, children: n.children.map(walk) };
    }
    return n;
  }
}

function makeInstance(occurrence: FrameNode, plan: ComponentPlan, ctx: RewriteCtx): InstanceNode {
  const overrides: Record<string, { characters?: string }> = {};
  collectOverrides(occurrence, plan.master, overrides);

  const instance: InstanceNode = {
    type: 'INSTANCE',
    id: ctx.nextId(),
    name: occurrence.name || plan.componentName,
    geometry: occurrence.geometry,
    childLayout: occurrence.childLayout,
    opacity: occurrence.opacity,
    visible: occurrence.visible,
    componentId: plan.componentId,
  };
  if (Object.keys(overrides).length > 0) instance.overrides = overrides;
  return instance;
}

function collectOverrides(
  occ: IRNode,
  master: IRNode,
  out: Record<string, { characters?: string }>,
): void {
  if (occ.type !== master.type) return;
  if (occ.type === 'TEXT' && master.type === 'TEXT') {
    if (occ.characters !== master.characters) {
      out[master.id] = { characters: occ.characters };
    }
    return;
  }
  if (occ.type === 'FRAME' && master.type === 'FRAME') {
    const len = Math.min(occ.children.length, master.children.length);
    for (let i = 0; i < len; i += 1) {
      const occChild = occ.children[i];
      const masterChild = master.children[i];
      if (occChild && masterChild) collectOverrides(occChild, masterChild, out);
    }
  }
}
