# 0007 — Shorthand expansion lives in a cascade-time registry

**Status:** accepted

## Context

M9's fidelity pass needs to extract strokes and effects (gaps #2 and #3
in `docs/quality-gap-report.md`). Both depend on CSS shorthands that
today's cascade engine doesn't touch:

- `border: 1px solid var(--rule)` — 77 uses on the dogfood landing
  page; the cascade stores it as an opaque `border` declaration and
  never splits it into `border-*-width` / `-style` / `-color`.
- `box-shadow: 0 1px 0 rgba(...), 0 12px 40px -18px rgba(...)` — the
  same story: stored verbatim, never parsed.
- `filter: saturate(0.35)` and `backdrop-filter: blur(12px)` — Figma
  only maps the blur variants; everything else is an unsupported effect.

LIMITATIONS.md §2 already flags the broader problem: no CSS shorthand
expansion beyond `padding`/`margin`. That flag will bite `font:`,
`background:`, `transition:`, and several others the next time a real
export trips them.

Three approaches were considered.

**A. Property-specific parsers wired directly into `extract/`.** Each
extractor reads the raw shorthand string from the cascade and produces
its own `Stroke[]` / `Effect[]`. Shortest path.

**B. Full shorthand expansion via `postcss-shorthand-expand` or
similar.** Normalise every shorthand into longhands at cascade time.
Unblocks all of LIMITATIONS §2 at once.

**C. Narrow expansion through a shared registry.** A new
`cascade/shorthand.ts` hosts a `Record<string, Expander>` from
shorthand property name to a function that returns `Record<longhand,
string>`. Applied once per element after cascade resolution. Initial
registrations: `border:` + per-side `border-top|right|bottom|left:`,
`box-shadow:`, `filter:`, `backdrop-filter:`. Everything else stays
opaque until explicitly registered.

Option B was rejected because it turns a 2–3 day task into 1–2 weeks,
adds a library we haven't vetted, and is easy to regress the existing
`padding`/`margin` yoga-side expansion. Option A was rejected because
the next shorthand ask (`font:`, `background:`) would reinvent the
same wiring in a second place.

## Decision

Use option C. A new `packages/cli/src/cascade/shorthand.ts` exports
`expandShorthands(style: ComputedStyle): void` that mutates the
computed-style map in place — removing the shorthand key and inserting
its longhands. The cascade engine calls it once per element, after
`!important` resolution and before consumers read the map.

Initial registrations:

- `border:` — splits into `border-{top|right|bottom|left}-{width|style|color}`.
  Grammar: `[<width>] [<style>] [<color>]` in any order; missing parts
  fall back to defaults (`medium` / `none` / `currentColor`), matching
  the CSS spec.
- `border-top:` / `-right:` / `-bottom:` / `-left:` — the per-side
  variant, same grammar, only writes the three longhands for that edge.
- `box-shadow:` — split on top-level commas (respecting `rgba()` parens),
  parse each entry into a typed object, and store the entire list as a
  JSON-serialised string under `__parsed-box-shadow`. The JSON stash is
  an internal marker (double-underscore prefix) so nothing downstream
  mistakes it for a CSS property.
- `filter:` / `backdrop-filter:` — parse the function-call list. Only
  `blur(<length>)` survives; the rest are dropped after a warning is
  pushed to the cascade context.

Extractors (`extract/strokes.ts`, `extract/effects.ts`) consume the
post-expansion longhands. They never see the shorthand form, so each
new extractor is a straightforward reader of normalised longhands.

## Consequences

**+ Single home for shorthand parsing.** When the next shorthand
limitation comes up (`font:`, `background:`) adding it is one new row
plus a test — no wiring into extractors, no change to the cascade's
traversal.

**+ Extractors stay simple.** `strokes.ts` reads four triples of
longhands and builds a `Stroke`. It never touches `border:` shorthand
syntax, which keeps it easy to test and to extend with per-side stroke
fidelity later.

**+ `var()` resolution happens upstream.** Shorthand expansion runs
after the cascade has resolved custom properties, so an expander sees
`1px solid #c8b9a3` rather than `1px solid var(--rule)`. No special
handling inside the expander.

**+ Leaves existing `padding`/`margin` expansion alone.** Those run
inside `layout/yoga.ts` and are load-bearing for M4/M5 tests. Moving
them into the registry is a follow-up, not an M9 requirement.

**− `box-shadow:` returns structured data through a stringly-typed
map.** The registry stashes the parsed shadow list under a
`__parsed-box-shadow` key as JSON. Ugly but keeps the cascade's
`Map<string, string>` contract intact. Consumers `JSON.parse` on read.
An alternative (widen the map's value type to `string | ParsedValue`)
was rejected as a larger change with wider blast radius than the gain.

**− Per-side stroke geometry still collapses to a single `Stroke`.**
CSS allows each border edge to have its own width / color / style;
Figma's stroke model has one paint + weight per frame (with
INSIDE/OUTSIDE/CENTER alignment). When the four edges match, we emit
one `Stroke`; when they differ, we emit the longhand-top triple and
warn. Per-edge stroke fidelity would need a schema extension and is
deferred.

**− `filter:` / `backdrop-filter:` drop anything but `blur(...)`.**
Saturation, contrast, brightness, hue-rotate, invert, grayscale, and
drop-shadow-as-filter have no Figma equivalent and are silently
unrepresentable. Drops are logged as warnings so the user can see
which visual treatments didn't make it across.
