# claude-to-figma

[![CI](https://github.com/brianleach/claude-to-figma/actions/workflows/ci.yml/badge.svg)](https://github.com/brianleach/claude-to-figma/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node: >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

**Convert [Claude Design](https://claude.ai/design) HTML exports into fully editable Figma files** — real
frames, real auto-layout, real components, real design tokens. Not a
pixel-perfect screenshot importer. Not a raster trace. A proper semantic
translation from the DOM into Figma's scene graph.

> *Dogfood example: the [landing page for this project](./examples/landing/)
> was generated in Claude Design, converted through this CLI, and shipped in
> the repo —
> [browser screenshot](./examples/landing/screenshots/browser.png) ·
> [IR JSON](./examples/landing/claude-to-figma.ir.json) ·
> [Figma file](./examples/landing/claude-to-figma.fig). The Figma render
> isn't yet at parity with the browser; the
> [known issues](./examples/landing/README.md#known-issues-in-the-current-render)
> are the next polish target.*

> **Status:** M1–M8 shipped on `main` — full pipeline from Claude Design
> HTML to an editable Figma scene with cascaded styles, yoga-computed
> geometry, real auto-layout, component detection with text overrides,
> token extraction (paint + text styles), and a real-world testing
> harness. Documented limits live in [`LIMITATIONS.md`](./LIMITATIONS.md).

---

## Why this exists

[Claude Design](https://claude.ai/design) can export what you make to
**Canva, PDF, PPTX, and HTML** — but not to Figma. A lot of design teams, and most product
teams, live in Figma. The obvious workaround is "screenshot the HTML and drop
the PNG into Figma," but that produces a dead artifact: you can't edit a text
style, you can't swap a button, you can't reuse a component. The moment a
designer wants to iterate, they rebuild the entire thing by hand.

HTML is the richest of those export formats — it preserves DOM semantics, CSS,
structure, and text — so it's the natural source for a proper conversion. That
conversion is what `claude-to-figma` does.

### What "fully editable" means here

When you run `claude-to-figma` on an HTML export and load the result in Figma,
you should get:

- **Frames, not raster images.** Every `<div>` becomes a `FrameNode`, every
  heading a `TextNode`. Change the text, and it stays text.
- **Auto-layout that actually works.** `display: flex; gap: 16px;
  justify-content: space-between` becomes a horizontal auto-layout frame with
  `itemSpacing: 16` and `primaryAxisAlignItems: SPACE_BETWEEN`. Drop a new
  child in and Figma lays it out correctly.
- **Components, not duplicated subtrees.** If the source HTML has six
  identical card markups, the output has one `Card` component and six
  instances. Edit the master, all instances update.
- **Named design tokens.** Repeated colors become paint styles
  (`color/primary`, `color/surface`), repeated text combos become text styles
  (`heading/md`, `body/sm`). They show up in Figma's local styles panel,
  ready to be published to a library.

---

## How it works

```
┌──────────────────────┐
│ Claude Design HTML   │  (index.html + styles.css + assets/)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│ CLI  (packages/cli — Node)                                   │
│                                                              │
│   parse5         — parse HTML into the DOM                   │
│   postcss        — parse CSS into rules + declarations       │
│   cascade engine — resolve specificity, inheritance, --vars  │
│   yoga-layout    — compute box geometry for every node       │
│   flex→auto-layout mapper                                    │
│   component detector (subtree hashing)                       │
│   token extractor (paints + text styles + naming heuristics) │
│   sharp          — decode + embed images                     │
└──────────┬───────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────┐
│ IR JSON              │  ← shared schema (packages/ir, zod + TS)
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│ Figma plugin  (packages/plugin — Figma Plugin API)           │
│                                                              │
│   validate IR with zod                                       │
│   preload every font from the manifest                       │
│   register paint + text styles                               │
│   register component masters                                 │
│   walk the IR, build the Figma scene graph                   │
│   apply per-instance text overrides                          │
└──────────┬───────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────┐
│ Editable Figma file  │
└──────────────────────┘
```

### What's an IR?

**IR = Intermediate Representation** — a standard compiler concept. It's a
neutral, structured format that sits between two ends of a translation
pipeline. Neither end talks to the other directly; both talk to the IR.

In this project the IR is a JSON document describing a design as a tree of
typed nodes (`FRAME`, `TEXT`, `IMAGE`, `VECTOR`, `INSTANCE`) plus
registries for shared styles, components, and fonts. The schema lives in
[`packages/ir/src/schema.ts`](./packages/ir/src/schema.ts) (zod), and a
hand-written example sits at
[`packages/ir/examples/sample.json`](./packages/ir/examples/sample.json).

Why bother with one instead of going HTML → Figma directly:

- **Decoupling.** The CLI knows nothing about the Figma Plugin API. The
  plugin knows nothing about HTML or CSS. Both depend only on the IR
  schema.
- **Debuggability.** Every conversion produces a real file you can open,
  diff, edit by hand, replay, or commit as a fixture.
- **Replaceability.** Swap the plugin for a Sketch / Penpot builder later
  and only that half changes. Same IR, different consumer.
- **Stable contract.** The schema carries an `IR_VERSION` and evolves
  additively; breaking changes bump the version.

This decision and other architectural calls (postcss vs lightningcss,
auto-layout mapping trade-offs, etc.) are written up in
[`docs/adr/`](./docs/adr/).

### CSS → Figma semantic mapping

| CSS                                 | Figma                                      |
| ----------------------------------- | ------------------------------------------ |
| `display: flex`, `flex-direction`   | `layoutMode: HORIZONTAL / VERTICAL`        |
| `gap`, `row-gap`, `column-gap`      | `itemSpacing`, `counterAxisSpacing`        |
| `padding`                           | `paddingTop / Right / Bottom / Left`       |
| `justify-content`                   | `primaryAxisAlignItems`                    |
| `align-items`                       | `counterAxisAlignItems`                    |
| `flex-wrap: wrap`                   | `layoutWrap: WRAP`                         |
| `flex: 1`                           | `layoutGrow: 1`                            |
| `position: absolute`                | `layoutPositioning: ABSOLUTE`              |
| Repeated subtree                    | Component + instances                      |
| Repeated color                      | Paint style in the styles registry         |
| Repeated text combo                 | Text style in the styles registry          |

---

## Monorepo layout

Three packages, pnpm workspaces:

```
.
├── packages/
│   ├── ir/          shared IR schema (zod) + inferred TS types
│   ├── cli/         Node CLI: HTML+CSS → IR JSON
│   └── plugin/      Figma plugin: IR JSON → Figma scene graph
├── fixtures/        gitignored, for real Claude Design exports
├── biome.json       lint + format (Biome, no ESLint / Prettier)
├── tsconfig.base.json   strict + noUncheckedIndexedAccess
└── pnpm-workspace.yaml
```

Stack:

- **TypeScript** everywhere, strict mode, `noUncheckedIndexedAccess`
- **pnpm** workspaces
- **zod** for IR schema + runtime validation
- **tsup** for IR build
- **esbuild** for plugin bundle (IIFE)
- **vitest** for tests
- **Biome** for lint + format

### Repo tour (where to start reading)

Most of the interesting logic lives in small, focused modules. Rough
reading order for someone getting oriented:

- [`packages/ir/src/schema.ts`](./packages/ir/src/schema.ts) — the IR
  contract. Every node type, every style registry, every override
  shape. Everything else in the repo is downstream of this file.
- [`packages/cli/src/cascade/`](./packages/cli/src/cascade) — CSS
  resolution. `collect.ts` pulls stylesheets, `cascade.ts` walks the
  rule set with specificity / inheritance / `var()`.
- [`packages/cli/src/layout/yoga.ts`](./packages/cli/src/layout/yoga.ts)
  — Yoga integration + text measurement heuristic.
- [`packages/cli/src/layout/auto-layout.ts`](./packages/cli/src/layout/auto-layout.ts)
  — flex → Figma auto-layout mapping. The most "translation-y" file in
  the repo.
- [`packages/cli/src/detect/hash.ts`](./packages/cli/src/detect/hash.ts)
  — structural hashing for component detection (what's included,
  what's excluded, why).
- [`packages/cli/src/extract/`](./packages/cli/src/extract) — token
  extraction and the naming heuristic (`color/primary`, `heading/lg`).
- [`packages/plugin/src/code.ts`](./packages/plugin/src/code.ts) — the
  Figma plugin: validates the IR, preloads fonts, registers styles,
  walks the IR, builds the scene graph, applies overrides.

ADRs for architectural calls live in
[`docs/adr/`](./docs/adr/). Known gaps in
[`LIMITATIONS.md`](./LIMITATIONS.md). Project state in
[`docs/PROGRESS.md`](./docs/PROGRESS.md). The original prompt that
bootstrapped the project is in
[`docs/KICKSTART.md`](./docs/KICKSTART.md).

---

## Milestones

Each milestone ends with a committed, tagged release. Standard gates per
milestone: typecheck clean, Biome clean, tests passing, build succeeds, git
status clean. Milestone-specific verification gates (manual Figma checks,
snapshot tests, cascade tests, etc.) live in the milestone notes.

| #   | Status  | Summary                                                                                         |
| --- | ------- | ----------------------------------------------------------------------------------------------- |
| M1  | ✅ done | IR schema + Figma plugin. Hand-written sample IR round-trips into an editable Figma scene.       |
| M2  | ✅ done | CLI scaffold with parse5. Inline styles only. Emits valid IR from trivial HTML fixtures.         |
| M3  | ✅ done | Full CSS resolution: external `<link>`, `<style>` blocks, inline. Cascade + inheritance + `var()`. |
| M4  | ✅ done | [yoga-layout](https://github.com/facebook/yoga) 3.2.1 integration. Block + flex layout, padding/margin shorthands, heuristic text measurement. |
| M5  | ✅ done | Flex → Figma auto-layout mapping. `flex-direction`, `gap`, `justify-content`, `align-items`, `wrap`, `flex-grow`, position-absolute children. |
| M6  | ✅ done | Component detection via subtree hashing. Repeated markup → component + instances with per-instance text overrides. |
| M7  | ✅ done | Token extraction. Unique colors + text combos → named paint/text styles with heuristic naming (color/primary, heading/lg, body/md, ...). |
| M8  | ✅ done | Real-world harness (`pnpm test:integration`), `--verbose` / `--report` CLI flags, `LIMITATIONS.md`, `CONTRIBUTING.md`, README polish. |

### What ships today (M1 → M8)

- `packages/ir`: complete IR schema in zod — frames, text, images, vectors,
  component instances, paint + text style registries, component registry,
  font manifest, image manifest.
- `packages/plugin`: Figma plugin that validates IR with zod, preloads fonts
  (fails loud on missing ones), registers paint and text styles, registers
  component masters, walks the IR, builds the scene graph, and applies
  per-instance text overrides.
- `packages/ir/examples/sample.json`: hand-written 1440×900 page with a
  header (logo + nav) and three card instances backed by a single component.
- `packages/cli` (**M2**): commander-based CLI; parse5 walker classifies each
  element (frame / text / image / vector / instance) and emits valid IR.
- `packages/cli/src/cascade` (**M3**): three-phase cascade engine — collect
  external `<link>` + `<style>` + inline declarations, match a minimal
  selector subset (tag / class / id / descendant / child / `:root`), then
  resolve `!important`, specificity, source order, inheritance, and `var()`
  references (with fallback and cycle bail-out).
- `packages/cli/src/layout/yoga.ts` (**M4**): yoga-layout 3.2.1 integration.
  Maps cascade-resolved styles to a Yoga tree, runs `calculateLayout`,
  returns parent-relative geometry per element. Covers block stacking,
  flex containers, padding and margin (longhands + 1–4 value shorthands),
  positioning (`static` / `relative` / `absolute` / `fixed`), and a
  heuristic text measurement callback. Block elements emit as flex columns
  so children inherit parent width like real CSS block layout.
- `packages/cli/src/layout/auto-layout.ts` (**M5**): CSS flex → Figma
  auto-layout mapper. Decorates flex frames with `layout` (layoutMode,
  itemSpacing, counterAxisSpacing, padding edges, justify/align,
  wrap) and decorates each child with `childLayout` (layoutPositioning,
  layoutGrow, layoutAlign). The Figma plugin builds these as real
  auto-layout frames — drag a child after build and the layout responds.
- `packages/cli/src/detect` (**M6**): subtree-hash-based component
  detection. After the walker emits the IR, every FRAME gets a structural
  fingerprint (type + name + layout + fills + strokes + effects + recursive
  children — geometry and content are excluded so legitimate variations
  in size and copy stay matched). Groups of ≥3 identical subtrees
  (configurable via `--component-threshold <n>`) are promoted to a shared
  component definition, and each occurrence is replaced with an INSTANCE
  that carries per-text overrides for differing copy. Outer patterns only
  in M6 — nested repeat detection is left for a later milestone.
- `packages/cli/src/extract` (**M7**): token extraction. Unique solid
  colors and text-style combos across the whole IR (root + component
  masters) get named entries in `styles.paints` / `styles.texts`, and
  every FRAME / TEXT that uses one carries a `fillStyleId` /
  `textStyleId` reference. Naming heuristic: pure white / black get
  `color/white` / `color/black`; the next three by frequency get
  `color/primary`, `color/secondary`, `color/accent`; the rest fall back
  to `color/{hex}`. Text styles bucket by size + weight (`heading/xl`
  through `caption`) with collision fallback to `text/{size}-{weight}`.
  See [ADR 0005](./docs/adr/0005-token-extraction-naming.md).
- `packages/cli/src/harness.ts` + `scripts/integration.ts` (**M8**):
  real-world testing harness. Walks `fixtures/claude-design/`
  (gitignored — your content stays on your machine), runs conversion
  on every `*.html` file, and prints a one-row-per-fixture summary
  with stats and warnings. The CLI gains `--verbose` and `--report`
  flags for debugging real exports. Limits are written up in
  [`LIMITATIONS.md`](./LIMITATIONS.md); contribution flow in
  [`CONTRIBUTING.md`](./CONTRIBUTING.md).

158 cli tests + 17 ir + 1 plugin = **176 across the workspace**.

**Known limits live in [`LIMITATIONS.md`](./LIMITATIONS.md)** — read it
before assuming a real Claude Design export will round-trip cleanly.

---

## Install

**Requirements:** Node 20+, pnpm 9+, and the **Figma desktop app** (the
browser app can't side-load plugins).

```bash
git clone https://github.com/brianleach/claude-to-figma.git
cd claude-to-figma
pnpm install
pnpm -r build       # tsup (ir, cli) + esbuild (plugin)
```

---

## Usage

### A. CLI: HTML → IR JSON

Convert any HTML file into IR. The CLI walks the input, runs CSS resolution,
yoga layout, flex → auto-layout mapping, component detection, and token
extraction in one pass:

```bash
node packages/cli/dist/index.js convert \
  path/to/your/index.html \
  -o /tmp/your.ir.json
```

#### Flags

| Flag                          | Default | What it does                                                                   |
| ----------------------------- | ------- | ------------------------------------------------------------------------------ |
| `-o, --output <path>`         | —       | Required. Where to write the IR JSON.                                          |
| `--name <name>`               | input filename | Document name embedded in the IR.                                       |
| `--component-threshold <n>`   | `3`     | Min identical subtrees to promote to a component. `0` disables detection.       |
| `--silent`                    | off     | Suppress per-warning lines on stderr.                                          |
| `-v, --verbose`               | off     | Print a per-pass breakdown after each conversion.                              |
| `--report <path>`             | —       | Write a JSON report (stats + warnings + timestamps) alongside the IR.           |
| `--hydrate`                   | off     | Pre-render the input in headless Chromium before parsing. Required for JS-bundled exports like Claude Design's `*.standalone.html`. Needs `pnpm exec playwright install chromium`. The page runs with network offline and a `file://`-only route blocker — still, don't point `--hydrate` at HTML from sources you don't trust. |
| `--viewport <WxH>`            | `1440x900` | Viewport dimensions for `--hydrate` rendering. Matches Claude Design's default desktop breakpoint. Use e.g. `--viewport 1280x720` if a page renders for a specific narrower target. |
| `--font-fallback <family>`    | —       | Substitute every font family in the output with this one. Use when you can't install the originals locally (`Inter` is a safe default — ships with most systems). |

The CLI also has a `fonts` subcommand that prints the shopping list of
font families a given HTML needs, so you can install them before
`convert`:

```bash
node packages/cli/dist/index.js fonts path/to/your/index.html --hydrate
```

#### Fonts: read this before you paste into Figma

The Figma Plugin API can only **use** fonts that are already installed
on the user's local system — it can't install new ones. CSS
`<link href="fonts.googleapis.com/...">` references are CDN URLs the
browser fetches at render time, **not actual font files in the
export**. A typical Claude Design landing page needs 3–6 Google Fonts
(Fraunces, DM Sans, JetBrains Mono, Space Grotesk, Newsreader, ...).

Workflow:

1. Run `claude-to-figma fonts <input.html> --hydrate` to print the
   shopping list.
2. Download each from [fonts.google.com](https://fonts.google.com).
   On macOS: drag the `*.ttf` files into **Font Book**. Restart Figma
   desktop after install.
3. Then `convert` and paste into the plugin.

If you can't install fonts (or you want a quick first look),
`--font-fallback Inter` rewrites every family in the IR to Inter. The
page renders with wrong typography but right layout / components /
colors — fix the typography in Figma after.

#### Demo fixtures

Synthetic fixtures under `packages/cli/test/fixtures/` cover every
milestone's surface — try any of them:

| Fixture                          | Demonstrates                                                            |
| -------------------------------- | ----------------------------------------------------------------------- |
| `simple-divs.html`               | Inline styles, a card, a CTA                                            |
| `external-css.html` + `styles.css` | `:root` variables, `var()`, descendant selectors, external `<link>`     |
| `cascade-edge-cases.html`        | `!important`, specificity ties, `var()` fallback, inheritance           |
| `flex-basic.html`                | A horizontal flex row with gap + padding                                |
| `flex-nested.html`               | Page > header + sidebar + content with `flex-grow`                      |
| `flex-justify-variations.html`   | `justify-content` start / center / end / space-between                  |
| `flex-align-variations.html`     | `align-items` start / center / end / stretch                            |
| `flex-wrap.html`                 | `flex-wrap: wrap` across multiple rows                                  |
| `card-grid.html`                 | 6 cards → 1 component with text overrides                               |
| `nav-with-items.html`            | 5 nav items → 1 component                                               |

### B. Plugin: paste IR JSON → editable Figma

1. Figma desktop → **Menu → Plugins → Development → Import plugin from manifest…**
2. Select `packages/plugin/manifest.json`.
3. Run **Plugins → Development → claude-to-figma**.
4. Paste either an IR document the CLI produced, or
   `packages/ir/examples/sample.json` (hand-written, shows the
   component-with-overrides story).
5. Click **Build**.

What you should see:
- Real frames, not raster images.
- Auto-layout where the source uses `display: flex` — drag a child in or
  out and the layout responds.
- Repeated subtrees become a single component plus instances; per-instance
  text overrides apply.
- Local styles panel populated with `color/*` paint styles and
  `heading/*` / `body/*` / `caption` text styles.

### C. Real-world harness

Drop your own Claude Design HTML exports into `fixtures/claude-design/`
(gitignored — your content stays on your machine), then run:

```bash
pnpm --filter @claude-to-figma/cli test:integration
pnpm --filter @claude-to-figma/cli test:integration -- --report
pnpm --filter @claude-to-figma/cli test:integration -- --hydrate --report
```

The harness walks the directory recursively, runs conversion on every
`*.html` file, and prints a one-row-per-fixture summary of nodes,
components, instances, paint styles, text styles, and warnings. With
`--report`, a per-fixture `*.report.json` lands next to each input.
With `--hydrate`, every fixture is pre-rendered in headless Chromium
first — required for Claude Design's `*.standalone.html` and other
runtime-bundled exports.

---

## Troubleshooting

| Symptom                                  | Cause and fix                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| Plugin alert: `Missing fonts`            | Install the listed fonts (Inter Regular / Medium / Semi Bold / Bold cover most fixtures) or edit the IR's `fonts` manifest to ones you have. The plugin won't substitute silently. |
| Plugin status: `IR validation failed`    | The IR document doesn't match the zod schema. The status panel lists the first five issues with their JSON paths — fix and re-paste.                                                |
| Children pile up at `(0, 0)`             | Source CSS uses `top` / `left` without `position: relative` (or another non-`static`). CSS spec ignores them at `position: static`; yoga follows the spec.                          |
| Cards have height 0 in Figma             | Wrapper element has no measurable children. As of M6 the layout module measures bare text inside any frame, so this should not happen on real exports — file an issue with a repro. |
| Detected fewer components than expected  | Subtrees differ on `name` (i.e. CSS `class`) or any structural field other than `geometry`. Adjust threshold via `--component-threshold` or check the structural-hash recipe in [ADR 0004](./docs/adr/0004-component-detection-hash-rules.md). |
| `color/primary` is the wrong color       | Naming is frequency-based with white/black special-cased. The most-used non-trivial color wins — see [ADR 0005](./docs/adr/0005-token-extraction-naming.md). The IR is editable post-conversion if you want to rename. |
| Plugin doesn't appear in Figma           | Plugin side-loading only works in the desktop app, not the browser app.                                                                                                              |

---

## Development

```bash
pnpm install
pnpm -r typecheck                          # tsc --noEmit across the workspace
pnpm -r test                               # vitest across the workspace
pnpm -r build                              # tsup (ir, cli) + esbuild (plugin)
pnpm lint                                  # biome check
pnpm lint:fix                              # biome check --write
pnpm --filter @claude-to-figma/cli test:integration  # real-export harness
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full contribution flow,
branch naming, and PR conventions.

### Design principles

- **The IR is the product.** Never break it casually; evolve it additively.
  Bump `version` on breaking changes.
- **Both halves are dumb.** The CLI doesn't know about Figma. The plugin
  doesn't know about HTML. Meaning lives in the IR.
- **Semantic, not pixel-perfect.** We're optimizing for editability in Figma,
  not for exact visual fidelity. Sometimes those trade off.
- **No tricks that rot.** No headless-browser screenshots, no heuristics that
  look at pixel color to guess structure. Structure comes from the DOM.

---

## License

MIT. See [LICENSE](./LICENSE).
