/**
 * Shared types for the cascade engine.
 *
 * The cascade is a 3-phase pipeline:
 *   1. Collect — scrape stylesheets from the parse5 tree (link, style, inline).
 *   2. Match — for every element, find matching declarations from every rule.
 *   3. Resolve — apply specificity, !important, source order, inheritance, vars.
 *
 * The product per element is a `ComputedStyle`: a flat property → string map
 * that the IR walker consumes through the same value parsers M2 introduced.
 */

import type { DefaultTreeAdapterTypes } from 'parse5';

export type P5Element = DefaultTreeAdapterTypes.Element;

/** Standard CSS specificity tuple. Inline styles use the synthetic `inline` flag. */
export interface Specificity {
  /** 1 if the declaration came from an element's `style` attribute. */
  inline: 0 | 1;
  /** Number of `#id` selectors. */
  id: number;
  /** Number of `.class`, `[attr]`, or `:pseudo-class` selectors. */
  cls: number;
  /** Number of type selectors and pseudo-elements. */
  type: number;
}

/** A single property: value declaration, tagged with provenance. */
export interface Declaration {
  property: string;
  value: string;
  important: boolean;
  /** Specificity of the *selector* this declaration came from. */
  specificity: Specificity;
  /** Source order — used as the final tiebreaker after specificity + important. */
  order: number;
}

/** A parsed stylesheet rule. One rule may have many selectors and many declarations. */
export interface Rule {
  selectors: string[];
  declarations: { property: string; value: string; important: boolean }[];
  /** Position of this rule in the global source order across all stylesheets. */
  order: number;
}

/** Computed style for a single element after the cascade resolves. */
export type ComputedStyle = Map<string, string>;

/** The set of CSS property names that inherit from parent → child by default. */
export const INHERITED_PROPERTIES = new Set([
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'font',
  'letter-spacing',
  'line-height',
  'text-align',
  'text-decoration',
  'text-indent',
  'text-transform',
  'visibility',
  'word-spacing',
  'white-space',
  'direction',
  'cursor',
]);
