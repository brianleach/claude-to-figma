# 0011 — Shared effect styles

**Status:** accepted

## Context

Through M10 the IR carried `box-shadow` / `filter: blur()` as inline
`effects: [...]` arrays on every FRAME that rendered with them.
Identical values were duplicated node-by-node. On the landing dogfood,
three `.figma-card` frames each carried the same two-layer shadow
stack. Figma supports shared EffectStyles (accessible from the Local
Styles panel, editable once, linked everywhere) via `effectStyleId` —
we just weren't emitting them.

Gap #14 in `LIMITATIONS.md` called this out explicitly. The usability
cost is proportional to how often a shadow repeats: a designer who
wants to nudge the card shadow's y-offset by 1px shouldn't have to
touch every instance. Same reasoning we applied to paints (ADR 0010)
and text (ADR 0005 + refinement in commit `d213ac2`).

## Decision

Add a third bucket to the token extractor. After paint and text
extraction, walk the tree again and:

1. Collect every unique `Effect[]` stack (stable-keyed by a
   rounded-to-4-decimals JSON of each effect — the same dedup strategy
   paint/text extraction uses).
2. Name each stack by its **dominant effect family and largest radius**:
   - Pure DROP/INNER_SHADOW stacks → `shadow/{sm,md,lg,xl}`.
   - Pure LAYER_BLUR stacks → `blur/{sm,md,lg,xl}`.
   - Pure BACKGROUND_BLUR stacks → `backdrop-blur/{sm,md,lg,xl}`.
   - Mixed stacks → `fx/{sm,md,lg,xl}`.

   Buckets: sm ≤ 4px, md ≤ 12px, lg ≤ 24px, xl > 24px. Thresholds picked
   to match common design-system token scales — Tailwind's `shadow-sm/md/lg/xl`,
   Material's elevation levels, Radix's 1–5 scale all land in these
   buckets for typical shadow radii.
3. On collision within a bucket, suffix the second, third, … with
   `-2`, `-3`, … (again mirroring text-styles' collision rule).

### Why a single name, not a weight-suffix variant like text

Text-style collisions produce `heading/md-bold` because font weight is
a universal axis every designer reads as a variant. Shadow stacks
aren't decomposable the same way — two distinct shadow values at the
same size aren't variants of each other, they're different tokens.
Numeric suffixes keep the registry dumb; a designer can rename them
after import if semantic labels matter.

### Why order-sensitive keys

CSS `box-shadow: a, b` paints `b` *underneath* `a` (the first shadow is
on top). Reordering the list is a visible change, so the dedup key
treats `[a, b]` and `[b, a]` as distinct. Consequence: two pages that
use "the same shadow" but list it in different stack orders end up
with separate `shadow/*` styles. Acceptable — CSS authors rarely vary
order accidentally, and the numeric-suffix collision rule keeps names
sane even if it happens.

### Stroke styles reference the existing PaintStyle registry

A stroke is paint + weight + align. Figma's shared-style system covers
the paint (via PaintStyle + `strokeStyleId`, which is the same
PaintStyle type as `fillStyleId`) but does NOT share weight or align —
those always live on the node. Earlier drafts of this ADR deferred
stroke sharing on the grounds that partial sharing is confusing.
Reversed after running numbers on the landing fixture: 73 frames with
strokes, 6 unique paint colours, top repeat at 30 nodes — leaving every
stroke inline costs a designer 73 edit sites for 6 logical tokens.

Decision: `FrameNode` / `VectorNode` gain a `strokeStyleId` that points
into the existing `styles.paints` registry (same naming, same bucket
rules as ADR 0010 — stroke paints already land in `border/*`,
`ink/*`, `brand/*` by role). The `Stroke` object still carries the
weight + align inline, and the plugin sets `frame.strokeStyleId =
paintStyle.id` whenever the IR provides one. No separate "stroke style"
type — weight is intrinsically per-node and Figma's API enforces that.

## Consequences

- IR schema gains `EffectStyleDef`, `StylesRegistry.effects`, and
  `FrameNode.effectStyleId`. All additive — existing IR files without
  the field parse unchanged because `effects` defaults to `[]` and
  `effectStyleId` is optional.
- Plugin registers effect styles in `registerEffectStyle()` and applies
  them on frames via `frame.effectStyleId = style.id` whenever the IR
  carries a reference.
- Landing dogfood: 3 inline stacks collapsed to 1 `shadow/xl` style.
- Open question: shared effect styles on VECTOR nodes. Figma supports
  `effectStyleId` on vectors too, but the current IR's VectorNode has
  no `effects` field. If a future fixture renders SVG icons with
  shadows/glows, extend VectorNode's shape and run them through the
  same extractor.
