# claude-to-figma

Convert Claude Design HTML exports into editable Figma files with semantic
structure — frames, auto-layout, components, and design tokens. Not a
rasterizer.

**Status:** under active construction. See `Milestones` below.

## Why

Claude Design exports to Canva, PDF, PPTX, and HTML — but not Figma. HTML is
the richest export format (preserves DOM semantics, CSS, structure), so we
treat HTML → Figma as a proper semantic conversion: `div` → `FrameNode`,
`display: flex` → auto-layout, repeated subtrees → components, unique colors
and text combos → shared styles.

## Architecture

```
Claude Design HTML  →  CLI (parse5 + lightningcss + yoga)
                          │
                          ▼
                   IR JSON (packages/ir)
                          │
                          ▼
                  Figma Plugin (Plugin API)
                          │
                          ▼
                   Editable Figma file
```

Monorepo, three packages:

| Package                   | Role                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| `packages/ir`             | Shared IR schema (zod) + inferred TypeScript types. Imported by both. |
| `packages/cli`            | Node CLI. Parses HTML/CSS, computes layout, emits IR JSON.          |
| `packages/plugin`         | Figma plugin. Reads IR, builds the scene graph via the Plugin API.  |

The IR is the product. Both halves are dumb.

## Milestones

| M   | Summary                                                                                          |
| --- | ------------------------------------------------------------------------------------------------ |
| M1  | IR schema + Figma plugin that round-trips a hand-written sample.                                 |
| M2  | CLI with parse5, trivial HTML → IR (inline styles only).                                         |
| M3  | Full CSS resolution (external + `<style>` + inline, cascade, inheritance, `--vars`).             |
| M4  | Yoga layout integration — computed geometry for every node.                                      |
| M5  | Flex → Figma auto-layout mapping (layoutMode, alignment, wrap, gap, padding).                    |
| M6  | Component detection via subtree hashing.                                                          |
| M7  | Token extraction — paint and text styles, named by heuristic.                                    |
| M8  | Real-world testing harness + docs + known limitations.                                           |

## Running M1

M1 lets you round-trip a hand-written IR document through the plugin into a
real Figma scene graph. No CLI yet.

### 1. Install dependencies

```bash
pnpm install
```

### 2. Build the plugin

```bash
pnpm -r build
```

That produces `packages/plugin/code.js` and `packages/plugin/ui.html` next to
the manifest.

### 3. Load the plugin in Figma desktop

1. Open **Figma desktop** (plugins can't be side-loaded in the browser).
2. From any file: **Menu → Plugins → Development → Import plugin from manifest…**
3. Select `packages/plugin/manifest.json`.
4. Run the plugin: **Plugins → Development → claude-to-figma**.

### 4. Build the sample

In the plugin window:

1. Copy the contents of `packages/ir/examples/sample.json`.
2. Paste into the textarea.
3. Click **Build**.

You should see a 1440×900 page frame with a header row (logo + nav) and a
grid of three card instances. The cards are real Figma component instances —
edit the master and all three update. Shared paint and text styles appear in
the local styles panel.

### Troubleshooting

- **`Missing fonts`** — install Inter Regular / Medium / Bold locally, or edit
  `sample.json` to point at fonts you have.
- **`IR validation failed`** — the status panel lists the first five zod
  issues with their JSON paths. Fix and re-paste.

## Development

```bash
pnpm install
pnpm -r typecheck        # tsc --noEmit across all packages
pnpm -r test             # vitest across all packages
pnpm -r build            # tsup + esbuild across all packages
pnpm lint                # biome check
pnpm lint:fix            # biome check --write
```

### Layout

```
.
├── biome.json
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── fixtures/                         # real Claude Design exports (gitignored)
└── packages/
    ├── ir/
    │   ├── src/schema.ts             # zod schemas + TS types
    │   ├── test/schema.test.ts
    │   └── examples/sample.json      # M1 round-trip fixture
    └── plugin/
        ├── manifest.json
        ├── esbuild.config.mjs
        └── src/
            ├── code.ts               # IR → Figma scene graph
            └── ui.html               # paste IR + Build
```

## License

MIT. See [LICENSE](./LICENSE).
