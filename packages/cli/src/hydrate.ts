/**
 * Pre-render an HTML file in headless Chromium and return the post-render
 * DOM. Used when the input is a runtime-hydrated app (Claude Design's
 * `*.standalone.html` and React-rendering `*.html` formats both
 * qualify) — the static markup is a wrapper, the real markup only
 * exists after the JS runs.
 *
 * playwright is dynamically imported so the rest of the CLI stays
 * usable when --hydrate isn't requested. The browser binary is a
 * separate ~100 MB install (`pnpm exec playwright install chromium`)
 * — we surface a clear error if it's missing.
 *
 * Security: `--hydrate` runs arbitrary JavaScript from the input HTML
 * inside Chromium. The loaded page is isolated by `offline: true` (so
 * it can't exfiltrate anything via `fetch` / `XHR` / form POST) and a
 * route blocker that only permits `file://` and `data:` requests. Still,
 * don't point `--hydrate` at HTML from a source you don't trust — the
 * Chromium sandbox isn't impenetrable, and `file://` reads of sibling
 * assets are allowed by design.
 */

import { resolve } from 'node:path';

export interface HydrateOptions {
  /** Hard timeout for `page.goto` in ms. Default 15000. */
  timeoutMs?: number;
  /** Extra wait after networkidle in ms — useful for late hydration / animations. Default 250. */
  settleMs?: number;
  /** Override the navigation `waitUntil`. Default 'networkidle'. */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  /** Browser viewport width in pixels. Default 1440 (typical desktop landing-page breakpoint). */
  viewportWidth?: number;
  /** Browser viewport height in pixels. Default 900. */
  viewportHeight?: number;
}

export async function hydrateHtml(htmlPath: string, opts: HydrateOptions = {}): Promise<string> {
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error(
      'playwright is required for --hydrate. Install it with: pnpm add -D playwright (then `pnpm exec playwright install chromium` to grab the browser binary).',
    );
  }

  const browser = await chromium.launch();
  try {
    // `offline: true` kills fetch / XHR / WebSocket / form POST — the page
    // can't phone home. Route blocker below refuses everything that isn't
    // file:// or data: (defense in depth, in case offline misses anything).
    const context = await browser.newContext({
      offline: true,
      viewport: {
        width: opts.viewportWidth ?? 1440,
        height: opts.viewportHeight ?? 900,
      },
    });
    await context.route('**', (route) => {
      const url = route.request().url();
      if (url.startsWith('file://') || url.startsWith('data:')) {
        return route.continue();
      }
      return route.abort();
    });
    const page = await context.newPage();
    try {
      await page.goto(`file://${resolve(htmlPath)}`, {
        waitUntil: opts.waitUntil ?? 'networkidle',
        timeout: opts.timeoutMs ?? 15_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Executable doesn't exist")) {
        throw new Error(
          'playwright browser binary missing. Run: pnpm exec playwright install chromium',
        );
      }
      throw err;
    }
    if (opts.settleMs && opts.settleMs > 0) {
      await page.waitForTimeout(opts.settleMs);
    }
    return await page.content();
  } finally {
    await browser.close();
  }
}
