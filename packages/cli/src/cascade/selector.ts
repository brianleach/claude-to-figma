/**
 * Minimal selector matcher. Supports:
 *   - type:        `div`, `*`
 *   - id:          `#main`
 *   - class:       `.card`
 *   - compound:    `div.card#main`
 *   - descendant:  `nav a`
 *   - child:       `header > h1`
 *   - pseudo (gap #9): `:root`, `:first-child`, `:last-child`,
 *                     `:first-of-type`, `:last-of-type`,
 *                     `:only-child`, `:only-of-type`, `:empty`
 *
 * Interactive / runtime pseudo-classes (`:hover`, `:focus`, `:active`,
 * `:nth-child`, `:not(...)`) are recognised by the specificity scorer
 * but never match — they depend on runtime state or would need a
 * richer subselector engine than this module warrants.
 */

import type { P5Element } from './types.js';

type StaticPseudo =
  | 'first-child'
  | 'last-child'
  | 'first-of-type'
  | 'last-of-type'
  | 'only-child'
  | 'only-of-type'
  | 'empty';

const SUPPORTED_PSEUDOS = new Set<StaticPseudo>([
  'first-child',
  'last-child',
  'first-of-type',
  'last-of-type',
  'only-child',
  'only-of-type',
  'empty',
]);

interface Compound {
  tag: string | null;
  id: string | null;
  classes: string[];
  pseudos: StaticPseudo[];
  /** True if any unsupported feature appears (unsupported pseudo, attribute, etc.). */
  unsupported: boolean;
}

type Combinator = ' ' | '>';

interface ParsedSelector {
  parts: Compound[];
  combinators: Combinator[];
  unsupported: boolean;
}

/** Parse one selector ("nav > a.active") into compounds + combinators. */
function parseSelector(selector: string): ParsedSelector {
  const parts: Compound[] = [];
  const combinators: Combinator[] = [];
  let combinator: Combinator = ' ';
  let i = 0;
  let unsupported = false;

  const skipWs = () => {
    while (i < selector.length && /\s/.test(selector[i] ?? '')) i += 1;
  };

  skipWs();
  while (i < selector.length) {
    const compound = readCompound(selector, i);
    if (parts.length > 0) combinators.push(combinator);
    parts.push(compound.compound);
    if (compound.compound.unsupported) unsupported = true;
    i = compound.next;
    skipWs();
    if (i >= selector.length) break;
    if (selector[i] === '>') {
      combinator = '>';
      i += 1;
      skipWs();
    } else if (selector[i] === '+' || selector[i] === '~') {
      // Sibling combinators are not supported in M3.
      unsupported = true;
      i += 1;
      skipWs();
      combinator = ' ';
    } else {
      combinator = ' ';
    }
  }
  return { parts, combinators, unsupported };
}

function readCompound(input: string, start: number): { compound: Compound; next: number } {
  const compound: Compound = {
    tag: null,
    id: null,
    classes: [],
    pseudos: [],
    unsupported: false,
  };
  let i = start;
  let sawAny = false;
  while (i < input.length) {
    const ch = input[i];
    if (ch === ' ' || ch === '>' || ch === '+' || ch === '~') break;
    sawAny = true;
    if (ch === '#') {
      i += 1;
      const ident = readIdent(input, i);
      compound.id = ident.value;
      i = ident.next;
    } else if (ch === '.') {
      i += 1;
      const ident = readIdent(input, i);
      compound.classes.push(ident.value);
      i = ident.next;
    } else if (ch === ':') {
      i += 1;
      const isPseudoElement = input[i] === ':';
      if (isPseudoElement) i += 1;
      const ident = readIdent(input, i);
      const name = ident.value.toLowerCase();
      i = ident.next;
      // Eat parens if present (e.g. :nth-child(2)) — we mark the whole
      // compound unsupported when we see them, since we don't match any
      // parenthesised pseudo today.
      let argsConsumed = false;
      if (input[i] === '(') {
        argsConsumed = true;
        let depth = 1;
        i += 1;
        while (i < input.length && depth > 0) {
          if (input[i] === '(') depth += 1;
          else if (input[i] === ')') depth -= 1;
          i += 1;
        }
      }
      if (isPseudoElement || argsConsumed) {
        compound.unsupported = true;
      } else if (name === 'root') {
        compound.tag = compound.tag ?? 'html';
      } else if (SUPPORTED_PSEUDOS.has(name as StaticPseudo)) {
        compound.pseudos.push(name as StaticPseudo);
      } else {
        compound.unsupported = true;
      }
    } else if (ch === '[') {
      compound.unsupported = true;
      while (i < input.length && input[i] !== ']') i += 1;
      i += 1;
    } else if (ch === '*') {
      compound.tag = '*';
      i += 1;
    } else if (/[a-zA-Z_-]/.test(ch ?? '')) {
      const ident = readIdent(input, i);
      compound.tag = ident.value.toLowerCase();
      i = ident.next;
    } else {
      // Unknown char — stop and treat as opaque.
      compound.unsupported = true;
      i += 1;
    }
  }
  if (!sawAny) compound.unsupported = true;
  return { compound, next: i };
}

function readIdent(input: string, start: number): { value: string; next: number } {
  let i = start;
  while (i < input.length && /[a-zA-Z0-9_-]/.test(input[i] ?? '')) i += 1;
  return { value: input.slice(start, i), next: i };
}

/** Match a single compound against a parse5 element. */
function matchCompound(c: Compound, el: P5Element, parent: P5Element | null): boolean {
  if (c.unsupported) return false;
  if (c.tag && c.tag !== '*' && c.tag !== el.tagName.toLowerCase()) return false;
  if (c.id && getAttr(el, 'id') !== c.id) return false;
  if (c.classes.length > 0) {
    const cls = (getAttr(el, 'class') ?? '').split(/\s+/).filter(Boolean);
    for (const want of c.classes) {
      if (!cls.includes(want)) return false;
    }
  }
  for (const pseudo of c.pseudos) {
    if (!matchStaticPseudo(pseudo, el, parent)) return false;
  }
  return true;
}

/**
 * Evaluate a static pseudo-class against an element and its direct parent.
 * Returns false when the parent is unknown — sibling-relative pseudos have
 * no meaning at the document root.
 */
function matchStaticPseudo(pseudo: StaticPseudo, el: P5Element, parent: P5Element | null): boolean {
  if (pseudo === 'empty') {
    for (const child of el.childNodes) {
      if ('tagName' in child) return false;
      if (child.nodeName === '#text' && 'value' in child && child.value.trim().length > 0) {
        return false;
      }
    }
    return true;
  }
  if (!parent) return false;
  const siblings = parent.childNodes.filter(
    (n): n is P5Element => 'tagName' in n && n.nodeName !== '#text' && n.nodeName !== '#comment',
  );
  const elTag = el.tagName.toLowerCase();
  const sameTypeSiblings = siblings.filter((s) => s.tagName.toLowerCase() === elTag);
  switch (pseudo) {
    case 'first-child':
      return siblings[0] === el;
    case 'last-child':
      return siblings[siblings.length - 1] === el;
    case 'first-of-type':
      return sameTypeSiblings[0] === el;
    case 'last-of-type':
      return sameTypeSiblings[sameTypeSiblings.length - 1] === el;
    case 'only-child':
      return siblings.length === 1 && siblings[0] === el;
    case 'only-of-type':
      return sameTypeSiblings.length === 1 && sameTypeSiblings[0] === el;
    default:
      return false;
  }
}

function getAttr(el: P5Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}

/**
 * Match a selector against an element with its ancestor chain (root first).
 * Each ancestor index is `el`'s parent, grandparent, etc. — purely parse5
 * elements, no Document wrapper.
 */
export function matchSelector(selector: string, el: P5Element, ancestors: P5Element[]): boolean {
  const parsed = parseSelector(selector);
  if (parsed.unsupported) return false;
  if (parsed.parts.length === 0) return false;

  // Match right-to-left. The rightmost compound must match `el`.
  const rightmost = parsed.parts[parsed.parts.length - 1];
  const elParent = ancestors[ancestors.length - 1] ?? null;
  if (!rightmost || !matchCompound(rightmost, el, elParent)) return false;

  // Walk left through compounds + combinators.
  let cursor = ancestors.length - 1; // index of el's direct parent in ancestors
  for (let p = parsed.parts.length - 2; p >= 0; p -= 1) {
    const combinator = parsed.combinators[p];
    const compound = parsed.parts[p];
    if (!compound) return false;
    if (combinator === '>') {
      const parent = ancestors[cursor];
      const grandparent = ancestors[cursor - 1] ?? null;
      if (!parent || !matchCompound(compound, parent, grandparent)) return false;
      cursor -= 1;
    } else {
      // Descendant — search up the chain for any ancestor that matches.
      let found = false;
      for (let a = cursor; a >= 0; a -= 1) {
        const ancestor = ancestors[a];
        const ancestorParent = ancestors[a - 1] ?? null;
        if (ancestor && matchCompound(compound, ancestor, ancestorParent)) {
          cursor = a - 1;
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
  }
  return true;
}
