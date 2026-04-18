/**
 * Element classification shared between the layout module and the IR walker.
 * Co-located here so both stay in lockstep — diverging classifications would
 * mean a TEXT node in the IR but a non-measured FRAME node in yoga, leaving
 * text with height 0.
 */

import type { DefaultTreeAdapterTypes } from 'parse5';

type Element = DefaultTreeAdapterTypes.Element;

const TEXT_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'span',
  'a',
  'label',
  'li',
  'strong',
  'em',
  'b',
  'i',
  'small',
  'button',
  'caption',
  'figcaption',
  'blockquote',
  'pre',
  'code',
]);

export const IGNORED_TAGS = new Set([
  'script',
  'style',
  'meta',
  'link',
  'title',
  'head',
  'noscript',
]);

/** True if `el` will become an IR TEXT node (text-only inline element). */
export function isTextElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (!TEXT_TAGS.has(tag)) return false;
  return containsOnlyText(el);
}

export function containsOnlyText(el: Element): boolean {
  return el.childNodes.every((c) => {
    if (c.nodeName === '#text') return true;
    if ('tagName' in c) {
      const tag = c.tagName.toLowerCase();
      return tag === 'br' || (TEXT_TAGS.has(tag) && containsOnlyText(c));
    }
    return false;
  });
}

export function collectInnerText(el: Element): string {
  let out = '';
  for (const c of el.childNodes) {
    if (c.nodeName === '#text' && 'value' in c) out += c.value;
    else if ('tagName' in c) {
      if (c.tagName.toLowerCase() === 'br') out += '\n';
      else out += collectInnerText(c);
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

export { TEXT_TAGS };
