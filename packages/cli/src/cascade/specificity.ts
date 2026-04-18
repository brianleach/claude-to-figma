import type { Specificity } from './types.js';

/**
 * Compute specificity for a selector string. Supports the subset of selectors
 * the M3 matcher handles: type, .class, #id, descendant (` `) and child (`>`)
 * combinators, compound (`div.foo#bar`).
 *
 * Pseudo-classes count as classes. Pseudo-elements count as type. Universal
 * selector and combinators contribute zero.
 */
export function computeSpecificity(selector: string): Specificity {
  let id = 0;
  let cls = 0;
  let type = 0;

  for (const compound of splitCompound(selector)) {
    let i = 0;
    while (i < compound.length) {
      const ch = compound[i];
      if (ch === '#') {
        i += 1;
        while (i < compound.length && isIdentChar(compound[i])) i += 1;
        id += 1;
      } else if (ch === '.') {
        i += 1;
        while (i < compound.length && isIdentChar(compound[i])) i += 1;
        cls += 1;
      } else if (ch === '[') {
        // Attribute selector — count as class.
        while (i < compound.length && compound[i] !== ']') i += 1;
        i += 1;
        cls += 1;
      } else if (ch === ':') {
        // Pseudo-element (::) → type. Pseudo-class (:) → class.
        i += 1;
        if (compound[i] === ':') {
          i += 1;
          while (i < compound.length && isIdentChar(compound[i])) i += 1;
          type += 1;
        } else {
          while (i < compound.length && isIdentChar(compound[i])) i += 1;
          cls += 1;
        }
      } else if (ch === '*') {
        i += 1;
      } else if (isIdentStart(ch)) {
        while (i < compound.length && isIdentChar(compound[i])) i += 1;
        type += 1;
      } else {
        i += 1;
      }
    }
  }

  return { inline: 0, id, cls, type };
}

/** `0` if a equals b; positive if a wins; negative if b wins. */
export function compareSpecificity(a: Specificity, b: Specificity): number {
  if (a.inline !== b.inline) return a.inline - b.inline;
  if (a.id !== b.id) return a.id - b.id;
  if (a.cls !== b.cls) return a.cls - b.cls;
  return a.type - b.type;
}

/** Split a complex selector ("div .foo > #bar") into its compound parts. */
function splitCompound(selector: string): string[] {
  return selector
    .replace(/\s*[>+~]\s*/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function isIdentStart(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[a-zA-Z_-]/.test(ch);
}

function isIdentChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[a-zA-Z0-9_-]/.test(ch);
}
