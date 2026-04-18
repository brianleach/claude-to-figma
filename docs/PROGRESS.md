# Progress

Single source of truth for where the build is. Update this file as part of
every milestone's final commit (or any mid-milestone change that moves a
gate from ❌ → ✅). Anyone — human, local Claude, web Claude — should be
able to read this file and know exactly what to do next.

The authoritative spec is [`KICKSTART.md`](./KICKSTART.md). This file tracks
execution against that spec.

---

## Current status

**Active milestone:** M7 (not started)
**Last tag:** `m6`
**Next action:** extract unique paint and text combinations across the IR
into named entries in `styles.paints` / `styles.texts`. Naming heuristic
should classify by frequency / size (`color/primary`, `color/surface`;
`heading/lg`, `body/md`, ...). Plugin already creates Figma PaintStyles
+ TextStyles from the registry; this milestone wires the CLI side. See
M7 section below.

## Working branch

`main` is the canonical branch. From M2 onward we follow the standard
per-milestone flow from `KICKSTART.md`:

```
git checkout main && git pull
git checkout -b m{N}-{short-name}
# work + commit
# verify all gates
# update README.md — milestones table, status line, "What ships today",
# CLI/plugin usage, architecture diagram if the stack changed
git checkout main && git merge --squash m{N}-{short-name}
git commit -m "feat(m{N}): {summary}"
git tag -a m{N} -m "M{N}: {description}"
git push && git push --tags
git branch -D m{N}-{short-name}
```

**Standing checklist before squash-merge:** PROGRESS.md updated (status
line, milestone row, gate list, log entry) AND `README.md` updated (move
milestone from "next/pending" to "✅ done", refresh "What ships today",
update Try-it commands or troubleshooting if user-facing surface changed,
update architecture diagram if dependencies changed).

The bootstrap branch `claude/claude-to-figma-build-zTq1Q` is abandoned
as of 2026-04-18. Do not push to it. Do not branch from it. It remains
on the remote for archive only.

## Milestone overview

| #   | Status | Tag | Verified by | Notes                                                       |
| --- | ------ | --- | ----------- | ----------------------------------------------------------- |
| M1  | ✅ done | `m1` | bleach @ 2026-04-18 | IR + plugin + sample. Override bug found and fixed during verify. |
| M2  | ✅ done | `m2` | bleach @ 2026-04-18 | CLI scaffold + parse5, inline styles only. 3 fixtures, 30 tests total. |
| M3  | ✅ done | `m3` | bleach @ 2026-04-18 | Cascade engine: external CSS, specificity, !important, inheritance, var(). Postcss instead of lightningcss (deviation). |
| M4  | ✅ done | `m4` | bleach @ 2026-04-18 | yoga-layout 3.2.1 integration. Block + flex layout, 1–4 value padding/margin shorthands, heuristic text measurement. |
| M5  | ✅ done | `m5` | bleach @ 2026-04-18 | Flex → Figma auto-layout mapping. layout + childLayout fields on flex frames; per-axis spacing, padding shorthand, justify/align mapping, wrap, layoutGrow, ABSOLUTE positioning. |
| M6  | ✅ done | `m6` | bleach @ 2026-04-18 | Component detection: hash → group → INSTANCE rewrite with text overrides. `--component-threshold` flag, default 3. |
| M7  | ⬜ not started | — | —           | Token extraction (paint + text styles).                     |
| M8  | ⬜ not started | — | —           | Real-world harness + docs + LIMITATIONS.md.                 |

Legend: ✅ done · 🟢 in progress · 🟡 awaiting verification · ⬜ not started · ❌ blocked

---

## M1 — IR + Plugin round-trip

**Branch:** `claude/claude-to-figma-build-zTq1Q` (commits `2367d31..ffbfbe7`)

### Standard gates

- [x] G-TYPES — `pnpm -r typecheck` clean
- [x] G-LINT — `pnpm lint` clean
- [x] G-TEST — `pnpm -r test` (18/18: 17 ir + 1 plugin)
- [x] G-BUILD — `pnpm -r build` produces `packages/ir/dist/` and `packages/plugin/code.js` + `ui.html`
- [x] G-CLEAN — `git status` clean before final push

### Milestone gates

- [x] V-M1-SAMPLE — `sample.json` validates against zod (covered in `packages/ir/test/schema.test.ts`)
- [x] V-M1-PLUGIN-BUILD — esbuild bundled `code.js` (143 kb) without errors
- [x] V-M1-PLUGIN-MANUAL — verified by bleach in Figma desktop on 2026-04-18 (after override fix `974367f`)
- [x] V-M1-PLUGIN-SIZE — 580 lines (code.ts 400 + ui.html 180), under 1000

### How to manually verify M1

1. Open Figma desktop (side-loading plugins doesn't work in the browser).
2. **Menu → Plugins → Development → Import plugin from manifest…**
3. Select `packages/plugin/manifest.json`.
4. Run **Plugins → Development → claude-to-figma**.
5. Paste the contents of `packages/ir/examples/sample.json` into the textarea.
6. Click **Build**.

Expected: 1440×900 page frame, header row with logo + `Home/Docs/GitHub` nav,
a grid below with 3 card instances (`Fast`, `Editable`, `Open`). Editing the
`Card` component master should update all three instances. Local styles
panel should list `color/*` paints and `text/*` text styles.

If Inter Regular / Medium / Bold aren't installed, the plugin will fail with
`Missing fonts`. Either install them or edit `sample.json` to reference a
font you have, then re-paste.

### Post-verification checklist

When the user says `M1 verified`:

```bash
# Tag
git tag -a m1 -m "M1: IR schema + plugin round-trip"
git push --tags

# Update this file:
#   - M1 status → ✅ done
#   - M1 tag column → m1
#   - "Current status" block → move to M2
# Commit the doc update, push.

# Kick off M2: add packages/cli with commander + parse5, start on fixtures.
```

---

## M2 — CLI with trivial HTML

**Branch:** `m2-html-parser` (squash-merged into `main`)

### Standard gates

- [x] G-TYPES · G-LINT · G-TEST · G-BUILD · G-CLEAN

### Milestone gates

- [x] V-M2-FIXTURES — `simple-divs.html`, `nested-divs.html`, `text-heavy.html` under `packages/cli/test/fixtures/`
- [x] V-M2-SNAPSHOT — 3 snapshots written and asserted
- [x] V-M2-IR-VALID — each fixture's IR parses against zod
- [x] V-M2-ROUNDTRIP — verified by bleach in Figma desktop on 2026-04-18 using `simple-divs.html`. Visual overlap of text inside frames is by design (no layout engine yet — deferred to M4/M5).

---

## M3 — CSS resolution

**Branch:** `m3-css-cascade` (in progress)

### Standard gates

- [x] G-TYPES · G-LINT · G-TEST · G-BUILD · G-CLEAN

### Milestone gates

- [x] V-M3-CASCADE-TESTS — 26 cascade tests (specificity scoring + ordering, selector matching, !important precedence, inline vs author, inheritance, var() resolution incl. fallback + nesting + cycle, descendant + child combinator scoping)
- [x] V-M3-FIXTURES — `external-css.html` + `styles.css` (token-driven mini design system) and `cascade-edge-cases.html` (source-order tie, id-beats-class, !important vs inline, var() fallback, inheritance, descendant)
- [x] V-M3-SNAPSHOT — all 5 fixtures (M2's 3 + M3's 2) snapshot stable
- [x] V-M3-ROUNDTRIP — verified by bleach in Figma desktop on 2026-04-18 using `external-css.html`. White card and blue CTA materialized from the cascade alone (no inline styles), proving external link resolution + :root vars + class selectors + var() resolution.

### Deviation

KICKSTART specifies lightningcss for CSS parsing. We use **postcss** because lightningcss exposes a typed value AST that requires per-property serializers to recover string values for the cascade. postcss returns `decl.value` as the original CSS string, which the existing M2 value parsers consume directly. lightningcss can be added in a later milestone (e.g. M5 for shorthand expansion or token export) without disrupting the cascade.

---

## M4 — Yoga integration

**Branch:** `m4-yoga-layout` (in progress)

### Standard gates

- [x] G-TYPES · G-LINT · G-TEST · G-BUILD · G-CLEAN

### Milestone gates

- [x] V-M4-YOGA-TESTS — 7 yoga tests covering block stack, flex row, flex column, nested flex (justify-content + align-items), padding, margin, text measurement
- [x] V-M4-FIXTURES — `flex-basic.html` (3 pills in a row with gap + padding), `flex-nested.html` (page → header + sidebar + content with flex-grow). M2/M3 fixtures updated to use `position: relative` where they specified `top/left` (yoga follows the CSS spec — `position: static` ignores `top/left`).
- [ ] V-M4-VISUAL — user visually compares `flex-basic.html` to a browser render → `M4 verified` (positions within ~2px)

### Notes

- yoga-layout 3.2.1 (latest as of 2026-04-18) ships preloaded WASM via top-level await; sync after first import.
- Block elements (`display: block`) emit as flex columns in yoga so children take parent width by default — matches block layout behavior.
- Text measurement is a hand-rolled heuristic (avg char width = 0.55 × font-size, line-height auto = 1.2 × font-size, line wrapping). Visible drift at unusual fonts and condensed/expanded weights — acceptable for M4, may swap for a real shaper later if visual fidelity demands it.

---

## M5 — Flex → auto-layout mapping

**Branch:** `m5-auto-layout` (in progress)

### Standard gates

- [x] G-TYPES · G-LINT · G-TEST · G-BUILD · G-CLEAN

### Milestone gates

- [x] V-M5-MAPPING-TESTS — 36 mapping tests covering display gating, every flex-direction value, gap shorthand and per-axis longhands with axis-swap on vertical mode, padding longhands and 1–4 value shorthand, every justify-content (`space-around`/`space-evenly` collapse to `SPACE_BETWEEN` — closest Figma primitive, yoga still computes faithful pixel positions), every align-items value, wrap, child positioning (AUTO / ABSOLUTE), `flex-grow` → `layoutGrow`, parent-stretch defaults, `align-self` overrides
- [x] V-M5-FIXTURES — `flex-justify-variations.html`, `flex-align-variations.html`, `flex-wrap.html`
- [ ] V-M5-VISUAL — user confirms generated frames behave as real auto-layout (drag a child in, layout responds correctly) → `M5 verified`

### Notes

- The walker decorates flex frames with `layout` (LayoutProps) and their children with `childLayout` (ChildLayout). Geometry stays from yoga — these fields are pure structural metadata for the Figma plugin.
- See `docs/adr/0003-space-around-collapses-to-space-between.md` for the rationale on the SPACE_BETWEEN collapse.

---

## M6 — Component detection

**Branch:** `m6-component-detection` (in progress)

### Standard gates

- [x] G-TYPES · G-LINT · G-TEST · G-BUILD · G-CLEAN

### Milestone gates

- [x] V-M6-DETECTION-TESTS — 19 tests (7 hashSubtree cases, 9 detect unit cases, 3 end-to-end through convertHtml)
- [x] V-M6-FIXTURES — `card-grid.html` (6 identical .card frames in a wrapping flex grid), `nav-with-items.html` (5 .item rows in a flex nav)
- [x] V-M6-IR — components registry populated; original card + nav-item DOM positions become INSTANCE nodes referencing the master id; differing copy lands as per-instance `overrides[masterId].characters`
- [ ] V-M6-PLUGIN — user verifies in Figma that `card-grid.html` produces a real component with 6 instances, and editing the master propagates to all → `M6 verified`

### Notes

- Geometry is intentionally excluded from the structural hash — content-driven sizing means legitimate instances of the same component have different widths. See `docs/adr/0004-component-detection-hash-rules.md`.
- Outer patterns only — if cards each contain 3 buttons, M6 promotes Card (the outer pattern) and leaves the inner buttons alone. Nested-component detection is deferred.

---

## M7 — Token extraction (not started)

### Gates to pass

- [ ] G-TYPES · G-LINT · G-TEST · G-BUILD · G-CLEAN
- [ ] V-M7-EXTRACTION-TESTS — ≥ 15 tests (color dedup, text dedup, naming heuristics)
- [ ] V-M7-IR — styles registry populated, nodes reference styles by ID
- [ ] V-M7-PLUGIN — user verifies shared styles in Figma local styles panel → `M7 verified`

---

## M8 — Real-world testing (not started)

### Gates to pass

- [ ] G-TYPES · G-LINT · G-TEST · G-BUILD · G-CLEAN
- [ ] V-M8-HARNESS — integration harness runs on empty fixtures dir
- [ ] V-M8-DOCS — README complete; `LIMITATIONS.md` ≥ 10 known limitations
- [ ] V-M8-REAL — end-to-end on real Claude Design export → `M8 verified`

---

## Log

Chronological, terse. Append-only. One line per material event.

- `2026-04-18` — M1 scaffolded + all automated gates pass; pushed 6 commits to `claude/claude-to-figma-build-zTq1Q`; awaiting manual Figma verification.
- `2026-04-18` — README rewritten from M1-only to full project overview (commit `ffbfbe7`).
- `2026-04-18` — `docs/KICKSTART.md` and `docs/PROGRESS.md` added so the spec and state are versioned in-repo.
- `2026-04-18` — manual M1 verification in Figma surfaced an override bug: text overrides were keyed by Figma `n.name`/`n.id` instead of IR id, so all instances rendered master text. Fixed in `974367f` by stamping `irId` via `setPluginData` and looking it up first in `applyOverrides`. Re-verified.
- `2026-04-18` — M1 tagged `m1`. `main` created on remote from this commit; promoted to canonical branch.
- `2026-04-18` — Abandoned the bootstrap branch `claude/claude-to-figma-build-zTq1Q`. M2+ use the standard per-milestone branch workflow from `KICKSTART.md` (branch off `main`, squash-merge back, tag, delete). User intent: open-source the project after M8.
- `2026-04-18` — M2 shipped on `m2-html-parser`: CLI scaffold, inline-style parser, parse5 walker, 3 fixtures, 12 new tests (30 total). Verified manually in Figma; tagged `m2`.
- `2026-04-18` — M3 shipped on `m3-css-cascade`: cascade engine (selectors, specificity, !important, inheritance, var() with fallback + cycle bail), 2 fixtures, 26 new tests (62 total). Used postcss instead of lightningcss — documented deviation. Verified in Figma; tagged `m3`.
- `2026-04-18` — M4 shipped on `m4-yoga-layout`: yoga-layout 3.2.1 integration with CSS → Yoga style mapper (display, position, dimensions, padding/margin shorthands, border, flex container + item, gap), heuristic text measurement, shared classify.ts module. 2 new fixtures, 7 new tests (74 total). M2/M3 fixtures updated to use `position: relative` per CSS spec.
- `2026-04-18` — M5 shipped on `m5-auto-layout`: flex → auto-layout mapper emits `layout` on flex frames and `childLayout` on their items. 3 new fixtures, 36 new mapping tests (119 total in workspace). First ADR set added under `docs/adr/`. Verified in Figma; tagged `m5`.
- `2026-04-18` — Spotted that GitHub still had `claude/claude-to-figma-build-zTq1Q` set as the repo default branch (so the homepage compared against it instead of just showing main). Switched the default to `main` via `gh api repos/brianleach/claude-to-figma -X PATCH -f default_branch=main`. Bootstrap branch left in place as an archive.
- `2026-04-18` — M6 shipped on `m6-component-detection`: subtree-hash detection promotes ≥3 identical FRAMEs to a shared component, with per-instance text overrides. 2 new fixtures, 19 new tests (144 total). New ADR 0004 documents what the structural hash includes/excludes. Verified in Figma; tagged `m6`.
