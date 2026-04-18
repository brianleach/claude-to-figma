---
name: Bug report
about: Something converts wrong, the plugin crashes, or the output looks bad
title: "[bug] "
labels: bug
---

## What happened

<!-- One-paragraph summary. "The plugin crashed on ...", "The converted IR has 0 components when I expected 3 ...", etc. -->

## Reproduce

<!--
Attach a minimal HTML fixture if you can (gist, zipped repro, or inline below).
Real-world Claude Design exports are fine, but smaller is better.
-->

```bash
# The exact command you ran
node packages/cli/dist/index.js convert path/to/input.html -o /tmp/out.ir.json --hydrate
```

## Expected vs actual

- **Expected:** <!-- what you thought would happen -->
- **Actual:** <!-- what happened instead -->

## Environment

- `claude-to-figma` version / commit:
- Node version (`node --version`):
- pnpm version (`pnpm --version`):
- OS:
- Figma desktop version (if the bug is in the plugin):

## Relevant output

<!--
- CLI stderr (with `--verbose` if possible)
- `--report` JSON
- Plugin status panel screenshot
-->
