# Contributing to claude-to-figma

Thanks for considering it. This project is built milestone-by-milestone with
explicit verification gates, so the contribution flow is opinionated.

## Before you start

- The IR is the product — see [`docs/adr/0001-ir-as-product.md`](./docs/adr/0001-ir-as-product.md).
  Schema changes touch both halves and need extra care.
- Architectural decisions are in [`docs/adr/`](./docs/adr/). Read the
  relevant one before reworking the area it covers.
- Project status, milestone history, and what's open lives in
  [`docs/PROGRESS.md`](./docs/PROGRESS.md).
- Known things that don't work yet are in [`LIMITATIONS.md`](./LIMITATIONS.md).
  If your change addresses one, link to the entry in your PR.

## What we're looking for right now

- **Bug reports with a fixture.** The most useful issues land with a
  minimal HTML file under `fixtures/claude-design/` (gitignored, stays on
  your machine) and a `pnpm --filter @claude-to-figma/cli test:integration
  --report` output showing the failure.
- **Real-world Claude Design exports that break the converter.** Strip
  client / product info, drop the HTML in your local fixtures dir, and
  paste the report.
- **CSS coverage gaps.** See [`LIMITATIONS.md`](./LIMITATIONS.md). PRs
  that close a documented limitation are welcome — please update the
  entry, or remove it if the fix is complete.
- **Test-only PRs.** New fixtures and snapshot tests are always welcome.

## What we're not looking for right now

- Big architectural changes without a prior issue. The build is on a
  milestone schedule — surprise refactors slow down the next milestone.
  Open an issue first.
- Changes to the synthetic fixtures in `packages/cli/test/fixtures/`
  without a corresponding test reason. Those snapshots are load-bearing.
- New features from outside the milestone roadmap. M1–M8 are the
  scope; new feature work happens after M8 ships.

## Getting set up

```bash
git clone https://github.com/brianleach/claude-to-figma.git
cd claude-to-figma
pnpm install
pnpm -r build       # tsup (ir, cli) + esbuild (plugin)
pnpm -r test        # vitest across the workspace
pnpm -r typecheck   # tsc --noEmit
pnpm lint           # biome check
```

## Branch + commit conventions

- Branch off `main`. Name it `<area>-<short-name>`, e.g. `cli-fix-padding-shorthand`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) scoped
  by package: `feat(cli): ...`, `fix(plugin): ...`, `docs: ...`, `test(ir): ...`.
- Commit incrementally as you go. One giant squash commit at the end of a
  branch makes review hard.
- Tests are required for behavior changes. Snapshots are fine for "this
  fixture's IR shape changed" cases but not a substitute for unit-level
  assertions on the new behavior.

## Pull request flow

1. Open a draft PR early so I can flag scope concerns before you sink time
   into something I'd push back on.
2. Every PR runs the full gate set: `pnpm -r typecheck`, `pnpm -r test`,
   `pnpm -r build`, `pnpm lint`. CI must be green before merge.
3. Visual changes (anything that affects the Figma plugin's output)
   need a screenshot of the Figma render side-by-side with a browser
   render of the same source HTML.
4. Include a `Closes #N` line in the PR body if it fixes a tracked issue.

## License

By contributing, you agree that your contributions are licensed under the
MIT License (see [`LICENSE`](./LICENSE)).
