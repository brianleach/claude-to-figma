# 0009 — Gradient paints as IR-level first-class paints

**Status:** accepted

## Context

Gap #10 in `docs/quality-gap-report.md` — gradient paints aren't
representable. The IR's `Paint` union is `SOLID | IMAGE`; CSS
`linear-gradient(…)` and `radial-gradient(…)` values silently fall
back to no-fill or to the default grey in `toFigmaPaint` on the
plugin side. This won't hurt the landing dogfood (which uses flat
colours) but will bite every other real Claude Design export — the
product uses gradients extensively in its default palette.

Figma's Plugin API natively supports `GRADIENT_LINEAR`,
`GRADIENT_RADIAL`, `GRADIENT_ANGULAR`, and `GRADIENT_DIAMOND`, each
with an `gradientTransform: Transform` (2×3 affine matrix mapping the
gradient's canonical unit line onto paint-local coordinates) and
`gradientStops: ColorStop[]`.

Two implementation shapes were considered.

**A. High-level IR (angle + stops).** Emit `{ type: 'GRADIENT_LINEAR',
angle: 180, stops: […] }` from the CLI; convert the angle to a 2×3
matrix inside the plugin. Splits the math between packages.

**B. Figma-shape IR (transform + stops).** CLI computes the 2×3
matrix at emit time; the IR mirrors Figma's shape. Plugin passes
through with only unit-sanity guards.

Option B was chosen. The matrix is the authoritative shape downstream
(Figma's ground truth), the conversion is deterministic, and keeping
it in one place lets us unit-test the matrix math directly. The plugin
becomes a pass-through, which matches the "the plugin is dumb" axiom
from ADR 0001.

## Decision

- **Schema.** `packages/ir/src/schema.ts` gains
  `LinearGradientPaintSchema` and `RadialGradientPaintSchema`, both
  discriminated on `type`, each carrying `gradientTransform: [[number,
  number, number], [number, number, number]]` and `gradientStops:
  { position: 0..1, color: Color }[]`. The `Paint` union becomes
  `SOLID | IMAGE | GRADIENT_LINEAR | GRADIENT_RADIAL`. Conic and
  diamond gradients are deferred — they have no first-class CSS
  equivalent we need to handle today.
- **CLI parser.** New `packages/cli/src/cascade/gradients.ts`
  exports `parseCssGradient(value): Paint | undefined`. Handles
  `linear-gradient([<angle>,]? <stops>)` and `radial-gradient(<stops>)`
  (shape / size / position are parsed and discarded — Figma's default
  ellipse-at-center approximates the common case well enough). The
  angle → matrix conversion lives here.
- **Wiring.** `readBackgroundFills` in `build-ir.ts` checks for a
  gradient value before falling back to `parseColor`. Multiple
  comma-separated gradients in a single `background:` value are left
  for later; today only a single top-level gradient is consumed.
- **Plugin.** `toFigmaPaint` in `packages/plugin/src/code.ts` grows
  two new cases — `GRADIENT_LINEAR` and `GRADIENT_RADIAL` — that
  pass `gradientTransform` and `gradientStops` through to Figma
  directly, after validating `stops.length >= 2`.

## Consequences

**+ Paints stay pluggable.** Adding angular / diamond gradients later
is purely additive: new schema entry, new parser, new plugin case.

**+ Plugin pass-through.** No math on the plugin side — matches the
"the plugin is dumb" design axiom. Easier to swap the plugin later
(e.g., Community distribution) without re-porting gradient math.

**+ Deterministic CLI output.** Every conversion of the same HTML
produces the same gradient matrix — unit tests assert byte-for-byte
equality, no "close enough" tolerances.

**− Matrix math in one place.** The CLI owns CSS-angle → Figma-matrix
translation; the plugin has no say. If Figma ever changes how
`gradientTransform` is interpreted, we touch CLI + bump a schema
version.

**− Shape / size / position of radial gradients is dropped.** CSS
`radial-gradient(circle at top right, …)` becomes the Figma default
(ellipse at centre, farthest-corner). Matches the 90% case; outliers
lose fidelity.

**− Color-stop positions default to even distribution.** A stop with
no explicit position gets `(n − 1) / (count − 1)` per spec —
standard, but CSS color-hint mid-points (`,50%,`) aren't modeled.

**− Multi-background with multiple gradients collapses to the first.**
CSS `background: linear-gradient(…), linear-gradient(…)` emits only
the first gradient in this milestone; layered gradient fills are
follow-up work (Figma frames can stack paints — the schema already
supports it).
