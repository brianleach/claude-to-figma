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
