# Limitations

Known things that don't work, work poorly, or work differently than you might
expect. Recorded honestly so designers and developers can decide whether the
output is good enough for their workflow before investing time in it.

The list reflects the M1–M8 build. New limitations get appended; nothing is
removed unless an explicit fix lands.

---

## CSS coverage

1. **Selector subset.** The cascade matcher supports type, `.class`,
   `#id`, descendant (` `), child (`>`), and static pseudo-classes:
   `:root`, `:first-child`, `:last-child`, `:first-of-type`,
   `:last-of-type`, `:only-child`, `:only-of-type`, `:empty`.
   Interactive pseudo-classes (`:hover`, `:focus`, `:active`),
   parenthesised pseudos (`:nth-child(...)`, `:not(...)`), attribute
   selectors (`[type="text"]`), and sibling combinators (`+`, `~`)
   are still recognised by the specificity scorer but never match,
   so rules using them silently don't apply. See ADR 0002.

2. **Limited CSS shorthand expansion.** `padding`/`margin` (1–4 value),
   `border:` and per-side `border-{top|right|bottom|left}:`, plus `box-shadow:`
   and `filter:`/`backdrop-filter:` (blur only) are expanded via the
   cascade-time registry (ADR 0007). Everything else — `font:`,
   `background:`, `transition:`, `animation:`, … — is still treated as
   opaque and only the longhands the cascade engine looks up by name
   take effect.

3. **`@media`, `@supports`, `@keyframes` and other at-rules are ignored.**
   The cascade engine only handles top-level style rules. Responsive
   stylesheets get their first matching ruleset applied as if no media
   query existed.

4. **CSS units: `px`, `%`, `rem`, `vw`, `vh` work.** `rem` resolves
   against the `:root` / `html` element's computed `font-size` (default
   16, honoured explicit `html { font-size }` overrides). `vw`/`vh`
   resolve against the convert-time viewport — 1440×900 unless the CLI
   was invoked with `--viewport WxH`. `em` is still only supported for
   `letter-spacing` (converted to Figma's PERCENT, which is also
   font-size-relative); `em` in other properties needs element-local
   context the parser doesn't thread yet. `ch`, `calc(...)`, `vmin`,
   `vmax`, container-query `cqw/cqh/cqi/cqb`, and unitless lengths
   (except `0`) still resolve to undefined and drop silently.

## Layout

5. **Text measurement is a heuristic unless `--hydrate` is used.** With
   `--hydrate`, every text-leaf element is measured inside headless
   Chromium via `getBoundingClientRect()` + `Range.getClientRects()` —
   accurate for any font the browser can resolve, including variable-font
   axes (`opsz`, `wght`), ligatures, kerning, and CSS
   `letter-spacing`/`text-transform`. See ADR 0006. Without `--hydrate`,
   the M4 fallback (`chars × fontSize × 0.55`, line-height `fontSize ×
   1.2` for `auto`) still runs and drifts visibly on non-Inter fonts.

6. **Block elements are emitted as flex columns in yoga.** That gets
   children stretching to parent width like real CSS block layout, but
   it also means the IR walker sees `display: block` as essentially a
   flex column for layout-computation purposes. Edge cases where block
   and flex layout differ (e.g. inline-level wrapping, table layout,
   float behavior) render incorrectly.

7. **Grid support is flex-wrap-equivalent, not true grid.** `display:
   grid` + `grid-template-columns` flows through the flex-wrap pipeline
   (ADR 0008) — a grid becomes a horizontal flex-wrap container with N
   cells per row where N is parsed from the track list. `repeat(N, …)`,
   space-separated track lists, and mixed `1fr`/`Npx`/`auto` all count
   correctly. Per-track sizing is flattened: `1fr 2fr 1fr` collapses to
   three equal tracks; weighted fr values and mixed fixed/fluid tracks
   lose fidelity. `grid-template-areas`, `grid-column: span N`,
   `grid-row: span N`, and `grid-auto-flow: dense` are not supported —
   span-placed cells wrap into the next track instead of spanning.
   Grid track sizing needs a known container width — nested grids
   inside containers with no CSS width fall back to yoga's default
   intrinsic sizing, which can be wrong. `display: table*` and
   `column-count` remain unsupported.

8. **`justify-content: space-around` and `space-evenly` collapse to
   `SPACE_BETWEEN`** in the auto-layout mapping. First-paint geometry
   matches CSS exactly because yoga computes it; subsequent edits in
   Figma redistribute children as if they were `space-between`. See
   ADR 0003.

## Components

9. **Outer patterns only.** When a `Card` containing 3 `Button`s appears
   3 times, M6 promotes `Card` to a component (3 instances) and leaves
   the buttons inside the master alone. Nested-component detection is
   deferred to a later milestone.

10. **No image overrides.** The IR's `INSTANCE.overrides` schema only
    carries text overrides (`{ characters }`). When detection collapses
    several images-with-different-`src` attributes into one component,
    every instance silently uses the master's image. Acceptable for
    M6 fixtures (identical cards) but a real limitation for cards-with-
    different-thumbnails patterns.

11. **No variant detection.** Two structurally similar components that
    differ only by a fill or text style become *separate* components,
    not a single component with a variant. KICKSTART explicitly defers
    variant work to a later milestone.

## Tokens

12. **"Most frequent" isn't intent.** The color most used in the
    document might be a divider or border, not the brand color. The
    primary/secondary/accent assignment is based on usage frequency, not
    semantic meaning. White and black are special-cased; everything else
    is best-effort. See ADR 0005.

13. **Text-style buckets are size-based only.** Two distinct headings
    both at 18px Bold get `heading/md` and `text/18-bold` respectively
    (the second loses the human-friendly bucket). The classifier doesn't
    look at element role (h1 vs h2), only the resolved style.

14. **Effect styles are promoted; stroke paints now link to shared
    PaintStyles; stroke weight/align stay inline.** Identical drop/inner
    shadows and blurs collapse to shared entries in `styles.effects`
    with `effectStyleId` references on every matching FRAME (ADR 0011).
    Naming follows the largest-radius bucket (`shadow/sm`, `shadow/md`,
    `shadow/lg`, `shadow/xl`, with `blur/*`, `backdrop-blur/*`, and
    mixed `fx/*` families; `-2`, `-3` suffixes on collision). Stroke
    paints now land in the paint-style registry via the border-role
    bucket (ADR 0010) AND each stroked FRAME / VECTOR carries a
    `strokeStyleId` pointing at that PaintStyle — edit one `border/default`
    colour, every linked stroke updates. Stroke **weight + align** still
    live inline on every `Stroke` object because Figma's PaintStyle API
    does not carry them; two frames with the same border colour but
    different widths still need two separate weight values on the nodes.

    Non-blur `filter:` functions (`saturate`, `contrast`, `brightness`,
    `hue-rotate`, `invert`, `grayscale`, `sepia`, `drop-shadow-as-filter`)
    have no Figma equivalent and are silently dropped. Per-edge stroke
    fidelity (`border-top: 2px; border-bottom: 1px;`) collapses to a
    single stroke using the first side that has all three triple
    components set — per-edge Figma strokes would need a schema
    extension.

## Other

15. **Single fill per node; gradient-enabled.** `SOLID`, `GRADIENT_LINEAR`,
    and `GRADIENT_RADIAL` paints are extracted (ADR 0009). Angle / direction
    keyword / `turn` / `rad` / `grad` units + positioned or evenly-distributed
    stops are all handled. Radial gradient shape / size / position is parsed
    and discarded (Figma's default ellipse-at-centre is used). Multi-value
    `background:` with layered gradients collapses to the first one. `IMAGE`
    paints from `background-image: url(...)` still aren't resolved. The token
    extractor only registers and references the first SOLID fill — gradients
    stay inline on each node for now.

16. **SVG support covers path + basic shapes.** The walker collects
    every `<path d>` inside an `<svg>` (including nested in `<g>`
    groups) and synthesises path data for `<rect>` (including `rx`/`ry`
    rounded corners), `<circle>`, `<ellipse>`, `<line>`, `<polygon>`,
    and `<polyline>`. All of these are concatenated into one VECTOR
    node per `<svg>`. Still unsupported: gradient definitions (`<defs>`
    paints), `<mask>`, filters, `<use>` references, per-shape fill /
    stroke attributes (they land on the VECTOR but only the node-wide
    paint applies), and text rendering (`<text>`, `<tspan>`). SVGs
    that rely on any of those will render partially.

17. **Fonts must be installed locally before opening the plugin.**
    The IR's font manifest lists family + style; the Figma plugin
    calls `figma.loadFontAsync(...)` to load them from the user's
    local system fonts. The Figma Plugin API has **no font-installation
    surface** — plugins can only USE existing system fonts, not add
    new ones. Source HTML loaded from `<link href="fonts.googleapis.com
    /...">` doesn't help: those URLs are CDN references the browser
    fetches at render time, not actual font files in the export.

    A real Claude Design landing page typically uses 3–6 Google Fonts
    (Fraunces, DM Sans, JetBrains Mono, Space Grotesk, Newsreader,
    Bricolage Grotesque, Instrument Serif, ...). Workflow:

    1. **`claude-to-figma fonts <input.html> --hydrate`** prints the
       exact `family: weight, weight, ...` shopping list.
    2. Install each from [fonts.google.com](https://fonts.google.com).
       On macOS: download → unzip → drag the `*.ttf` files into
       **Font Book**. Restart Figma desktop after install.
    3. Then `convert` and paste into the plugin.

    **Don't want to install?** `--font-fallback <Family>` rewrites
    every font reference in the IR to a single family of your choice
    (typically `Inter` since it ships with most systems). The page
    will render with the wrong type but the layout, components, and
    colors all work — useful for a quick first look. Lossy by design;
    fix the typography in Figma after.

18. **Plugin must be side-loaded.** Figma plugin development side-
    loading only works in the Figma desktop app; the browser app can't
    import a plugin from a manifest. Until the plugin lands in the
    Figma Community, end users need the desktop app.

19. **Claude Design HTML exports are runtime-rendered — use `--hydrate`.**
    Both export formats observed as of 2026-04-18 ship as runtime-
    hydrated apps, not static markup:
    - `*.standalone.html` — a thin wrapper (loading toast + placeholder
      SVG + multi-megabyte `<script type="__bundler/...">` payload).
      The page is built in the DOM by the bundler at runtime.
    - `*.html` (the non-standalone version) — a small React app loading
      React + Babel from unpkg, rendering JSX into `<div id="root">`
      at runtime. The 200+ `<div>`s you see in the source are *inside
      JSX template strings*, not in the DOM.

    Without `--hydrate` the converter sees only the wrapper (~4–15 IR
    nodes) and misses the entire app. **Pass `--hydrate` to pre-render
    the file in headless Chromium and parse the post-render DOM** —
    measured ~400 nodes / 10 components / 14 paint × 36 text styles
    on a typical landing page (vs ~4 nodes without). Requires
    `playwright` + `pnpm exec playwright install chromium` (~100 MB
    one-time browser download); the CLI surfaces a clear error if
    either is missing.

---

## Reporting a limitation

If something doesn't work that isn't on this list, drop the offending HTML
into `fixtures/claude-design/`, run `pnpm --filter @claude-to-figma/cli
test:integration --report`, and file an issue with the per-fixture report
attached. The report is anonymised stats only — the HTML stays on your
machine.
