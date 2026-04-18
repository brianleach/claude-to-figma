/**
 * The cascade orchestrator.
 *
 * Takes parsed rules + the parse5 element tree, returns a Map<Element, ComputedStyle>
 * with every property already resolved (variables substituted, inheritance
 * applied, !important and source order tiebreaks honoured).
 *
 * Inline `style="..."` attributes contribute declarations with synthetic
 * specificity `inline=1` — beating any author rule that isn't `!important`.
 */

import type { DefaultTreeAdapterTypes } from 'parse5';
import { parseInlineStyle } from '../style.js';
import { matchSelector } from './selector.js';
import { compareSpecificity, computeSpecificity } from './specificity.js';
import {
  type ComputedStyle,
  type Declaration,
  INHERITED_PROPERTIES,
  type P5Element,
  type Rule,
  type Specificity,
} from './types.js';
import { resolveVars } from './vars.js';

type ChildNode = DefaultTreeAdapterTypes.ChildNode;

const INLINE_SPECIFICITY: Specificity = { inline: 1, id: 0, cls: 0, type: 0 };

export interface CascadeResult {
  /** One ComputedStyle per element, keyed by reference. */
  styles: Map<P5Element, ComputedStyle>;
}

export function computeCascade(rules: Rule[], root: P5Element): CascadeResult {
  const styles = new Map<P5Element, ComputedStyle>();
  walk(root, [], rules, styles, undefined);
  return { styles };
}

function walk(
  el: P5Element,
  ancestors: P5Element[],
  rules: Rule[],
  out: Map<P5Element, ComputedStyle>,
  parentStyle: ComputedStyle | undefined,
): void {
  const declarations = collectDeclarations(el, ancestors, rules);
  const winning = pickWinners(declarations);
  const style = applyInheritanceAndVars(winning, parentStyle);
  out.set(el, style);

  const childAncestors = [...ancestors, el];
  for (const child of el.childNodes) {
    if (isElement(child)) walk(child, childAncestors, rules, out, style);
  }
}

// ---------------------------------------------------------------------------
// Phase 1 — collect every declaration that targets this element
// ---------------------------------------------------------------------------

function collectDeclarations(el: P5Element, ancestors: P5Element[], rules: Rule[]): Declaration[] {
  const out: Declaration[] = [];

  for (const rule of rules) {
    let bestForThisRule: Specificity | null = null;
    for (const sel of rule.selectors) {
      if (!matchSelector(sel, el, ancestors)) continue;
      const spec = computeSpecificity(sel);
      if (!bestForThisRule || compareSpecificity(spec, bestForThisRule) > 0) {
        bestForThisRule = spec;
      }
    }
    if (!bestForThisRule) continue;
    for (const decl of rule.declarations) {
      out.push({
        property: decl.property,
        value: decl.value,
        important: decl.important,
        specificity: bestForThisRule,
        order: rule.order,
      });
    }
  }

  // Inline styles beat author rules at non-important origin.
  const inline = parseInlineStyle(getAttr(el, 'style'));
  let inlineOrder = Number.MAX_SAFE_INTEGER - inline.size;
  for (const [property, raw] of inline) {
    const { value, important } = stripImportant(raw);
    out.push({
      property,
      value,
      important,
      specificity: INLINE_SPECIFICITY,
      order: inlineOrder,
    });
    inlineOrder += 1;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Phase 2 — for each property, pick the winner per CSS cascade rules
// ---------------------------------------------------------------------------

function pickWinners(decls: Declaration[]): Map<string, Declaration> {
  const winners = new Map<string, Declaration>();
  for (const decl of decls) {
    const current = winners.get(decl.property);
    if (!current || beats(decl, current)) winners.set(decl.property, decl);
  }
  return winners;
}

function beats(candidate: Declaration, current: Declaration): boolean {
  if (candidate.important !== current.important) return candidate.important;
  const specCmp = compareSpecificity(candidate.specificity, current.specificity);
  if (specCmp !== 0) return specCmp > 0;
  return candidate.order > current.order;
}

// ---------------------------------------------------------------------------
// Phase 3 — apply inheritance + resolve var() references
// ---------------------------------------------------------------------------

function applyInheritanceAndVars(
  winners: Map<string, Declaration>,
  parentStyle: ComputedStyle | undefined,
): ComputedStyle {
  const style: ComputedStyle = new Map();

  // Inherit first — child can still override.
  if (parentStyle) {
    for (const [prop, value] of parentStyle) {
      if (INHERITED_PROPERTIES.has(prop) || prop.startsWith('--')) {
        style.set(prop, value);
      }
    }
  }

  // Apply this element's winning declarations.
  for (const [prop, decl] of winners) {
    style.set(prop, decl.value);
  }

  // Resolve var() references. Variables can reference other variables, so
  // the lookup function reads from the in-progress style map.
  const resolved: ComputedStyle = new Map();
  for (const [prop, value] of style) {
    resolved.set(
      prop,
      resolveVars(value, (name) => style.get(name)),
    );
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripImportant(value: string): { value: string; important: boolean } {
  const match = /^(.*?)\s*!important\s*$/i.exec(value);
  if (!match) return { value: value.trim(), important: false };
  return { value: (match[1] ?? '').trim(), important: true };
}

function isElement(node: ChildNode): node is P5Element {
  return 'tagName' in node && node.nodeName !== '#text' && node.nodeName !== '#comment';
}

function getAttr(el: P5Element, name: string): string | undefined {
  return el.attrs.find((a) => a.name === name)?.value;
}
