# 0010 — Paint style names are role-aware

**Status:** accepted (supersedes the naming section of ADR 0005)

## Context

ADR 0005 names extracted paint styles by overall frequency:
`color/primary` = most-used colour, `color/secondary` = second-most,
`color/accent` = third. For the landing dogfood this produced:

- `color/primary` = `#F0EBE0` (body-page cream background) — useless
- `color/secondary` = `#1C1A16` (body text) — useless
- `color/accent` = `#B5471F` (CTA orange) — accidentally correct

A designer opening the Local Styles panel wants to reach for "the
brand orange" or "the body text colour" or "the card surface". The
frequency-only scheme named them by popularity contest rather than by
what they do. See gap #15 of `docs/quality-gap-report.md`.

## Decision

Track each unique colour's usage by **role**, not just total count:

- **background** — appears as a fill on a FRAME / INSTANCE
- **text** — appears as a fill on a TEXT
- **stroke** — appears as the paint of a Stroke on any node
- **icon** — appears as a fill or stroke on a VECTOR (one category,
  because icon fills and strokes are often the same brand colour and
  we don't want to split them across the `surface` / `ink` / `border`
  buckets)

After collection, each colour is assigned a role using two rules:

1. **Saturated colours → `brand/*`.** A colour whose RGB chroma
   (`max(r,g,b) − min(r,g,b)`, on a 0-1 scale) exceeds 0.15 is a
   brand / accent colour. Brand marks are typically saturated and
   recur on CTAs, icons, and marketing accents — a "most-used colour
   is brand" rule misfired on the landing dogfood because the
   cream body background had the highest count. Chroma-based
   classification puts `#B5471F` (CTA orange, chroma 0.59) in `brand`
   and leaves `#1C1A16` (body text, chroma 0.024) out of it. Top-N
   by usage fill `brand/primary`, `brand/accent`, `brand/secondary`.
2. **Neutral colours → dominant-role bucket.** Low-chroma colours
   — even when they span multiple roles like a dark ink used on
   text + stroke + the footer dark section's background — go to
   their most-used role's bucket:
   - `surface/primary` … `surface/tertiary` for backgrounds
   - `ink/primary` … `ink/muted` for text colours
   - `border/default` … `border/subtle` for strokes
   - `icon/primary` … (rare — usually folds into brand)

Pure white (`#ffffff`) and pure black (`#000000`) keep the
ADR 0005 special-case: `color/white` and `color/black` regardless
of frequency (these are almost always structural).

Everything past the top-N slots in each role falls back to
`color/{hex}` (same as ADR 0005's tail).

## Consequences

**+ The Local Styles panel reads like a real design system.**
`brand/primary`, `surface/primary`, `ink/primary`, `border/default`
are names a designer immediately maps to intent.

**+ Role assignment is deterministic from the IR.** Same tree in,
same names out — no human-in-the-loop naming.

**+ Extractor code becomes cleaner.** The "top 3 by frequency" list
that didn't distinguish kinds is replaced by per-role ranked lists;
easier to test and reason about.

**− Supersedes ADR 0005's naming section.** Old snapshot IRs named
`color/primary` / `color/secondary` / `color/accent` as popularity
winners; those snapshots need re-baselining. (The dedup + styleId
stamping mechanics from ADR 0005 are unchanged.)

**− The 0.15 chroma threshold is a tuned guess.** Catches `#B5471F`
(chroma 0.59) and rejects near-neutrals like `#1C1A16` (0.024). A
muted but still recognisably-coloured token like `#A89E8A` (chroma
0.09) would currently land in surface/ink. No principled
justification — tuned against the landing dogfood. Revisit if
real exports produce obviously-wrong classifications.

**− Order of listing in the Figma styles panel changes.** Styles
now group semantically (all `brand/*` together, all `surface/*`
together) instead of the legacy `color/*` prefix. Users who scripted
against style names need to update.
