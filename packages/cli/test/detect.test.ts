/**
 * Component-detection tests — covers V-M6-DETECTION-TESTS.
 *
 * Half of these are pure-function tests against `hashSubtree` and
 * `detectComponents`; the other half go through `convertHtml` end-to-end
 * to check that detection cooperates with the cascade + layout passes.
 */

import {
  type ComponentDef,
  type FrameNode,
  type IRDocument,
  type IRNode,
  IR_VERSION,
  type InstanceNode,
} from '@claude-to-figma/ir';
import { describe, expect, it } from 'vitest';
import { convertHtml } from '../src/convert.js';
import { detectComponents, hashSubtree } from '../src/detect/index.js';

// ---------------------------------------------------------------------------
// Tiny IR builders for the unit tests
// ---------------------------------------------------------------------------

let counter = 0;
const id = () => `n-${++counter}`;

function frame(opts: Partial<FrameNode> & { children?: IRNode[]; name?: string }): FrameNode {
  return {
    type: 'FRAME',
    id: opts.id ?? id(),
    name: opts.name ?? 'frame',
    geometry: opts.geometry ?? { x: 0, y: 0, width: 100, height: 100 },
    opacity: 1,
    visible: true,
    fills: opts.fills ?? [],
    strokes: [],
    effects: [],
    children: opts.children ?? [],
    ...(opts.layout ? { layout: opts.layout } : {}),
    ...(opts.cornerRadius != null ? { cornerRadius: opts.cornerRadius } : {}),
  };
}

function text(characters: string, name = 'text'): IRNode {
  return {
    type: 'TEXT',
    id: id(),
    name,
    geometry: { x: 0, y: 0, width: 80, height: 20 },
    opacity: 1,
    visible: true,
    characters,
    textStyle: {
      fontFamily: 'Inter',
      fontStyle: 'Regular',
      fontSize: 16,
      lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PIXELS', value: 0 },
      textAlign: 'LEFT',
      textDecoration: 'NONE',
      textCase: 'ORIGINAL',
    },
    fills: [],
  };
}

function doc(root: FrameNode, components: ComponentDef[] = []): IRDocument {
  return {
    version: IR_VERSION,
    name: 'test',
    root,
    styles: { paints: [], texts: [], effects: [] },
    components,
    fonts: [],
    images: [],
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// hashSubtree
// ---------------------------------------------------------------------------

describe('hashSubtree', () => {
  it('returns the same hash for two structurally identical subtrees', () => {
    const a = frame({ name: 'card', children: [text('Hi', 'title')] });
    const b = frame({ name: 'card', children: [text('Hi', 'title')] });
    expect(hashSubtree(a)).toBe(hashSubtree(b));
  });

  it('is insensitive to TEXT.characters', () => {
    const a = frame({ name: 'card', children: [text('A', 'title')] });
    const b = frame({ name: 'card', children: [text('B', 'title')] });
    expect(hashSubtree(a)).toBe(hashSubtree(b));
  });

  it('is insensitive to geometry x/y', () => {
    const a = frame({ name: 'card', geometry: { x: 0, y: 0, width: 100, height: 50 } });
    const b = frame({ name: 'card', geometry: { x: 999, y: 999, width: 100, height: 50 } });
    expect(hashSubtree(a)).toBe(hashSubtree(b));
  });

  it('is insensitive to geometry width/height (legitimate variation)', () => {
    const a = frame({ name: 'card', geometry: { x: 0, y: 0, width: 100, height: 50 } });
    const b = frame({ name: 'card', geometry: { x: 0, y: 0, width: 200, height: 50 } });
    // Same component, different sizes — exactly how Figma components work.
    expect(hashSubtree(a)).toBe(hashSubtree(b));
  });

  it('IS sensitive to name (class signature proxy)', () => {
    const a = frame({ name: 'card' });
    const b = frame({ name: 'banner' });
    expect(hashSubtree(a)).not.toBe(hashSubtree(b));
  });

  it('IS sensitive to children structure', () => {
    const a = frame({ name: 'x', children: [text('Hi', 'a')] });
    const b = frame({ name: 'x', children: [text('Hi', 'a'), text('Hi', 'b')] });
    expect(hashSubtree(a)).not.toBe(hashSubtree(b));
  });

  it('IS sensitive to fills', () => {
    const a = frame({ name: 'x', fills: [] });
    const b = frame({
      name: 'x',
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }],
    });
    expect(hashSubtree(a)).not.toBe(hashSubtree(b));
  });
});

// ---------------------------------------------------------------------------
// detectComponents (unit-level)
// ---------------------------------------------------------------------------

describe('detectComponents', () => {
  it('does nothing when no subtree repeats above the threshold', () => {
    const root = frame({ children: [frame({ name: 'a' }), frame({ name: 'b' })] });
    const result = detectComponents(doc(root));
    expect(result.stats.components).toBe(0);
    expect(result.document.components).toEqual([]);
  });

  it('promotes a subtree that repeats exactly threshold times (default 3)', () => {
    const card = (): FrameNode => frame({ name: 'card', children: [text('Hi', 'title')] });
    const root = frame({ children: [card(), card(), card()] });
    const result = detectComponents(doc(root));
    expect(result.stats.components).toBe(1);
    expect(result.document.components).toHaveLength(1);
    expect(result.document.components[0]?.name).toBe('Card');
  });

  it('respects a custom threshold', () => {
    const item = (): FrameNode => frame({ name: 'item', children: [] });
    const root = frame({ children: [item(), item()] });
    const result = detectComponents(doc(root), { threshold: 2 });
    expect(result.stats.components).toBe(1);
    expect(result.document.components[0]?.name).toBe('Item');
  });

  it('replaces each occurrence with an INSTANCE referencing the component id', () => {
    const card = (): FrameNode => frame({ name: 'card', children: [text('A', 'title')] });
    const root = frame({ children: [card(), card(), card()] });
    const result = detectComponents(doc(root));
    const componentId = result.document.components[0]?.id;
    expect(componentId).toBe('card');
    const rootChildren = (result.document.root as FrameNode).children;
    expect(rootChildren).toHaveLength(3);
    for (const child of rootChildren) {
      expect(child.type).toBe('INSTANCE');
      expect((child as InstanceNode).componentId).toBe(componentId);
    }
  });

  it('emits per-instance text overrides keyed by master text-node id', () => {
    const card = (label: string): FrameNode =>
      frame({ name: 'card', children: [text(label, 'title')] });
    const root = frame({ children: [card('Fast'), card('Editable'), card('Open')] });
    const result = detectComponents(doc(root));
    const master = result.document.components[0]?.root as FrameNode;
    const masterTextId = (master.children[0] as { id: string }).id;
    const instances = (result.document.root as FrameNode).children as InstanceNode[];
    // First instance's text matches the master's text → no override.
    expect(instances[0]?.overrides).toBeUndefined();
    // The other two differ → overrides exist, keyed by master text id.
    expect(instances[1]?.overrides?.[masterTextId]?.characters).toBe('Editable');
    expect(instances[2]?.overrides?.[masterTextId]?.characters).toBe('Open');
  });

  it('falls back to ComponentN when the name is generic (e.g. "div")', () => {
    const generic = (): FrameNode => frame({ name: 'div-3', children: [text('x', 'a')] });
    const root = frame({ children: [generic(), generic(), generic()] });
    const result = detectComponents(doc(root));
    expect(result.document.components[0]?.name).toBe('Component1');
  });

  it('strips a leading dot from class-derived names (".card" → "Card")', () => {
    const card = (): FrameNode => frame({ name: '.card', children: [text('x', 'title')] });
    const root = frame({ children: [card(), card(), card()] });
    const result = detectComponents(doc(root));
    expect(result.document.components[0]?.name).toBe('Card');
  });

  it('does not promote nested occurrences inside an already-planned component', () => {
    // Three identical cards, each containing three identical buttons.
    // Cards (3 occurrences) become Card; buttons inside the master (3
    // occurrences within Card's own master) are NOT promoted in M6 since
    // they live inside an already-planned component.
    const button = (): FrameNode => frame({ name: 'btn', children: [text('Go', 'label')] });
    const card = (): FrameNode => frame({ name: 'card', children: [button(), button(), button()] });
    const root = frame({ children: [card(), card(), card()] });
    const result = detectComponents(doc(root));
    expect(result.stats.components).toBe(1);
    expect(result.document.components[0]?.name).toBe('Card');
  });

  it('keeps a stable, deterministic component id', () => {
    const card = (): FrameNode => frame({ name: 'card', children: [text('x', 't')] });
    const root1 = frame({ children: [card(), card(), card()] });
    const root2 = frame({ children: [card(), card(), card()] });
    const a = detectComponents(doc(root1));
    const b = detectComponents(doc(root2));
    expect(a.document.components[0]?.id).toBe(b.document.components[0]?.id);
  });
});

// ---------------------------------------------------------------------------
// End-to-end through convertHtml
// ---------------------------------------------------------------------------

describe('detection through convertHtml', () => {
  const html = `
    <html><body style="margin:0;width:600px;height:400px;">
      <div class="grid" style="display:flex;gap:16px;padding:16px;">
        <div class="card" style="width:120px;height:120px;background:#fff;border-radius:8px;">
          <h3 style="font-size:14px;color:#000;">Fast</h3>
        </div>
        <div class="card" style="width:120px;height:120px;background:#fff;border-radius:8px;">
          <h3 style="font-size:14px;color:#000;">Editable</h3>
        </div>
        <div class="card" style="width:120px;height:120px;background:#fff;border-radius:8px;">
          <h3 style="font-size:14px;color:#000;">Open</h3>
        </div>
      </div>
    </body></html>
  `;

  it('detects the card pattern and emits a Card component', () => {
    const { document, stats } = convertHtml(html, { name: 'cards' });
    expect(stats.components).toBe(1);
    expect(stats.instances).toBe(3);
    expect(document.components[0]?.name).toBe('Card');
  });

  it('passes componentThreshold = 4 → no detection (only 3 cards)', () => {
    const { stats } = convertHtml(html, { name: 'cards', componentThreshold: 4 });
    expect(stats.components).toBe(0);
  });

  it('emits per-instance text overrides for the differing card titles', () => {
    const { document } = convertHtml(html, { name: 'cards' });
    const grid = (document.root as FrameNode).children[0] as FrameNode;
    const instances = grid.children as InstanceNode[];
    // Three instances of the same component.
    expect(instances).toHaveLength(3);
    expect(new Set(instances.map((i) => i.componentId)).size).toBe(1);
    // The card whose title matches the master needs no override; the other
    // two carry character overrides for the differing text.
    const overrideCount = instances.filter((i) => i.overrides != null).length;
    expect(overrideCount).toBe(2);
  });
});
