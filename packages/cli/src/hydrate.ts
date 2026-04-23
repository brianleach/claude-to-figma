/**
 * Pre-render an HTML file in headless Chromium and return the post-render
 * DOM. Used when the input is a runtime-hydrated app (Claude Design's
 * `*.standalone.html` and React-rendering `*.html` formats both
 * qualify) — the static markup is a wrapper, the real markup only
 * exists after the JS runs.
 *
 * While we have Chromium up, we also measure every text-leaf element
 * (see ADR 0006). Yoga's text-measure heuristic (`0.55 × fontSize ×
 * chars`) drifts visibly on non-Inter fonts; a `getBoundingClientRect()`
 * from the real shaper gives us accurate width/height/line-count for
 * free. Each measured element is stamped with `data-c2f-mid="mN"` so
 * the parse5-side walker can key into the returned map.
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

export interface TextMeasurement {
  width: number;
  height: number;
  lineCount: number;
}

/**
 * A single snapshotted DOM element — one author-marked decorative region
 * rendered via `element.screenshot()` into a PNG and embedded as a data
 * URI. The CLI swaps the subtree for a single IMAGE IR node so the
 * Figma plugin can paste a pixel-perfect asset in place of the tree.
 */
export interface SnapshotResult {
  dataUri: string;
  width: number;
  height: number;
}

export interface HydrateResult {
  /** Post-render HTML, including `data-c2f-mid` / `data-c2f-sid` stamps. */
  html: string;
  /** Keyed by the element's `data-c2f-mid` attribute. */
  textMeasurements: Map<string, TextMeasurement>;
  /** Keyed by the element's `data-c2f-sid` attribute. */
  snapshots: Map<string, SnapshotResult>;
}

export async function hydrateHtml(
  htmlPath: string,
  opts: HydrateOptions = {},
): Promise<HydrateResult> {
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

    const entries = await measureTextLeaves(page);
    const snapshots = await captureSnapshots(page);
    const html = await page.content();
    return {
      html,
      textMeasurements: new Map(entries),
      snapshots,
    };
  } finally {
    await browser.close();
  }
}

/**
 * For every element tagged with `data-c2f="snapshot"`, stamp it with a
 * `data-c2f-sid="sN"` marker and capture a PNG screenshot via Playwright.
 * The parse5-side walker then replaces the whole subtree with a single
 * IMAGE IR node pointing at the PNG data URI.
 *
 * `omitBackground: true` honours the element's own background; the rest
 * of the page is transparent in the PNG so the snapshot drops cleanly
 * onto whatever frame it's placed inside in Figma.
 */
async function captureSnapshots(
  page: import('playwright').Page,
): Promise<Map<string, SnapshotResult>> {
  const handles = await page.$$('[data-c2f="snapshot"]');
  const out = new Map<string, SnapshotResult>();
  let index = 0;
  for (const handle of handles) {
    const sid = `s${index}`;
    index += 1;
    await handle.evaluate((el, id) => el.setAttribute('data-c2f-sid', id), sid);
    const box = await handle.boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) {
      await handle.dispose();
      continue;
    }
    let buf: Buffer;
    try {
      buf = await handle.screenshot({ type: 'png', omitBackground: true });
    } catch {
      await handle.dispose();
      continue;
    }
    await handle.dispose();
    const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
    out.set(sid, { dataUri, width: box.width, height: box.height });
  }
  return out;
}

/**
 * Walk the live DOM, stamp each text-leaf element with `data-c2f-mid`,
 * and return its bounding box + line count. Top-down walk — once an
 * element is stamped, its descendants are skipped (a `<p>` containing
 * inline `<span>`s becomes a single measured leaf, matching what yoga
 * does on the parse5 side via `classify.ts`).
 *
 * Returned as an array of [key, measurement] entries because Playwright
 * serializes `page.evaluate` results via JSON — Map doesn't round-trip.
 */
async function measureTextLeaves(
  page: import('playwright').Page,
): Promise<Array<[string, TextMeasurement]>> {
  return page.evaluate(() => {
    const TEXT_TAGS = new Set([
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'P',
      'SPAN',
      'A',
      'LABEL',
      'LI',
      'STRONG',
      'EM',
      'B',
      'I',
      'SMALL',
      'BUTTON',
      'CAPTION',
      'FIGCAPTION',
      'BLOCKQUOTE',
      'PRE',
      'CODE',
    ]);

    function isTextSubtree(el: Element): boolean {
      if (!TEXT_TAGS.has(el.tagName)) return false;
      for (const child of Array.from(el.children)) {
        if (child.tagName === 'BR') continue;
        if (!isTextSubtree(child)) return false;
      }
      return true;
    }

    const entries: Array<[string, TextMeasurement]> = [];

    function walk(el: Element): void {
      if (isTextSubtree(el) && (el.textContent ?? '').trim().length > 0) {
        const mid = `m${entries.length}`;
        el.setAttribute('data-c2f-mid', mid);
        const rect = el.getBoundingClientRect();
        let lineCount = 1;
        try {
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = range.getClientRects();
          if (rects.length > 0) lineCount = rects.length;
        } catch {
          // getClientRects unsupported on this element — stick with 1 line
        }
        entries.push([mid, { width: rect.width, height: rect.height, lineCount }]);
        return; // stamped — don't descend, nested spans are part of this leaf
      }
      for (const child of Array.from(el.children)) walk(child);
    }

    walk(document.body);
    return entries;
  });
}
