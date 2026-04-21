# Architecture Decision Records

Short, append-only notes capturing decisions that shaped this project. New
ADRs go at the bottom — never edit a past one in place; supersede it with a
new entry instead.

Each record uses the same shape:

```
# NNNN — Title

**Status:** accepted | superseded by NNNN | deprecated

## Context
What problem we were facing, what constraints existed.

## Decision
What we chose and (briefly) what we considered instead.

## Consequences
What changes — good and bad — that decision implies.
```

## Index

| #    | Title                                                              | Status   |
| ---- | ------------------------------------------------------------------ | -------- |
| 0001 | [IR as the product](./0001-ir-as-product.md)                       | accepted |
| 0002 | [postcss instead of lightningcss for parsing](./0002-postcss-vs-lightningcss.md) | accepted |
| 0003 | [`space-around` / `space-evenly` collapse to `SPACE_BETWEEN`](./0003-space-around-collapses-to-space-between.md) | accepted |
| 0004 | [What goes into the component-detection hash](./0004-component-detection-hash-rules.md) | accepted |
| 0005 | [Naming heuristic for extracted paint and text styles](./0005-token-extraction-naming.md) | accepted |
| 0006 | [Text measurement via headless Chromium during `--hydrate`](./0006-text-measurement-via-hydrate.md) | accepted |
| 0007 | [Shorthand expansion lives in a cascade-time registry](./0007-shorthand-registry.md) | accepted |
| 0008 | [`display: grid` maps to flex-wrap, not to synthesized row frames](./0008-grid-as-flex-wrap.md) | accepted |
| 0009 | [Gradient paints as IR-level first-class paints](./0009-gradient-paints.md) | accepted |
| 0010 | [Paint style names are role-aware](./0010-role-aware-paint-names.md) | accepted |
