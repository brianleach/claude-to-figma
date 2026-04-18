# Kickstart prompt

This is the original project prompt that bootstrapped the `claude-to-figma`
build. It lives in the repo so the spec stays versioned alongside the code,
and so any later contributor (human or agent) can see what was asked for
verbatim.

If the spec evolves, edit this file and note the change in
[`PROGRESS.md`](./PROGRESS.md). Never rewrite history.

---

# Claude-to-Figma — Full Project Build

We're building `claude-to-figma`, an open-source TypeScript tool that converts HTML exports from Claude Design into fully editable Figma files with semantic structure (frames, auto-layout, components, design tokens).

## Why

Claude Design exports to Canva, PDF, PPTX, and HTML — but not Figma. Our team works in Figma. HTML is the richest export format (preserves DOM semantics, CSS, structure), so we're building HTML → Figma as a proper semantic converter, not a pixel-perfect rasterizer.

## Architecture

Monorepo, three packages:

1. `packages/cli` — Node CLI that parses HTML/CSS, computes layout, emits Figma IR (JSON)
2. `packages/plugin` — Figma plugin (TypeScript) that reads IR and constructs the Figma scene graph via the Plugin API
3. `packages/ir` — shared IR types (zod schemas + inferred TS types), imported by both

Pipeline: HTML export → CLI → IR JSON → Figma Plugin → Figma file

## Tech stack

- TypeScript everywhere, strict mode, noUncheckedIndexedAccess
- pnpm workspaces
- tsup for builds
- vitest for tests
- Biome for lint/format (no ESLint/Prettier)
- zod for IR schema definition and runtime validation

CLI dependencies (install only when needed per milestone):
- parse5 — HTML parsing
- lightningcss — CSS parsing and shorthand resolution
- yoga-layout — flexbox computation, maps cleanly to Figma auto-layout
- sharp — image processing
- commander — CLI framework
- ora + chalk — output

Plugin dependencies:
- @figma/plugin-typings
- esbuild for plugin bundling

## Git workflow — enforced at every milestone

Initialize git before any other work. The remote repo at https://github.com/brianleach/claude-to-figma.git is empty.

Initial setup (once):
1. `git init`
2. `git branch -M main`
3. Create thorough `.gitignore` (node_modules, dist, .DS_Store, .env, .turbo, *.log, coverage, .vscode except settings.json, figma plugin build outputs, fixtures/* except fixtures/README.md)
4. `git remote add origin https://github.com/brianleach/claude-to-figma.git`
5. After scaffolding: commit `chore: initial monorepo scaffold`, `git push -u origin main`

For each milestone:
1. Branch off main: `git checkout -b m{N}-{short-name}` (e.g. `m2-html-parser`)
2. Commit progress as you go with Conventional Commits (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`), scoped by package: `feat(ir): add frame node schema`. NOT one giant commit at the end.
3. When milestone verification passes (see Verification Gates below):
   - Merge to main with squash: `git checkout main && git merge --squash m{N}-{short-name} && git commit -m "feat(m{N}): {milestone summary}"`
   - Tag: `git tag -a m{N} -m "M{N}: {description}"`
   - Push: `git push && git push --tags`
   - Delete local branch: `git branch -D m{N}-{short-name}`
4. Move to next milestone.

Never commit: node_modules, dist, built plugin bundles, real Claude Design HTML samples (use fixtures/ dir, contents gitignored, with a README).

## Verification Gates — must pass before tagging and moving on

Each milestone has explicit verification. Do not skip. Do not move to next milestone until all gates pass. If a gate fails, fix and re-verify before committing the final milestone commit. If you cannot pass a gate after three genuine attempts, STOP and report what failed and why — do not continue to the next milestone.

Standard gates that apply to every milestone:
- G-TYPES: `pnpm -r typecheck` passes with zero errors
- G-LINT: `pnpm -r lint` passes (Biome check)
- G-TEST: `pnpm -r test` passes all tests, zero failing
- G-BUILD: `pnpm -r build` succeeds for all packages
- G-CLEAN: `git status` clean before tagging (no uncommitted changes, no untracked files that should be tracked)

Milestone-specific gates are listed under each milestone.

## IR design principles

The IR is the product. Both halves are dumb. Design it first, evolve it carefully.

Node types: `frame`, `text`, `image`, `vector`, `instance`
Every node: id, name, geometry or layout participation, fills, strokes, effects, children
Top-level: root node, styles (colors, text styles), components registry, font manifest

Key CSS → Figma mappings the IR must support:
- `display: flex` → auto-layout frame (VERTICAL / HORIZONTAL / WRAP)
- `gap` → itemSpacing
- `padding` → paddingTop/Right/Bottom/Left
- `justify-content` + `align-items` → primaryAxisAlign + counterAxisAlign
- `position: absolute` → layoutPositioning: "ABSOLUTE"
- Repeated subtrees → component + instances
- Unique colors/text styles → named styles in the styles registry

When extending the IR in later milestones, add fields additively. Never break existing IR JSON unless a major version bump is explicitly called for. Bump `version` field in IR when breaking.

## Milestones

### M1: IR + Plugin round-trip

Scope:
- pnpm monorepo with three packages, root tsconfig, Biome config, root package.json, MIT LICENSE
- `packages/ir`: full IR schema in zod, exported zod schemas + inferred TS types, JSDoc on each field, vitest tests for schema validation (valid + invalid)
- `packages/plugin`: Figma plugin (manifest.json, ui.html, code.ts). UI has a textarea to paste IR JSON and a "Build" button. On Build: validate with zod, pre-load fonts from IR font manifest, walk IR, create frame/text/image/instance nodes. Reports missing fonts as errors in UI.
- `packages/ir/examples/sample.json`: hand-written IR covering root frame (1440x900, vertical auto-layout, 24px padding, 16px gap), header frame (horizontal auto-layout, logo text + nav), grid of 3 card instances from one component definition (card: title, body, button using shared text styles)
- Root README: architecture overview, how to run M1 (how to load plugin in Figma desktop, how to paste sample IR)

Verification gates (in addition to standard):
- V-M1-SAMPLE: sample.json validates against zod schema (test covers this)
- V-M1-PLUGIN-BUILD: plugin bundle builds without errors via esbuild
- V-M1-PLUGIN-MANUAL: after you output manifest path, STOP and ask me to manually load the plugin in Figma desktop, paste sample.json, click Build, and confirm the scene graph renders correctly (root frame with auto-layout, header, 3 card instances with shared styles, fonts loaded). I will reply with "M1 verified" or describe what's wrong. Only proceed to commit/tag after I say verified.
- V-M1-PLUGIN-SIZE: plugin code under 1000 lines total (code.ts + ui.html + ui script)

### M2: CLI with trivial HTML

Scope:
- `packages/cli` scaffolded with commander
- Parse HTML with parse5 (inline styles only, no external/embedded CSS)
- Emit valid IR JSON for a page of nested divs with text
- No flex, no layout computation — nodes get absolute geometry from any inline width/height/top/left, or default to 0 sizing with a warning
- CLI: `claude-to-figma convert <input.html> -o <output.json>`
- vitest tests using snapshot testing for IR output on 3 fixture HTML files

Verification gates:
- V-M2-FIXTURES: 3 HTML fixtures in `packages/cli/test/fixtures/` (simple-divs.html, nested-divs.html, text-heavy.html)
- V-M2-SNAPSHOT: snapshot tests pass for all 3 fixtures
- V-M2-IR-VALID: generated IR from each fixture validates against zod schema (test this explicitly)
- V-M2-ROUNDTRIP: generated IR from simple-divs.html loads in plugin without errors — STOP and ask me to verify manually. I will reply "M2 verified" or describe issues.

### M3: CSS resolution

Scope:
- Add lightningcss integration
- Parse external `<link rel=stylesheet>` (resolve relative paths), `<style>` blocks, and inline styles
- Build minimal cascade: specificity (inline > id > class > element), source order tiebreaker, `!important` handling
- Implement inheritance for the standard inherited properties (color, font-*, line-height, text-align, visibility, letter-spacing, word-spacing)
- Resolve CSS custom properties (--var) at computed-value time
- Emit IR with computed styles applied

Verification gates:
- V-M3-CASCADE-TESTS: unit tests for cascade engine covering specificity, !important, inheritance, custom properties (minimum 15 tests)
- V-M3-FIXTURES: 2 new fixtures added (external-css.html + styles.css, cascade-edge-cases.html)
- V-M3-SNAPSHOT: snapshots pass for all fixtures (old + new)
- V-M3-ROUNDTRIP: STOP and ask me to verify external-css.html renders with correct colors/typography in Figma via plugin. Reply "M3 verified" or describe issues.

### M4: Yoga integration

Scope:
- Integrate yoga-layout (yoga-wasm-web for Node compatibility; verify the best current binding)
- Map computed CSS styles to Yoga Node styles
- Compute layout on the full tree, derive absolute geometry for every node
- Still emit geometry-only IR (no auto-layout yet) — every frame has explicit x/y/width/height
- Handle block and inline-block defaults; flex containers compute correctly but still emit as absolute-positioned children for now

Verification gates:
- V-M4-YOGA-TESTS: unit tests verify Yoga output matches expected box geometry for 5 layout scenarios (block stack, flex row, flex column, nested flex, padding/margin)
- V-M4-FIXTURES: 2 new fixtures (flex-basic.html, flex-nested.html) — geometry snapshotted
- V-M4-VISUAL: STOP and ask me to verify flex-basic.html in Figma matches browser rendering closely (positions within ~2px). Open the HTML in a browser side-by-side. Reply "M4 verified" or describe mismatches.

### M5: Flex → auto-layout mapping

Scope:
- When a node is `display: flex` or `display: inline-flex`, emit as auto-layout frame instead of absolute-positioned
- Map `flex-direction` → layoutMode (VERTICAL/HORIZONTAL)
- Map `gap`/`row-gap`/`column-gap` → itemSpacing / counterAxisSpacing
- Map `padding` → paddingTop/Right/Bottom/Left
- Map `justify-content` → primaryAxisAlignItems (START/CENTER/END/SPACE_BETWEEN)
- Map `align-items` → counterAxisAlignItems (START/CENTER/END/BASELINE/STRETCH)
- Map `flex-wrap: wrap` → layoutWrap: WRAP
- Children of auto-layout frames: layoutGrow, layoutAlign as appropriate
- `position: absolute` children inside flex parents → layoutPositioning: ABSOLUTE

Verification gates:
- V-M5-MAPPING-TESTS: unit tests for every flex → auto-layout mapping listed above (minimum 20 tests)
- V-M5-FIXTURES: 3 new fixtures (flex-justify-variations.html, flex-align-variations.html, flex-wrap.html)
- V-M5-VISUAL: STOP and ask me to verify in Figma that generated frames are editable as proper auto-layout (can add/remove children and layout responds correctly). Reply "M5 verified" or describe issues.

### M6: Component detection

Scope:
- After IR tree is built, traverse and hash subtree structure + class signature
- Identify repeats above a threshold (default: 3 instances, configurable via CLI flag)
- Promote to component definition + instances in IR
- Handle variants conservatively: only promote to same component if structure AND class sets match exactly. Do not attempt variant detection in M6.
- Component names: use most common class name on root, fallback to `Component{N}`

Verification gates:
- V-M6-DETECTION-TESTS: unit tests for subtree hashing, repeat detection, naming (minimum 10 tests)
- V-M6-FIXTURES: 2 new fixtures (card-grid.html with 6 identical cards, nav-with-items.html with 5 repeating nav items)
- V-M6-IR: generated IR has components registry populated, children are instance nodes referencing component IDs
- V-M6-PLUGIN: STOP and ask me to verify card-grid.html produces a real Figma component with instances (editing master updates all instances). Reply "M6 verified" or describe issues.

### M7: Token extraction

Scope:
- Collect unique colors across IR, deduplicate, emit as paint styles in IR styles registry
- Collect unique text style combos (family + weight + size + line-height + letter-spacing) as text styles
- Naming heuristic:
  - Colors: try to match known palette patterns (primary/secondary/accent via frequency), fallback to `color/{hex}` deterministic naming
  - Text: classify by size (heading/xl, heading/lg, heading/md, body/lg, body/md, body/sm, caption), fallback to `text/{size}-{weight}`
- Plugin: create PaintStyles and TextStyles in Figma, apply to nodes by reference

Verification gates:
- V-M7-EXTRACTION-TESTS: unit tests for color dedup, text style dedup, naming heuristics (minimum 15 tests)
- V-M7-IR: generated IR has styles registry populated, nodes reference styles by ID
- V-M7-PLUGIN: STOP and ask me to verify in Figma that shared styles are created in the local styles panel and applied to nodes. Reply "M7 verified" or describe issues.

### M8: Real-world testing

Scope:
- Create `fixtures/claude-design/` directory (gitignored) with README explaining users should drop real Claude Design HTML exports here
- Add integration test harness: for each HTML in fixtures/claude-design/, run conversion, validate IR, report statistics (node count, components detected, styles extracted, warnings)
- Add `--verbose` and `--report` CLI flags for debugging real exports
- Document known limitations in a LIMITATIONS.md at repo root
- Update README with complete usage docs, screenshots (placeholder), and a troubleshooting section

Verification gates:
- V-M8-HARNESS: integration harness runs without crashing on empty fixtures dir
- V-M8-DOCS: README complete with install, usage, troubleshooting; LIMITATIONS.md populated with at least 10 known limitations
- V-M8-REAL: STOP and ask me to provide a real Claude Design HTML export for end-to-end testing. I will either provide a fixture path or say "use a synthetic fixture". Run conversion, report stats, and I will verify Figma output. Reply "M8 verified" or we iterate.

## Constraints (global)

- TypeScript strict mode, no `any` without comment explaining why
- All IR types defined once in `packages/ir`, imported by both cli and plugin
- No Tailwind in the plugin UI — plain HTML/CSS to avoid bundle bloat
- Biome config at root, single config for all packages
- tsconfig strict + noUncheckedIndexedAccess
- MIT license in initial commit
- Conventional Commits throughout
- Never commit secrets, real fixture content, or build artifacts

## Execution rules

1. Follow milestones in order M1 → M8. Do not start a milestone before the previous is tagged.
2. Commit progress within a milestone as you go. Don't batch one giant commit.
3. At every STOP point in verification gates, halt and wait for my reply. Do not proceed past a STOP.
4. If a verification gate fails, fix and re-verify. Three genuine failed attempts on the same gate → STOP and report.
5. Ask before making architectural decisions not specified in this prompt.
6. If a dependency has changed significantly since your training data (e.g. yoga-layout has a new recommended binding), verify the current best option before installing.
7. After each milestone is tagged, output a one-paragraph summary of what shipped, then proceed to the next milestone automatically.

Begin with M1. Output the initial file tree, then implement.

---

## Deviations from the spec (documented)

**M1 (resolved 2026-04-18):** the bootstrap harness restricted pushes to a
single branch, so M1 was built on `claude/claude-to-figma-build-zTq1Q` rather
than the `m1-*` branch the spec calls for. After M1 verified, `main` was
created on the remote from that branch's HEAD and tagged `m1`. From M2
onward the standard per-milestone branch flow is in use; the bootstrap
branch is abandoned.
