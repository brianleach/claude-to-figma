# 0005 — Naming heuristic for extracted paint and text styles

**Status:** accepted

## Context

M7 extracts every unique color and text-style combo into the IR's
`styles.paints` / `styles.texts` registries. Every node that uses one
ends up with `fillStyleId` / `textStyleId` pointing at the registered
entry, and the Figma plugin renders those as real PaintStyles and
TextStyles.

The names in those registries are what shows up in Figma's local
styles panel. Bad names (`color/abc123`, `text/14-regular`) are
unhelpful for designers; aspirational names (`color/primary`) require
guessing intent we don't have.

The KICKSTART asks for a heuristic with two layers:

> Naming heuristic:
> - Colors: try to match known palette patterns (primary/secondary/accent
>   via frequency), fallback to color/{hex} deterministic naming
> - Text: classify by size (heading/xl, heading/lg, heading/md, body/lg,
>   body/md, body/sm, caption), fallback to text/{size}-{weight}

## Decision

### Colors

1. **Pure white (`#ffffff`) → `color/white`.** Pure black (`#000000`)
   → `color/black`. Both are special-cased *regardless of frequency*
   because they're nearly always structural (background / text body)
   and naming them `color/primary` would mislead.
2. **Of the remaining colors, the top 3 by usage count get `color/
   primary`, `color/secondary`, `color/accent`.** Ties broken by
   ascending hex.
3. **Everything else: `color/{6-char-hex}`.** When alpha < 1, append
   the alpha hex pair: `color/12345680` for `rgba(0x12, 0x34, 0x56,
   0.5)`.

### Text styles

Bucket by `font-size`, with weight nudging styles into the heading
family at the boundary:

| Size              | Weight        | Bucket       |
| ----------------- | ------------- | ------------ |
| ≥ 32              | any           | `heading/xl` |
| ≥ 24, < 32        | any           | `heading/lg` |
| ≥ 18, < 24        | any           | `heading/md` |
| ≥ 16, < 18        | bold-ish (≥ Semi Bold) | `heading/md` |
| ≥ 16, < 18        | regular       | `body/lg`    |
| ≥ 14, < 16        | any           | `body/md`    |
| ≥ 12, < 14        | any           | `body/sm`    |
| < 12              | any           | `caption`    |

Collisions: when two distinct text styles bucket to the same name,
the most-frequent one keeps the bucket name; the rest fall back to
`text/{size}-{weight-slug}` (e.g. `text/14-bold`, `text/14-italic`).
That keeps every id unique and deterministic.

## Consequences

**+ Reads naturally in Figma.** A designer browsing the local styles
panel sees `color/primary`, `heading/lg`, `body/md` and understands
intent immediately.

**+ Deterministic.** Same input → same names. Snapshot-stable across
runs; no sort-key surprises.

**+ Honest fallback.** When the heuristic genuinely can't pick a
better name, it doesn't lie — `color/2563eb` says exactly what it is.

**− Frequency ≠ intent.** "Most frequent color" might be a divider
or a border, not the brand color. Mitigated by special-casing
white/black (the most common offenders); residual risk accepted for
now.

**− Bucket boundaries are approximate.** A design system with two
distinct heading sizes both at 18px would push the second into
`text/18-...` rather than its own heading bucket. Acceptable for M7
fixtures; revisit if real Claude Design exports stress this.

**− No semantic input.** The heuristic only sees the IR — it doesn't
know which color is the brand, which text is a CTA. M8+ may surface
a config to override names per id.

## Reference

`packages/cli/src/extract/colors.ts` and `text-styles.ts` — the rules
live there. Tests in `packages/cli/test/extract.test.ts` lock the
boundaries by example.
