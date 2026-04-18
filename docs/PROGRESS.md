# Progress

Single source of truth for where the build is. Update this file as part of
every milestone's final commit (or any mid-milestone change that moves a
gate from ❌ → ✅). Anyone — human, local Claude, web Claude — should be
able to read this file and know exactly what to do next.

The authoritative spec is [`KICKSTART.md`](./KICKSTART.md). This file tracks
execution against that spec.

---

## Current status

**Active milestone:** M2 (not started)
**Last tag:** `m1`
**Next action:** scaffold `packages/cli` with commander + parse5; emit IR
for inline-styled HTML; add 3 fixtures + snapshot tests. See M2 section
below.

## Working branch

`main` exists on the remote as of the M1 promotion and is the canonical
branch going forward. `claude/claude-to-figma-build-zTq1Q` is still the
only branch the bootstrap harness can push to, so any web-Claude session
will continue working there; local sessions should use the normal
per-milestone branch flow from `KICKSTART.md` against `main`.

## Milestone overview

| #   | Status | Tag | Verified by | Notes                                                       |
| --- | ------ | --- | ----------- | ----------------------------------------------------------- |
| M1  | ✅ done | `m1` | bleach @ 2026-04-18 | IR + plugin + sample. Override bug found and fixed during verify. |
| M2  | ⬜ not started | — | —           | CLI scaffold + parse5, inline styles only.                  |
| M3  | ⬜ not started | — | —           | Full CSS resolution (cascade, inheritance, `--vars`).       |
| M4  | ⬜ not started | — | —           | yoga-layout integration.                                    |
| M5  | ⬜ not started | — | —           | Flex → Figma auto-layout mapping.                           |
| M6  | ⬜ not started | — | —           | Component detection via subtree hashing.                    |
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

## M2 — CLI with trivial HTML (not started)

### Scope reminder

- Scaffold `packages/cli` with commander
- Parse HTML with parse5 (inline styles only)
- Emit valid IR for nested divs + text
- No flex, no layout computation yet
- CLI: `claude-to-figma convert <input.html> -o <output.json>`
- Snapshot tests for 3 fixture HTML files

### Gates to pass

- [ ] G-TYPES · G-LINT · G-TEST · G-BUILD · G-CLEAN
- [ ] V-M2-FIXTURES — 3 fixtures: `simple-divs.html`, `nested-divs.html`, `text-heavy.html`
- [ ] V-M2-SNAPSHOT — snapshot tests pass
- [ ] V-M2-IR-VALID — each fixture's IR parses against zod (explicit test)
- [ ] V-M2-ROUNDTRIP — user manually verifies `simple-divs.html` IR in the plugin → `M2 verified`

---

## M3 — CSS resolution (not started)

### Gates to pass

- [ ] G-TYPES · G-LINT · G-TEST · G-BUILD · G-CLEAN
- [ ] V-M3-CASCADE-TESTS — ≥ 15 cascade tests (specificity, `!important`, inheritance, `--vars`)
- [ ] V-M3-FIXTURES — `external-css.html` + `styles.css`, `cascade-edge-cases.html`
- [ ] V-M3-SNAPSHOT — snapshots pass (old + new)
- [ ] V-M3-ROUNDTRIP — user manually verifies `external-css.html` in Figma → `M3 verified`

---

## M4 — Yoga integration (not started)

### Gates to pass

- [ ] G-TYPES · G-LINT · G-TEST · G-BUILD · G-CLEAN
- [ ] V-M4-YOGA-TESTS — ≥ 5 layout scenarios (block stack, flex row/col, nested flex, padding/margin)
- [ ] V-M4-FIXTURES — `flex-basic.html`, `flex-nested.html`, geometry snapshotted
- [ ] V-M4-VISUAL — user visually compares to browser → `M4 verified` (positions within ~2px)

---

## M5 — Flex → auto-layout mapping (not started)

### Gates to pass

- [ ] G-TYPES · G-LINT · G-TEST · G-BUILD · G-CLEAN
- [ ] V-M5-MAPPING-TESTS — ≥ 20 mapping tests
- [ ] V-M5-FIXTURES — `flex-justify-variations.html`, `flex-align-variations.html`, `flex-wrap.html`
- [ ] V-M5-VISUAL — user confirms generated frames behave as real auto-layout → `M5 verified`

---

## M6 — Component detection (not started)

### Gates to pass

- [ ] G-TYPES · G-LINT · G-TEST · G-BUILD · G-CLEAN
- [ ] V-M6-DETECTION-TESTS — ≥ 10 tests (hashing, repeat detection, naming)
- [ ] V-M6-FIXTURES — `card-grid.html` (6 cards), `nav-with-items.html` (5 nav items)
- [ ] V-M6-IR — components registry populated, children are `INSTANCE` nodes
- [ ] V-M6-PLUGIN — user verifies component master edits propagate → `M6 verified`

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
