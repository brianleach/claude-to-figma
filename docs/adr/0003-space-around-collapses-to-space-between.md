# 0003 — `space-around` / `space-evenly` collapse to `SPACE_BETWEEN`

**Status:** accepted

## Context

CSS `justify-content` has five distribution values:

- `flex-start`, `center`, `flex-end` — bunched at the start, middle, or
  end of the main axis.
- `space-between` — first child at start, last child at end, equal gaps
  between them.
- `space-around` — half-gap before first child, half-gap after last,
  equal gaps between.
- `space-evenly` — full gaps everywhere, including before first and
  after last.

Figma's `primaryAxisAlignItems` only has the first four. There is no
`SPACE_AROUND` or `SPACE_EVENLY` primitive in the Plugin API.

The M5 mapper has to pick a representation for the two CSS values that
have no Figma counterpart.

## Decision

`justify-content: space-around` and `justify-content: space-evenly` both
map to `primaryAxisAlignItems: 'SPACE_BETWEEN'`.

## Consequences

**+ Visual fidelity at first paint.** Yoga still computes the geometry
from the original CSS, so the first render places children at the
exact CSS positions. The auto-layout `SPACE_BETWEEN` is metadata for
the *editing experience* in Figma, not a reflow instruction.

**+ Closest-equivalent edit behavior.** If a designer drags a child or
adds a sibling, `SPACE_BETWEEN` redistributes the gap — same family of
behavior as `space-around`/`space-evenly`, just without the leading
and trailing half-gap.

**− Edits diverge from the source.** A designer who adds a child to a
former `space-around` row gets a `SPACE_BETWEEN` redistribution. The
two visually differ once edited. Acceptable for M5 — fidelity vs
editability is the project's stated trade-off (see ADR 0001), and
preserving the literal CSS distribution would require Figma APIs we
don't have.

**− Round-trip is lossy.** If we ever build "Figma → IR → HTML", we
can't recover the original CSS keyword. We'd need to add an IR field
that records the original value alongside the Figma-mapped one.
