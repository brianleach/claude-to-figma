# claude-to-figma

**Convert [claude.ai/design](https://claude.ai/design) HTML exports into fully editable Figma files** — real
frames, real auto-layout, real components, real design tokens. Not a
pixel-perfect screenshot importer. Not a raster trace. A proper semantic
translation from the DOM into Figma's scene graph.

> **Status:** in active development. M1–M6 shipped on `main` — IR + Figma
> plugin, CLI with parse5, full CSS cascade engine (external stylesheets,
> specificity, `!important`, inheritance, `var()`), yoga-layout integration
> for block + flex geometry, CSS flex → Figma auto-layout mapping so built
> frames are real auto-layout, and component detection that promotes
> repeated markup to a component definition + instances with text
> overrides. See the [milestones](#milestones) table below for what's
> built and what's next.

---

## Why this exists

[claude.ai/design](https://claude.ai/design) can export what you make to **Canva,
PDF, PPTX, and HTML** — but not to Figma. A lot of design teams, and most product
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
│ claude.ai/design HTML │  (index.html + styles.css + assets/)
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
├── fixtures/        gitignored, for real claude.ai/design exports
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
| M7  | next    | Token extraction. Unique colors + text combos → named paint/text styles with heuristic naming.   |
| M8  | pending | Real-world harness, docs, known limitations, end-to-end testing on real claude.ai/design exports.   |

### What ships today (M1 → M6)

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

126 cli tests + 17 ir + 1 plugin = **144 across the workspace**.

What's not in yet (M7–M8): token extraction with paint/text style
naming heuristics (M7), and the real-world harness for end-to-end
testing on actual claude.ai/design exports (M8).

---

## Try it

```bash
git clone https://github.com/brianleach/claude-to-figma.git
cd claude-to-figma
pnpm install
pnpm -r build
```

### A. CLI: HTML → IR JSON (M2 + M3)

Convert any inline-styled or CSS-driven HTML into IR:

```bash
node packages/cli/dist/index.js convert \
  packages/cli/test/fixtures/external-css.html \
  -o /tmp/external-css.ir.json
```

Three demo fixtures live under `packages/cli/test/fixtures/`:

- `simple-divs.html` — inline-styled card + CTA
- `external-css.html` + `styles.css` — token-driven mini design system using
  `:root` variables, `var()`, and class selectors
- `cascade-edge-cases.html` — `!important` precedence, specificity ties,
  `var()` fallback, inheritance, descendant selectors

Warnings (e.g. elements without explicit width/height) print to stderr.
Pass `--silent` to suppress them.

### B. Plugin: paste IR JSON → editable Figma (M1)

In **Figma desktop** (plugins can't be side-loaded in the browser):

1. **Menu → Plugins → Development → Import plugin from manifest…**
2. Select `packages/plugin/manifest.json`.
3. Run: **Plugins → Development → claude-to-figma**.
4. Paste the IR — either `packages/ir/examples/sample.json` (hand-written,
   shows the component + instance + style story) or any output from the CLI.
5. Click **Build**.

The hand-written sample produces a 1440×900 page with a header and three
card instances backed by one component — edit the master, all three
instances update.

### Troubleshooting

- `Missing fonts` — install Inter Regular / Medium / Bold locally, or edit
  the IR to point at fonts you have.
- `IR validation failed` — the plugin status panel lists the first five zod
  issues with their JSON paths.
- **Auto-layout works in Figma** — flex frames built by the CLI become
  real Figma auto-layout frames. Drag a child in or out and the layout
  responds. Geometry comes from yoga; the auto-layout fields are
  metadata for editability.

---

## Development

```bash
pnpm install
pnpm -r typecheck        # tsc --noEmit across the workspace
pnpm -r test             # vitest across the workspace
pnpm -r build            # tsup (ir) + esbuild (plugin)
pnpm lint                # biome check
pnpm lint:fix            # biome check --write
```

### Contributing

Not accepting PRs yet — the project's on a milestone-by-milestone build
schedule and each milestone has explicit verification gates. Once M8 ships,
contribution guidelines and the fixture-authoring process go in `CONTRIBUTING.md`.

Bug reports and real claude.ai/design exports (anonymized) that break the
converter are welcome via issues.

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
