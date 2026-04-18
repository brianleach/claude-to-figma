# 0002 — postcss instead of lightningcss for CSS parsing

**Status:** accepted

## Context

The original project spec (`docs/KICKSTART.md`) calls for `lightningcss`
as the CSS parser. lightningcss is fast, written in Rust, and has a
strong shorthand-resolution story.

The M3 cascade engine needs three things from a CSS parser, in order of
importance:

1. Parse CSS text into rules with selectors and declarations.
2. Recover the raw string value of every declaration, so the value
   parsers (`parsePx`, `parseColor`, …) introduced in M2 can consume them
   unchanged.
3. (Bonus, but not needed for M3) expand shorthands like `padding: 8px
   16px` into longhands.

lightningcss exposes a typed value AST: each declaration's value is a
discriminated union over `Length`, `Color`, `Function`, `Ident`, etc.
Recovering the original string means writing a per-property serializer.

## Decision

Use **postcss** in `packages/cli/src/cascade/parse.ts`. postcss returns
`decl.value` as the original CSS string, which the M2 value parsers
consume directly.

lightningcss can be added in a later milestone if shorthand expansion
or transform-based optimization becomes useful.

## Consequences

**+ Trivial integration.** The cascade engine treats every declaration
as `{ property, value, important }` strings — same shape as the M2
inline-style parser produced.

**+ No serialization layer to maintain.** Adding a new CSS property is
a one-liner in the value parsers; no need to teach a serializer about
the new value type.

**+ Mature ecosystem.** postcss is the de facto CSS AST in the JS world.

**− No automatic shorthand expansion.** When we need `padding: 8px 16px`
expanded to four longhands, the cascade engine handles it in user
code (see `packages/cli/src/layout/auto-layout.ts`'s `expandShorthand`).
Painful for `font:` shorthand — flag for revisit if Claude Design
exports use it.

**− Heavier than lightningcss for parsing.** postcss is fast enough at
M2/M3 scale (single-digit milliseconds per fixture); not a concern
until we benchmark on real exports.
