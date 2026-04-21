# 0006 — Text measurement via headless Chromium during `--hydrate`

**Status:** accepted

## Context

M4 shipped text measurement as a heuristic: `width = chars × fontSize × 0.55`,
line-height defaults to `fontSize × 1.2` when CSS says `auto`. Captured in
`packages/cli/src/layout/measure.ts`. Tuned for Inter; drifts visibly on
Fraunces, italic display copy, condensed/expanded weights, and any font with
aggressive kerning.

The M9 fidelity pass revealed (see `docs/quality-gap-report.md`) that
measurement drift is the upstream cause of several visible landing-page
bugs: hero heading overflow, "section labels bleed outside containers",
general spacing skew inside auto-layout frames. Downstream of measurement
we also miss `text-wrap: balance` (gap #7) — we have no way to know where
real line breaks fall.

Two real alternatives were considered.

**A. Measure in Playwright during `--hydrate`.** We already boot headless
Chromium to render runtime-hydrated pages. Add a second pass after the
page settles: stamp each text-leaf element with a data attribute, read
`getBoundingClientRect()` and `Range.getClientRects()` from
`page.evaluate`, strip the attribute, return the measurements alongside
the rendered HTML.

**B. Offline shaping with `opentype.js` / `fontkit` (plus `harfbuzzjs`
for real shaping).** Parse font files, read glyph advance tables, apply
letter-spacing, implement line-break logic. Fully offline, no browser
dependency.

Option A outsources text shaping to the real shaper (Chromium/Skia) for
free. Option B requires us to either fetch fonts from Google's CDN at
convert time (network + licensing), probe system fonts (OS-specific), or
bundle a default set (bloat + wrong fonts for Claude Design exports,
which reference Google Fonts by URL and ship no font files). Even with
font acquisition solved, Option B needs a real shaping engine for
ligatures, kerning, contextual alternates, variable-font axis
interpolation (Fraunces uses `opsz` and `wght`), and CSS
`font-feature-settings` — all of which `opentype.js` alone doesn't
provide. `harfbuzzjs` covers most of that but adds several megabytes of
WASM and a steep API surface.

## Decision

Use **Option A**. `packages/cli/src/hydrate.ts` extends its return type
to include a `textMeasurements: Map<string, { width, height, lineCount }>`
keyed by a `data-c2f-mid` attribute stamped and stripped inside
`page.evaluate`. `packages/cli/src/build-ir.ts` consults the map for every
text leaf; the existing heuristic in `layout/measure.ts` remains as the
fallback path for non-hydrated conversions.

Measurement runs only on text-leaf elements — elements whose only
content is a single text node. Interior frames continue to be sized by
yoga based on their children. Measuring both would create ambiguity when
parent and child disagree.

The `--hydrate` flag is not renamed. A `--verbose` log line reports
measurement coverage (e.g. `measured 47 text nodes via Chromium`) so
users can tell which path ran.

Static HTML (no `--hydrate`) stays on the heuristic. `LIMITATIONS.md`
§5 is updated to reflect the split.

## Consequences

**+ Correctness comes from a real text shaper.** Ligatures, kerning,
variable-font axes, `font-feature-settings`, `letter-spacing`,
`text-transform`, bidi — all handled by Chromium/Skia, not
reimplemented.

**+ Line-wrap positions are known.** `Range.getClientRects()` returns
per-line rects, which gives us `text-wrap: balance` and any
max-width-driven wrapping for free (closes part of gap #7 in the gap
report).

**+ No font acquisition problem.** Chromium resolves fonts using the
host OS the same way a designer's browser would. If Fraunces isn't
installed, Chromium substitutes a fallback and we measure *that* —
which is also what the eventual Figma render will show (the plugin
can't install fonts either, LIMITATIONS §17). Measurement and final
render agree.

**+ Ships in a week, not a month.** Extension of an existing module,
not a new shaper.

**− Non-hydrated paths keep the heuristic.** Static HTML fixtures and
any `--hydrate=false` invocation fall back to `0.55 × fontSize × chars`
with its known drift. Documented in LIMITATIONS; tolerable because the
real traffic (Claude Design runtime-hydrated exports) always runs with
`--hydrate`.

**− Measurement is tied to the hydration viewport.** Text is measured
at whatever `--viewport` was passed (default 1440×900). Multi-breakpoint
measurement would require repeated passes; out of scope for M9.

**− The `--hydrate` flag now has two jobs** — render JS *and* measure
text. Documented in the flag help and the verbose log message. Renaming
(`--render-with-browser`) was considered and rejected to avoid a
breaking CLI change this late.

**− If the user overrides fonts via `--font-fallback Inter` at the IR
level, the Figma render no longer matches the measurements** (which
were taken at the original font in Chromium). This was already a
lossy path; we add a verbose warning rather than tracking the override
back through measurement.
