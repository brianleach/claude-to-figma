# CLAUDE.md

Orientation for Claude Code (or any agent) picking this project up.

Read these files, in order, before editing anything:

1. [`docs/KICKSTART.md`](./docs/KICKSTART.md) — the prompt the project was
   built from. This is the specification. Most architectural decisions
   you might question are already answered here.
2. [`docs/PROGRESS.md`](./docs/PROGRESS.md) — current state: what's
   shipped (M1–M8), what's open, what's next.
3. [`docs/adr/`](./docs/adr/) — architectural decisions. Read the
   relevant one before reworking the area it covers.
4. [`LIMITATIONS.md`](./LIMITATIONS.md) — known gaps. If your change
   addresses one, reference the entry number in the PR.
5. [`CONTRIBUTING.md`](./CONTRIBUTING.md) — branch / commit / merge
   conventions (Conventional Commits, squash-merge per milestone,
   STOP-and-verify gates before tagging).

## Working conventions

- The IR (Intermediate Representation, defined in `packages/ir`) is the
  product. Both the CLI and the plugin serialize/deserialize it; they
  do not know about each other. Changes that cross the IR boundary
  need extra care — touch both halves, bump the schema if needed.
- Every milestone is a named git tag (`m1` … `m8`). Do not rewrite
  merged history. New work goes on a fresh branch, squash-merges to
  `main`, and tags on success.
- Tests are the verification contract. `pnpm -r test` should pass before
  any merge. Coverage skew is acceptable on boundary modules (Playwright
  wrapper, CLI entrypoint) because they're exercised via the harness.

If any of the above seems out of date, fix it in the same PR — docs
staleness is treated as a bug.
