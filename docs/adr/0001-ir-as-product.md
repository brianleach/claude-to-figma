# 0001 — IR as the product

**Status:** accepted

## Context

We need to convert HTML/CSS exports from Claude Design into editable Figma
files. The naive approach is a single executable that parses HTML on one
side and calls the Figma Plugin API on the other.

But the two halves run in different processes (Node CLI vs in-Figma plugin
sandbox), depend on different APIs (DOM vs `figma.createFrame()`), and
have wildly different lifecycles. Coupling them produces a tool where
neither half can be replaced, swapped, debugged, or tested in isolation.

## Decision

We treat an **Intermediate Representation (IR)** as the project's product.

The IR is a typed JSON document — defined once via zod in `packages/ir`,
consumed identically by both halves of the pipeline:

```
HTML / CSS  →  CLI  →  IR (JSON)  →  Figma plugin  →  Figma file
```

Both halves are dumb. Each only depends on the IR schema, not on the
other half.

## Consequences

**+ Decoupling.** The CLI knows nothing about the Figma Plugin API. The
plugin knows nothing about HTML or CSS.

**+ Debuggability.** Every conversion produces a real file you can open,
diff, edit by hand, or commit as a fixture.

**+ Replaceability.** Swap the plugin for a Sketch / Penpot builder
later — only that half changes. Same IR, different consumer.

**+ Stable contract.** The schema carries an `IR_VERSION` and evolves
additively. Breaking changes bump the version; both halves type-check
against the same definition.

**− Schema work is upfront.** Designing the IR before either side is
finished requires holding two consumers in your head. The first
milestone (M1) was deliberately scoped so the IR schema lands before
either half is meaningfully complex.

**− Two hops in production.** The CLI writes a file, the plugin reads
it. Running end-to-end is two manual steps until M8 wraps a harness
around them.
