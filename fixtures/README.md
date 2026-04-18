# fixtures/

Drop real Claude Design HTML exports here for local testing.

Everything in this directory is **gitignored** except this README. That's
deliberate — real design exports may contain client or product information
that shouldn't land in a public repo. Use `packages/cli/test/fixtures/`
instead for synthetic fixtures that *are* committed and used by the
integration harness.

## Expected layout

```
fixtures/
├── README.md                     (this file, committed)
└── claude-design/
    ├── some-export/
    │   ├── index.html
    │   └── assets/
    └── another-export.html
```

The M8 integration harness (`pnpm --filter @claude-to-figma/cli test:integration`)
walks `fixtures/claude-design/`, runs conversion on each HTML it finds, and
reports stats.
