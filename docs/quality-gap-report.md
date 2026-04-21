# Quality gap report

Diagnosis pass for the M1–M8 output. Goal: figure out why the generated
Figma file isn't production-usable by designers yet, so we can scope the
post-M8 quality milestones (M9+) from concrete evidence instead of hunches.

**Method.** The dogfood page at `examples/landing/` is the oracle. Source
HTML (`source/index.html`, 1336 lines, inline `<style>`), generated IR
(`claude-to-figma.ir.json`, 10665 lines), report (`claude-to-figma.report.json`),
and browser screenshot (`screenshots/browser.png`) were cross-read against
each CLI subsystem (`packages/cli/src/{cascade,layout,extract,detect}`) and
the IR schema (`packages/ir/src/`). Known limitations were subtracted from
the diff so this report surfaces what's actually new.

**Scope.** This is a diagnosis, not a fix plan. Milestone assignment at the
bottom is a recommendation; actual scoping happens when we cut the branch.

---

## TL;DR — top five, in priority order

1. **CSS Grid is silently dropped.** Every multi-column section on the page
   uses `display: grid` and falls back to block stacking in the IR. This is
   the single biggest source of "looks wrong" on the landing render.
2. **Borders and shadows are never extracted at all.** `build-ir.ts:208-209`
   hardcodes `strokes: []` and `effects: []`. The extraction code doesn't
   exist yet — borders affect yoga geometry only, then disappear.
3. **Text measurement is a 0.55-char heuristic.** Not visible in IR
   contents but load-bearing for every downstream spacing decision. The
   hero-heading overflow and the "labels bleed outside containers" bugs
   both trace back here and to #1.
4. **Negative em letter-spacing is lost on every headline.** `letter-spacing:
   -0.025em` — used on 10 headlines — resolves to 0 because em units aren't
   supported. Subtle per-headline but cumulatively it's a typography
   fingerprint nobody has.
5. **Multi-path SVG icons emit empty vectors.** 3 of 4 SVG icons on the
   page became empty paths (matches the 3 `--report` warnings). Every icon
   in the feature cards is a missing asset.

Everything else in the table below is real but lower-impact or already
documented.

---

## Full gap table

Ordered by visual impact (5 = obvious at a glance, 1 = subtle).

| # | Gap | Evidence | Subsystem | Severity | Known? | Impact |
|---|-----|----------|-----------|----------|--------|--------|
| 1 | CSS Grid silently dropped; all grid sections fall back to block stack | `.hero-grid` (src:92), `.steps` (445), `.editable-grid` (499), `.pipeline` (704), `.get-started-grid` (777) all use `display: grid; grid-template-columns: …`. IR has `layout: null` on each. | `cli/layout/auto-layout.ts` — maps `display: flex` only | fidelity | § 7 | 5 |
| 2 | Borders never extracted; `strokes` array hardcoded empty | 77 `border:` declarations in source. `build-ir.ts:208` literally emits `strokes: []`; same at `:297` for text. Border width still influences yoga geometry, so layout is close — but the visible outline is gone. | `cli/build-ir.ts`, no module at `cli/extract/strokes` | fidelity | § 14 | 4 |
| 3 | Shadows / filters never extracted; `effects` array hardcoded empty | `box-shadow: var(--shadow)` on `.figma-card` (171) and `.get-started-grid` (793). `filter: saturate(0.35)` on `.hero-visual` (180). IR has `effects: []` everywhere. | `cli/build-ir.ts`, no module at `cli/extract/effects` | fidelity | § 14 | 4 |
| 4 | Heuristic text measurement drifts on Fraunces / italic headlines | `0.55 × fontSize × chars` (layout module) is tuned for Inter. Landing uses Fraunces with negative tracking for display copy — geometry drift compounds upstream of every container size. Not directly visible in IR; inferred from the documented hero-overflow bug. | `cli/layout/measure.ts` | fidelity | § 5 | 4 |
| 5 | Negative em letter-spacing silently zeroed | `letter-spacing: -0.025em` on `.hero-title` (119), `.step h3` (477), all section titles — ~10 sites. IR shows `letterSpacing: { unit: "PIXELS", value: 0 }`. | `cli/style.ts parseLetterSpacing()` | fidelity | § 4 | 3 |
| 6 | Multi-path SVGs emit empty vectors | 4 feature-card icons use multi-path `<svg>`; first-path extractor finds no usable `d` on 3 of them (report warnings confirm). Single-path SVG logic at `build-ir.ts:284` walks only the first `<path>` it sees. | `cli/build-ir.ts collectFirstPath()` | fidelity | § 16 | 3 |
| 7 | `aspect-ratio` and `text-wrap: balance` unrecognised | `.hero-visual` uses `aspect-ratio: 1 / 0.92` (165); `.hero-title` uses `text-wrap: balance` (123) for line-break control. Both silently ignored. Combined with #4 this is what breaks the hero heading wrap. | `cli/cascade/parse.ts` — property whitelist | fidelity | **new** | 3 |
| 8 | `max-width` + `margin: 0 auto` centering not preserved | `.wrap` uses `max-width: 1280px; margin: 0 auto`. Width lands via yoga but the centering is a CSS semantic the IR geometry can't express; frames render full-width instead of centered. | `cli/build-ir.ts` (margin dropped after yoga) and `ir/schema` (no constraints field) | fidelity | **new** | 3 |
| 9 | Pseudo-class rules silently don't apply | `:hover` on `.nav-links a` (75), `.btn` (156), `.foot-right a` (888); `:first-of-type` (415); `:last-child` (456). All recognised by the specificity scorer but never match. | `cli/cascade/selector.ts` | editability | § 1 | 2 |
| 10 | No gradient paint support | Source doesn't rely on gradients, but the Claude Design design system frequently does. IR schema supports SOLID fills only — linear/radial would need a schema addition. Listed here because it'll bite the next real fixture. | `ir/schema` + `cli/extract/paints` | fidelity | **new** | 2 |
| 11 | Borders left intact on yoga pass but `border-color` / `border-style` always discarded even if extraction existed | Related to #2 — even when we wire up stroke extraction we need full-shorthand expansion for `border: 1px solid var(--rule)`. Today the cascade engine reads `border-width` only via the 3-component split in `style.ts`; color and style longhands are not stored on the node. | `cli/cascade/parse.ts` (shorthand expansion) | fidelity | § 2 | 2 |
| 12 | Shadow shorthand (`box-shadow: 0 2px 8px rgba(...)`) has no parser | Same pattern as #11 — even once `effects` extraction exists, we need a parser for the `<offset-x> <offset-y> <blur> <spread> <color>` grammar. Multi-value shadows (`box-shadow: a, b`) multiply this. | `cli/cascade/parse.ts` (new shorthand) | fidelity | § 2 (transitive) | 2 |
| 13 | Layer names are DOM-ish, not designer-ish | IR names come from `nameFor(el)` in `build-ir.ts` — tag + class slice. A designer expects `Hero`, `Features / Card 1 / Title`, `Footer`. Currently they open the file and see `section.hero`, `div.wrap`, `h2`. | `cli/build-ir.ts nameFor()` | polish | **new** | 2 |
| 14 | No `<img>` overrides on component instances | Not triggered by this page (icons are inline SVG), but the feature-card grid *would* use different images per card on a real site, and M6 detection would then collapse them with master-image leakage. | `ir/schema INSTANCE.overrides` (add `imageHash`) + `cli/detect` | editability | § 10 | — |
| 15 | Token names are frequency-ranked, not role-aware | `color/primary` today = most-used-color. For this page the most-used color is the cream body background (used on every frame), so the visible "primary" in Figma styles is the background, not the CTA orange. Fix: walk CTA-like nodes and weight accordingly. | `cli/extract/paints naming.ts` | polish | § 12 | 2 |
| 16 | Text-style bucket collision drops to ugly fallback | `heading/md` and `text/18-bold` can both appear for distinct headlines at the same size (M7 ADR 0005). On this page the feature-card titles and the "Three steps" sub-headings land in different buckets — check for this. | `cli/extract/texts naming.ts` | polish | § 13 | 1 |
| 17 | Variant detection never attempted | Nav items + the "format comparison" table rows are candidates for variants (active/inactive, available/unavailable formats). Today they become either identical instances or separate components. | `cli/detect` (new pass) | editability | § 11 | 1 |

---

## What the table doesn't capture

**Plugin-side rendering bugs.** I can't open the `.fig` file from here, so
anything that's in the IR correctly but the plugin draws wrong won't show
up above. The landing README names three symptoms — section labels
bleeding outside containers, hero heading overflowing, spacing/typography
drift — and my best attribution is:

- Label bleed → gap #1 (grid fallback collapses 2-col sections into block stacks)
- Hero overflow → gap #7 (no `text-wrap: balance`) + gap #4 (heuristic text measure) + gap #8 (max-width centering)
- Spacing/typography drift → gap #4 (measurement) + gap #5 (letter-spacing)

None of these require plugin work; they're all upstream in the CLI. Worth
confirming once M9 lands by re-running the dogfood and checking whether
the three symptoms disappear.

**Text shaping beyond width.** Ligatures, optical sizing (Fraunces has
`opsz`!), variable-font axes — the IR doesn't model any of this. Out of
scope for a fidelity pass; worth noting for a later typography milestone.

---

## Milestone assignment (proposed)

**M9 — Visual fidelity.** Gaps 1–8, 10–12. These are the "looks wrong"
bugs. Internal order within M9:

1. Real text measurement (#4) — load-bearing, unblocks the rest.
2. Borders + shadows + gradients (#2, #3, #10, #11, #12) as one extraction
   milestone — they share the "new extractor module + schema touch-up +
   shorthand parser" pattern.
3. Grid → nested auto-layout (#1) — largest discrete feature.
4. Longtail CSS: em units (#5), `max-width` centering (#8),
   `aspect-ratio` + `text-wrap` (#7).
5. Multi-path SVG (#6) — small, can slip in anywhere.

**M10 — Editability & semantics.** Gaps 9, 13–17. The "is this usable
to a designer" pass. Nested-component detection (from the original plan)
lands here too.

**M11 — Visual regression lock-in.** Harness that pixel-diffs each
fixture's Chrome render vs. its Figma render. Prevents M9/M10 wins
regressing. Scope unchanged from the earlier proposal.

---

## Confidence and unknowns

- **High confidence**: gaps 1, 2, 3, 5, 6, 9 — evidence is in the source
  and IR; each is a direct code path we can point at.
- **Medium confidence**: gaps 4, 7, 8 — inferred from the documented
  hero-overflow bug + source-vs-IR diff. Want a side-by-side render
  comparison to confirm attribution.
- **Lower confidence**: gap 13 and the M10 items in general — these are
  UX judgements; need designer sign-off on what "good enough" looks like
  before we scope.

One open question for the M9 branch kickoff: do we want to push for
schema changes (gradient paints, shadow effects, image overrides) in one
go, or stage them per-gap? A single schema bump is cleaner for downstream
consumers; staged is safer for rollback. Default to one bump unless a
specific gap forces an earlier break.
