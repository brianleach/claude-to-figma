/**
 * Structural hashing for IR subtrees.
 *
 * The hash is a deterministic JSON serialization of the fields that define
 * a component's *structure*, with content-style fields excluded so that
 * three cards with different titles hash identically. Excluded:
 *   - geometry.x / geometry.y (different positions are expected)
 *   - TEXT.characters         (text differences become overrides)
 *   - IMAGE.imageRef          (image content varies between instances)
 *   - IDs                     (auto-generated, not part of structure)
 *
 * Included:
 *   - node type
 *   - name (the walker's name comes from id-or-first-class, which is the
 *     CSS-spec-friendly proxy for "class signature" the kickstart asks for)
 *   - layout / fills / strokes / effects / cornerRadius
 *   - geometry width + height (size IS structural; position is not)
 *   - children, recursively, in order
 */

import type { IRNode } from '@claude-to-figma/ir';

/**
 * Hash one IR subtree. Returns a stable string suitable for grouping.
 * Two subtrees with the same hash are eligible to share a component.
 */
export function hashSubtree(node: IRNode): string {
  return JSON.stringify(structuralFingerprint(node));
}

function structuralFingerprint(node: IRNode): unknown {
  switch (node.type) {
    case 'FRAME':
      return {
        t: 'F',
        n: node.name,
        l: node.layout ?? null,
        f: node.fills,
        s: node.strokes,
        e: node.effects,
        cr: node.cornerRadius ?? null,
        // geometry intentionally excluded — content-driven sizing means
        // legitimate instances of the same component (e.g. nav items
        // wrapping varying-length labels) end up with different widths.
        // A "Card" 320×180 and a "Card" 280×140 with identical structure
        // and styles are the same component, just different sizes.
        ch: node.children.map(structuralFingerprint),
        // `svgSource` and data-URI snapshots are identity-defining. Four
        // `.e-card`s with structurally similar Frame trees but different
        // snapshot images are DIFFERENT components — merging them into
        // one master + text overrides silently paints card #1's snapshot
        // onto every instance. Including the raw svgSource in the hash
        // keeps each visually-unique card its own structural signature.
        v: node.svgSource ?? null,
      };
    case 'TEXT':
      return {
        t: 'T',
        ts: node.textStyle,
        f: node.fills,
        // name intentionally excluded — when an element has no id/class the
        // walker uses the first chars of the text as a fallback name, which
        // would leak content into the hash. textStyle does the structural
        // work for text. characters and geometry are also excluded for the
        // same content-vs-structure reason.
      };
    case 'IMAGE':
      return {
        t: 'I',
        sm: node.scaleMode,
        f: node.fills,
        cr: node.cornerRadius ?? null,
        // name and geometry intentionally excluded. But imageRef IS included
        // when it's a data-URI snapshot (`data-c2f="snapshot"` subtrees):
        // each snapshot is a unique asset and must not dedupe. External-URL
        // imageRefs (`<img src="…">`) still content-vary between instances
        // and stay out of the hash.
        r: node.imageRef.startsWith('data:') ? node.imageRef : null,
      };
    case 'VECTOR':
      return {
        t: 'V',
        p: node.path,
        f: node.fills,
        s: node.strokes,
        // name and geometry intentionally excluded
        v: node.svgSource ?? null,
      };
    case 'INSTANCE':
      return {
        t: 'X',
        n: node.name,
        c: node.componentId,
      };
  }
}
