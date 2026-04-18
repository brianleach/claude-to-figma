# 0004 — What goes into the component-detection hash

**Status:** accepted

## Context

M6 promotes repeated subtrees to shared components by hashing each
subtree and grouping identical hashes. The hash recipe directly controls
which subtrees are considered "the same component" — and getting this
wrong leaves real-world repeats undetected (false negatives) or collapses
visually distinct things into one component (false positives).

Three patterns exposed the trade-off:

1. **Cards with different titles.** Six `<div class="card">`, each
   containing an `<h3>` with different text. Visually obvious that
   they're one component.
2. **Nav items with different labels.** Five `<div class="item"><span>…
   </span></div>` rows. The wrapping div is yoga-sized, so each frame's
   width depends on the inner text length.
3. **Big and small variants of the same component.** Designers regularly
   resize component instances — a card on the homepage is 320×180, the
   same card in a sidebar is 240×140. Same component.

If the hash includes geometry, all three above hash differently and
detection misses every repeat. If it excludes content but keeps
structural identity (children list, fills, layout, etc.), detection
catches them.

## Decision

The hash includes everything *structural* and excludes everything
*content-like* or *content-driven*.

**Included:**

- Node `type` (FRAME / TEXT / IMAGE / VECTOR / INSTANCE)
- FRAME `name` (the walker's name comes from id-or-first-class — the
  cheapest CSS-spec-friendly proxy for "class signature" the kickstart
  asks for)
- FRAME `layout` (LayoutProps)
- FRAME / TEXT / IMAGE / VECTOR `fills`, `strokes`, `effects`,
  `cornerRadius`
- TEXT `textStyle`
- IMAGE `scaleMode`
- VECTOR `path`
- FRAME `children`, recursively, in order

**Excluded:**

- Geometry (`x`, `y`, `width`, `height`) on every node type.
  - Position is parent-relative and obviously varies between instances.
  - Size varies between legitimate instances of the same component
    (resize, content-driven sizing).
- TEXT `characters` — the whole point of overrides is to let copy
  differ between instances.
- IMAGE `imageRef` — same reason, even though the IR's override schema
  doesn't yet carry per-instance image refs (M6 noted limitation).
- TEXT / IMAGE / VECTOR `name` — when an element has no id/class the
  walker uses the first 32 characters of the text as a fallback name,
  which would leak content differences into the hash.

## Consequences

**+ Catches the obvious cases.** Cards with different titles, nav items
with different labels, resized instances — all hash identically and
get promoted.

**+ Component definitions are content-free.** The master subtree has
the *first occurrence's* characters / image refs as defaults. Other
occurrences override only what differs.

**− False positives are possible.** Two structurally identical
components with semantically different roles (e.g. a "Card" and a
"Tile" with the same fills, layout, and inner structure) would
collapse into one if they shared a CSS class name. Mitigated by the
class-name-in-hash rule — different `class` → different `name` →
different hash.

**− Names lie a little.** When the master is the *first* occurrence,
its inner TEXT carries the first instance's copy. Reading the IR by
hand, you might think "Card.title = 'Fast'" is the canonical title;
it's actually a default that two other instances override.

**− Image refs are silently dropped.** Until the IR adds an `imageRef`
field to the override schema, all instances of an image-bearing
component show the master's image. Acceptable for M6 fixtures
(identical cards) but a known limitation for richer real-world
exports — flagged for the M7+ token / asset work.

## Reference

`packages/cli/src/detect/hash.ts` — the canonical recipe lives here.
Tests in `packages/cli/test/detect.test.ts` lock the rules in by
example.
