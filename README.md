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

### What *isn't* editable by design — `data-c2f="snapshot"`

Not every region of a generated page benefits from being broken apart into
editable frames. A decorative illustration — e.g. a rotated stack of mocked-up
"before / after" cards with dashed borders, stripes, and pseudo-element
accents — is authored as a single visual. Designers replace that kind of
thing wholesale; they don't tweak which direction the diagonal stripes run.

Mark any element with `data-c2f="snapshot"` in the source HTML and
`claude-to-figma convert --hydrate` will:

1. Let Chromium render the whole subtree normally.
2. Take an element-level PNG screenshot via Playwright.
3. Replace the subtree in the IR with a single IMAGE node carrying the
   PNG as a data URI.
4. The plugin registers the PNG with Figma (`figma.createImage`) and
   fills a single rectangle with it.

In Figma, the region lives as one asset: resize it, replace its fill with
a different PNG, swap it out entirely — all the normal Figma image
operations. What it's *not* is a tree of nested frames you could pull
apart pixel-by-pixel. That's the trade, and it's the one the prototype
wants you to make for decorative content.

Text, layout, components, and tokens stay editable everywhere *outside*
a `data-c2f="snapshot"` subtree.

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

## What works today

- **CSS cascade.** External `<link>`, `<style>` blocks, inline styles.
  Specificity, `!important`, inheritance, `var()` (with fallback +
  cycle bail-out). Selector subset is tag / class / id / descendant /
  child / `:root` — see [LIMITATIONS](./LIMITATIONS.md) for what's not
  matched.
- **Layout.** Yoga-computed geometry for block + flex. Padding / margin
  shorthands. Position static / relative / absolute / fixed. Flex →
  Figma auto-layout mapping (`layoutMode`, `itemSpacing`, padding edges,
  justify / align, wrap, `layoutGrow`, ABSOLUTE positioning).
- **Components.** Subtree-hash detection promotes ≥3 identical FRAMEs
  (configurable via `--component-threshold`) to a shared component plus
  instances with per-text overrides. Geometry and content excluded
  from the hash so legitimate size / copy variation stays matched.
- **Tokens.** Repeated colors → named paint styles
  (`color/primary` / `secondary` / `accent` / `{hex}`). Repeated text
  combos → named text styles (`heading/lg`, `body/md`, …). Both land
  in Figma's local styles panel.
- **Real-world harness.** `pnpm --filter @claude-to-figma/cli
  test:integration` walks `fixtures/claude-design/` and runs
  conversion on every `*.html`. `--hydrate` flag pre-renders
  JS-bundled exports via headless Chromium. `--font-fallback`
  substitutes typefaces you can't install locally.

**176 tests** across the workspace (158 cli + 17 ir + 1 plugin).
**Known limits** live in [`LIMITATIONS.md`](./LIMITATIONS.md) — read
it before assuming a real Claude Design export will round-trip cleanly.

Per-milestone history (M1–M8 with verification gates and tags) is in
[`docs/PROGRESS.md`](./docs/PROGRESS.md).

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
