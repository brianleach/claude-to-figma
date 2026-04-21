# 0008 — `display: grid` maps to flex-wrap, not to synthesized row frames

**Status:** accepted

## Context

Gap #1 in `docs/quality-gap-report.md` — CSS Grid silently dropped —
is the biggest remaining visual-fidelity bug on the landing dogfood.
Five sections (`.hero-grid`, `.steps`, `.editable-grid`, `.pipeline`,
`.get-started-grid`) use `display: grid; grid-template-columns: …`
and currently fall back to block-stack rendering because the yoga
mapper only recognises `display: flex` / `inline-flex`.

Two mappings were considered.

**A. Treat a grid container as flex-wrap.** Parse the track count N
from `grid-template-columns`, configure the yoga node as a
`flex-direction: row; flex-wrap: wrap` container with the requested
column-gap and row-gap, and set each child's `flex-basis` to
`(100% - (N-1) × col-gap) / N` with `flex-grow: 1`. The auto-layout
mapper does the parallel transformation for Figma
(`mode: HORIZONTAL`, `wrap: WRAP`, `itemSpacing: col-gap`,
`counterAxisSpacing: row-gap`). IR tree shape is untouched.

**B. Synthesize explicit row frames.** At IR build time, group a
grid's children into rows of N, wrap each batch in an intermediate
`flex-direction: row` frame, stack them in a `flex-direction: column`
parent. Designer-friendly: each row is an editable container.

Option B was rejected because it changes the IR tree shape. Component
detection (M6) hashes subtrees; inserting a row frame between a grid
and its `Card` children would differ from a `Card` that isn't inside
a grid, breaking the hash match. Token extraction (M7) is less
sensitive, but the blast radius is still larger than the M9 fidelity
milestone wants to take on. Option A ships the geometry + editability
win for the 90% case (`repeat(N, 1fr)`, uniform-width cells) with no
effect on M6/M7.

## Decision

Extend the flex pipeline to accept `display: grid` as a flex-wrap
container.

- **Cascade.** No change. `grid-template-columns`, `column-gap`,
  `row-gap`, `gap` already survive the cascade as opaque strings;
  yoga and the auto-layout mapper parse them directly.
- **`style.ts`.** New `parseGridTrackCount(value)` — handles
  `repeat(N, …)`, a space-separated track list (`1fr 1fr 1fr`,
  `200px 200px`, `1fr auto 1fr`), and returns a track count only.
  Per-track sizing is ignored; every track is treated as `1fr`.
- **`layout/yoga.ts`.** When `display: grid` is seen, the container
  is configured exactly like `display: flex; flex-wrap: wrap;
  flex-direction: row;`. Children that don't already have an explicit
  `width` / `flex-basis` get `flex-basis: (100% - (N-1) × col-gap) / N`
  and `flex-grow: 1` so each cell fills one track.
- **`layout/auto-layout.ts`.** `mapFlexContainer` extends its gate to
  include `display: grid`; emits `{ mode: 'HORIZONTAL', wrap: 'WRAP' }`
  with `itemSpacing` from `column-gap` and `counterAxisSpacing` from
  `row-gap`. Child decoration (layoutGrow, alignSelf, etc.) is
  unchanged from the flex path.

## Consequences

**+ Every grid on the landing dogfood now produces geometry + real
auto-layout.** The 2×2 `.editable-grid`, the 3-up `.steps` and
`.pipeline`, and the 2-up hero/get-started grids all render with
correct column geometry and wrap behaviour. Gap #1 is closed for the
common case.

**+ IR tree shape is preserved.** Component detection, token
extraction, and the existing yoga/auto-layout test suite are all
unaffected by the grid path — no risk of regressing M6/M7.

**+ Reuses battle-tested code.** Flex-wrap geometry and the Figma
auto-layout mapping were shipped in M4/M5 with 43 tests between them.
The grid path is a thin adapter on top of that.

**− Track sizing flattens to equal widths.** `grid-template-columns:
1fr 2fr 1fr` collapses to three equal tracks. `grid-template-columns:
200px 1fr` becomes two equal `1fr` tracks. Most real exports use
`repeat(N, 1fr)` so the common case is preserved; weighted fr values
and mixed fixed/fluid tracks lose fidelity.

**− Cell spans are not supported.** `grid-column: span 2`,
`grid-row: span 2`, and `grid-template-areas` placements have no
equivalent in flex-wrap. Cells that rely on spans will wrap into the
next track instead of spanning. Emitted as warnings when detected;
fixing this would require the Option-B tree reshape or a custom
grid layouter.

**− No `grid-auto-flow: dense` packing.** Items flow row-major in
source order; implicit placement (filling gaps) isn't modeled. Again:
rare on real pages, but documented.

**− `grid-template-rows` is informational-only.** Row heights emerge
from wrap behaviour, not from the declared `grid-template-rows`.
Pages that set a tall first row and short subsequent rows don't get
that shape.
