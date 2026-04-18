# Prompt to feed Claude Design

Copy everything below the `---` line into [claude.ai/design](https://claude.ai/design) verbatim. This is the prompt used to generate the landing page that lives in `source/`. It's checked in so the build is reproducible — if you regenerate the page later, start from the same prompt.

---

Design a single-page landing page for an open-source TypeScript tool called **claude-to-figma**.

## What the product does

It converts HTML exports from [claude.ai/design](https://claude.ai/design) into fully editable Figma files — real frames, real auto-layout, real components, real design tokens. Not a screenshot. Not a raster trace. A proper semantic translation from the DOM into Figma's scene graph.

The pipeline is: Claude Design HTML → CLI (parse5 + cascade engine + yoga layout + flex → auto-layout mapper + component detection + token extraction) → IR JSON → Figma plugin → editable Figma file.

## Audience

Designers and product engineers who use Claude Design to spec a UI quickly, then need to bring it into Figma to iterate. Today they screenshot and lose every component, style, and layout. They're frustrated and they're the ones who'll install this tool.

## Sections to include

1. **Hero**
   - Tagline: "Your Claude Design exports, editable in Figma."
   - Sub: "Real frames, real auto-layout, real components — not a screenshot."
   - Primary CTA: "View on GitHub" → links to a placeholder GitHub URL
   - Secondary CTA: "How it works" → anchor link to the section below
   - Visual: a small before/after — "screenshot in Figma" (greyed out, locked icon) vs "components in Figma" (color, with a layers panel mock showing a Card master + 3 instances)

2. **The problem**
   - Headline: "Claude Design exports to Canva, PDF, PPTX, and HTML — but not Figma."
   - One short paragraph explaining the workflow gap: design teams live in Figma; the obvious workaround is "screenshot the HTML and paste the PNG," but that produces a dead artifact. No editable text, no swappable components, no design system carry-over. The moment a designer wants to iterate, they rebuild the entire thing by hand.

3. **How it works** (3 steps in a horizontal row, each with a small icon and 2-3 lines of copy)
   - Step 1: **Export from Claude Design** — Standard HTML export, no special setup.
   - Step 2: **Run the CLI** — `claude-to-figma convert page.html -o page.ir.json --hydrate`. One command. Resolves CSS, computes layout, detects components, extracts design tokens.
   - Step 3: **Paste into the Figma plugin** — The plugin builds a real scene graph: frames, auto-layout, components with text overrides, paint and text styles in the local styles panel.

4. **What "fully editable" means** (a 4-card grid, each card has a small icon + bold heading + 1-2 lines of copy)
   - **Frames, not raster images.** Every `<div>` becomes a `FrameNode`. Change the text — it stays text.
   - **Auto-layout that works.** `display: flex; gap: 16px; justify-content: space-between` becomes a horizontal auto-layout frame. Drop a child in and Figma lays it out.
   - **Components, not duplicates.** Six identical card markups become one Card component plus six instances. Edit the master, all six update.
   - **Named design tokens.** Repeated colors become `color/primary`. Repeated text combos become `heading/lg`, `body/md`. They show up in Figma's local styles panel.

5. **The pipeline** (a clean horizontal diagram, like a step-by-step)
   - Boxes labeled: `Claude Design HTML` → `CLI (parse5 + lightningcss + yoga + cascade engine)` → `IR JSON` → `Figma plugin` → `Editable Figma file`
   - Caption underneath: "Both halves are dumb. The IR is the product. Swap the plugin for a Sketch or Penpot builder later — only that half changes."

6. **Get started**
   - Show a code block with three lines:
     ```
     git clone https://github.com/brianleach/claude-to-figma
     cd claude-to-figma && pnpm install && pnpm -r build
     node packages/cli/dist/index.js convert your-export.html -o page.ir.json --hydrate
     ```
   - Below the block: small links to `README`, `LIMITATIONS`, `CONTRIBUTING`, and the Figma plugin install instructions.

7. **Footer**
   - Left: "MIT-licensed · Built in Claude Design · Converted with claude-to-figma." (a self-referential note — the page itself is the proof)
   - Right: links to GitHub, the Figma Community plugin (placeholder), and a "report an issue" link.

## Design direction

- **Tone:** confident, technical, dry. Talks to engineers and designers, not VCs. No "transform your workflow" / "supercharge your team."
- **Type:** a serif display face for the hero (Fraunces or Newsreader), a clean sans for body (DM Sans, Inter, or Space Grotesk). Generous size contrast.
- **Color:** neutral palette, one accent color. Earthy / cream background (not pure white) gives it warmth. Dark accent for key UI moments. Avoid Figma's default purple.
- **Layout:** desktop-first, ~1440 wide content area. Heavy use of horizontal whitespace. Sections breathe. Each section is one clear idea.
- **Imagery:** vector / geometric — small icons for the feature cards, a hand-drawn-looking pipeline diagram, mock Figma layers panel for the hero. No photography.
- **No motion / no JavaScript-only widgets.** Static content only. Anything fancy will be lost in the conversion to Figma — and the whole point is to prove the conversion works.

## Anti-goals

- No carousel, no parallax, no "as seen in" logo bar.
- No pricing section. The project is open-source, free.
- No newsletter signup, no email gate, no testimonials.
- No "trusted by [list of fake companies]." Don't fabricate social proof.
- Don't over-design — the page should look polished but boring enough that the converter has a fair shot at faithfully reproducing it.

The output of this design will be processed by `claude-to-figma` itself as a real-world end-to-end test. If something doesn't convert well, that's a useful bug to surface — so do design naturally, don't trim things you suspect won't convert. We want to see what breaks.
