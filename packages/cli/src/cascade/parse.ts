/**
 * Parse a CSS string into a flat list of style rules using postcss.
 *
 * Note: KICKSTART specifies lightningcss for CSS parsing. We use postcss
 * here because lightningcss exposes a typed value AST that requires a
 * per-property serializer to recover string values for the cascade.
 * postcss returns `decl.value` as the original CSS string, which the M2
 * value parsers consume directly. See PROGRESS.md for the deviation note.
 */

import postcss, { type Declaration as PcDecl, type Rule as PcRule } from 'postcss';
import type { Rule } from './types.js';

interface ParseOptions {
  /** Starting source-order offset so multiple stylesheets can interleave correctly. */
  startOrder?: number;
}

/** Parse one stylesheet. Returns rules in document order. */
export function parseStylesheet(css: string, opts: ParseOptions = {}): Rule[] {
  const root = postcss.parse(css);
  const rules: Rule[] = [];
  let order = opts.startOrder ?? 0;

  root.walkRules((rule: PcRule) => {
    const selectors = rule.selectors.map((s) => s.trim()).filter(Boolean);
    if (selectors.length === 0) return;

    const declarations: Rule['declarations'] = [];
    rule.walkDecls((decl: PcDecl) => {
      declarations.push({
        property: decl.prop.toLowerCase(),
        value: decl.value,
        important: decl.important === true,
      });
    });

    if (declarations.length === 0) return;
    rules.push({ selectors, declarations, order });
    order += 1;
  });

  return rules;
}

/** Convenience: parse multiple sheets and merge with continuous source order. */
export function parseStylesheets(sheets: string[]): Rule[] {
  const out: Rule[] = [];
  let order = 0;
  for (const sheet of sheets) {
    const rules = parseStylesheet(sheet, { startOrder: order });
    const last = rules[rules.length - 1];
    if (last) order = last.order + 1;
    out.push(...rules);
  }
  return out;
}
