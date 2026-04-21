# Example: claude-to-figma landing page

The dogfood test. The landing page for `claude-to-figma` itself was built
in [Claude Design](https://claude.ai/design), exported as HTML, converted
through this CLI, and rendered into Figma via the plugin.

If the converter can't build its own product page faithfully, that's a bug
worth fixing. So this example doubles as marketing material *and* as the
hardest end-to-end test we ship in the repo.

## Files

| File                                | What it is                                                  |
| ----------------------------------- | ----------------------------------------------------------- |
| `PROMPT.md`                         | The exact prompt fed to [Claude Design](https://claude.ai/design) to generate the page. Checked in so the build is reproducible. |
| `source.zip`                        | The original export zip, exactly as Claude Design produced it. |
| `source/`                           | The unzipped contents. This page is fully static — one `index.html` with inline `<style>` and no asset folder — so that's all that's in here. Richer exports (with `*.standalone.html`, `assets/`, etc.) belong in other examples. |
| `claude-to-figma.ir.json`           | The CLI's IR output. Open it to see what the converter detected: components, paint + text styles, layout. |
| `claude-to-figma.report.json`       | `--report` output — node count, components × instances, paint × text styles, warnings. |
| `claude-to-figma.fig`               | The Figma file produced by pasting the IR into the plugin. Double-click to open in Figma desktop. |
| `screenshots/browser.png`           | The page rendered in Chrome at 1440×900. |

No `screenshots/figma.png` yet — the current Figma render has visible layout
bugs and we'd rather surface those as fixes than ship a misleading screenshot.
The `.fig` is included so you can see the current state for yourself; the
browser screenshot is the fidelity target we're working toward.

## How to reproduce

From a fresh checkout:

```bash
pnpm install
pnpm -r build
pnpm exec playwright install chromium    # one-time

# print the font shopping list (so you know what to install in Font Book)
node packages/cli/dist/index.js fonts \
  examples/landing/source/index.html --hydrate

# convert (use --font-fallback Inter if you don't want to install)
node packages/cli/dist/index.js convert \
  examples/landing/source/index.html \
  -o /tmp/landing.ir.json \
  --report /tmp/landing.report.json \
  --hydrate

# Figma desktop → Plugins → Development → claude-to-figma
# paste the contents of /tmp/landing.ir.json → Build
```

## What this example tests

- **Static-HTML conversion on a real Claude Design export.** This page
  is purely static (no JS bundle, no runtime hydration), which means
  `--hydrate` is *not* required here. A future example should cover
  the `*.standalone.html` runtime-bundled shape.
- **Component detection on real-world repeats** — feature cards, nav
  items, social-link rows. Whatever the page uses.
- **Token extraction on a real palette** — primary/secondary/accent
  naming, custom Google Fonts.
- **Layout fidelity** — the Figma render should look like the browser
  render. Differences are the converter's bugs to file.

## M9 fidelity update

The artifacts in this directory were refreshed after the M9 fidelity
milestone. The concrete wins on this page:

- **Text dimensions.** 73 text leaves are measured inside headless
  Chromium (ADR 0006), so the hero heading now wraps correctly instead
  of overflowing a single 1152×149 line. Short nav items also size
  accurately (the heuristic over-estimated by ~10–13px each).
- **Borders and shadows.** 39 frames carry real `strokes` (e.g. the
  Figma-card outline), and the two `box-shadow: var(--shadow)` sites
  emit 6 DROP_SHADOW effects. Previously: `strokes: []` and
  `effects: []` literals.
- **Grid geometry.** All five grid sections (`.hero-grid`, `.steps`,
  `.editable-grid`, `.pipeline`, `.get-started-grid`) are
  HORIZONTAL + WRAP auto-layout frames with correct track widths
  (ADR 0008). Previously: block-stacked column with no grid semantics.
- **Max-width centering.** All six `.wrap` elements land at x=80 on a
  1440 viewport (= (1440 − 1280) / 2) — previously stuck at x=0.
- **Layer names.** `Page > Nav / Hero / Problem / How / Editable /
  Pipeline Section / Get Started / Footer` instead of `body > section >
  .wrap > .hero-grid`.

A screenshot-level diff against `screenshots/browser.png` and a
refreshed `.fig` will land once we manually re-run the plugin; the
pipeline output on this page is warning-free except for the offline
Google Fonts CDN block (expected — `--hydrate` runs `offline: true`
for security).

## Hosting

The page is live at
**[brianleach.github.io/claude-to-figma](https://brianleach.github.io/claude-to-figma/)** —
deployed automatically from `examples/landing/source/` by the
[`pages.yml`](../../.github/workflows/pages.yml) GitHub Actions
workflow on every push to `main` that touches the source files.

Locally: `open source/index.html` (or `python3 -m http.server` from
this directory if you need to test relative-asset behavior).
