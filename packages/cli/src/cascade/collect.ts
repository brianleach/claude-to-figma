/**
 * Walk the parse5 tree and collect every CSS source we care about:
 *   - inline `<style>` block contents
 *   - external `<link rel="stylesheet">` files (resolved relative to baseDir)
 *
 * Inline `style="..."` attributes are NOT collected here — they're applied
 * per-element in the cascade orchestrator with synthetic specificity.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DefaultTreeAdapterTypes } from 'parse5';

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;

export interface CollectOptions {
  /** Directory the input HTML lives in. Used to resolve relative <link> hrefs. */
  baseDir?: string;
}

export interface CollectedSheet {
  /** Where this sheet came from. Used in warnings. */
  origin: string;
  css: string;
}

export interface CollectResult {
  sheets: CollectedSheet[];
  warnings: string[];
}

export function collectStylesheets(
  body: Element,
  opts: CollectOptions = {},
  /** Optional explicit head — defaults to first <head> found in document. */
  head?: Element,
): CollectResult {
  const sheets: CollectedSheet[] = [];
  const warnings: string[] = [];

  if (head) collectFromSubtree(head, sheets, warnings, opts);
  collectFromSubtree(body, sheets, warnings, opts);

  return { sheets, warnings };
}

function collectFromSubtree(
  el: Element,
  sheets: CollectedSheet[],
  warnings: string[],
  opts: CollectOptions,
): void {
  const tag = el.tagName.toLowerCase();
  if (tag === 'style') {
    const text = innerText(el);
    if (text.trim()) sheets.push({ origin: '<style>', css: text });
    return;
  }
  if (tag === 'link') {
    const rel = (getAttr(el, 'rel') ?? '').toLowerCase();
    const href = getAttr(el, 'href');
    if (rel.includes('stylesheet') && href) {
      const resolved = resolveHref(href, opts.baseDir);
      if (resolved && existsSync(resolved)) {
        sheets.push({ origin: href, css: readFileSync(resolved, 'utf8') });
      } else {
        warnings.push(`<link href="${href}"> could not be resolved`);
      }
    }
    return;
  }
  for (const child of el.childNodes) {
    if (isElement(child)) collectFromSubtree(child, sheets, warnings, opts);
  }
}

function resolveHref(href: string, baseDir: string | undefined): string | undefined {
  if (/^https?:\/\//i.test(href) || /^\/\//.test(href)) return undefined;
  const dir = baseDir ?? process.cwd();
  return resolve(dir, href);
}

function innerText(el: Element): string {
  let out = '';
  for (const child of el.childNodes) {
    if (child.nodeName === '#text' && 'value' in child) out += child.value;
  }
  return out;
}

function isElement(node: ChildNode): node is Element {
  return 'tagName' in node && node.nodeName !== '#text' && node.nodeName !== '#comment';
}

function getAttr(el: Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

/** Resolve baseDir from an HTML file path. Exported for the CLI to share logic. */
export function deriveBaseDir(htmlPath: string | undefined): string | undefined {
  if (!htmlPath) return undefined;
  return dirname(resolve(htmlPath));
}
