# examples/

Real-world worked examples of `claude-to-figma`. Unlike `fixtures/` (which is
gitignored and exists for the user's own local testing), everything in here
is **committed** and serves as proof-of-concept material — what comes in,
what comes out, and what the in-between artifacts look like.

Each subdirectory is one example, with the same shape:

```
examples/<name>/
├── README.md                        what this example shows + how it was built
├── source/                          the original Claude Design export, unzipped
│   ├── index.html
│   ├── assets/
│   └── ...
├── source.zip                       the export zip (committed for reproducibility)
├── claude-to-figma.ir.json          CLI output (the IR document)
├── claude-to-figma.report.json      stats + warnings from `--report`
├── claude-to-figma.fig              the Figma file after Build (open in Figma desktop)
└── screenshots/
    ├── browser.png                  the original page rendered in Chrome
    └── figma.png                    the same page after Build in Figma (if render is faithful)
```

## Current examples

| Name                                    | What it shows                                            |
| --------------------------------------- | -------------------------------------------------------- |
| [`landing/`](./landing/)                | The `claude-to-figma` landing page — built in Claude Design, converted with this very tool. The dogfood test. |

## Adding a new example

1. Build the page in [Claude Design](https://claude.ai/design).
2. Export as a zip; drop the zip and the unzipped contents into a new
   `examples/<name>/source/` folder (zip alongside).
3. Run the converter with `--hydrate`:
   ```bash
   node packages/cli/dist/index.js convert \
     examples/<name>/source/index.html \
     -o examples/<name>/claude-to-figma.ir.json \
     --report examples/<name>/claude-to-figma.report.json \
     --hydrate
   ```
4. Paste the IR JSON into the Figma plugin and Build.
5. In Figma, `File → Save local copy…` and save as
   `examples/<name>/claude-to-figma.fig` so the rendered artifact is
   committed alongside the inputs.
6. Capture matching screenshots — same viewport — into
   `examples/<name>/screenshots/`. Skip `figma.png` if the current render
   has obvious bugs; better to ship no screenshot than a misleading one.
7. Write a short `README.md` explaining what the example demonstrates,
   what surprised you, and what you'd improve about the converter
   based on what you learned.
