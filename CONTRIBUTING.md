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

## AI Contributions

> Heavily inspired and influenced by [Ghostty's AI policy](https://github.com/ghostty-org/ghostty/blob/main/AI_POLICY.md).

This project itself was bootstrapped using AI tools — the original
prompt that produced the M1–M8 build is checked in at
[`docs/KICKSTART.md`](./docs/KICKSTART.md). So we're not anti-AI. But
we are anti-low-effort, and AI without human judgment in the loop tends
to produce exactly that.

A few rules for AI-assisted contributions:

- **All AI usage in any form must be disclosed.** Name the tool you
  used (Claude Code, Cursor, Amp, Copilot, etc.) in the PR description,
  along with how the work was AI-assisted (e.g. "scaffolded by Claude
  Code, then hand-edited and tested," vs. "generated end-to-end with
  minimal review").

- **AI-driven PRs are only accepted against an existing issue.**
  Drive-by AI PRs that don't reference an accepted issue will be closed.
  If AI use isn't disclosed but a maintainer suspects it, the PR will
  be closed. Open a discussion or attach to an existing one if you want
  to share exploratory AI-generated code.

- **AI-assisted PRs must be fully verified by you, the human.** Don't
  submit hypothetically correct code. Run `pnpm -r typecheck && pnpm -r test
  && pnpm lint`. If your change touches the Figma plugin, build it and
  verify in Figma. If your change touches the converter, run it
  end-to-end on a real fixture. Don't write code for surfaces you
  can't manually test.

- **Issues and discussions can use AI assistance, but require a
  human-in-the-loop.** AI-generated content must be reviewed *and
  edited* by a human before submission. AI tends to be verbose and
  noisy — trim it down. Maintainer time is the scarce resource.

- **No AI-generated media.** Text and code only. No AI-generated
  screenshots, diagrams, logos, audio, or video.

These rules apply to outside contributions. Maintainers may use AI at
their own discretion (and disclose accordingly in commit messages or PR
descriptions).

### There are humans here

Every issue and PR is read by humans. Approaching that boundary with
unverified, low-effort, AI-spit-out work is rude — it shifts the
verification burden from you to the maintainer. Please don't.

## License

By contributing, you agree that your contributions are licensed under the
MIT License (see [`LICENSE`](./LICENSE)).
