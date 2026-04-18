/**
 * Font substitution — rewrite every `fontFamily` reference in an IR
 * document with a single fallback family. Used by the `--font-fallback`
 * flag when the user can't or won't install the original fonts locally.
 *
 * What gets rewritten:
 *   - document.fonts (the manifest the plugin pre-loads)
 *   - every TEXT node's textStyle.fontFamily (root + component masters)
 *   - styles.texts entries' .style.fontFamily
 *
 * fontStyle (Regular / Bold / Semi Bold etc.) is preserved so the manifest
 * still requests the exact weights the original styles used. The user only
 * needs the fallback family installed in those weights.
 */

import type { IRDocument, IRNode, TextStyleDef } from '@claude-to-figma/ir';

export function substituteFontFamily(doc: IRDocument, fallback: string): IRDocument {
  return {
    ...doc,
    fonts: dedupe(doc.fonts.map((f) => ({ ...f, family: fallback }))),
    root: rewriteNode(doc.root, fallback),
    components: doc.components.map((c) => ({ ...c, root: rewriteNode(c.root, fallback) })),
    styles: {
      ...doc.styles,
      texts: doc.styles.texts.map(
        (t): TextStyleDef => ({
          ...t,
          style: { ...t.style, fontFamily: fallback },
        }),
      ),
    },
  };
}

function rewriteNode(node: IRNode, family: string): IRNode {
  switch (node.type) {
    case 'FRAME':
      return { ...node, children: node.children.map((c) => rewriteNode(c, family)) };
    case 'TEXT':
      return { ...node, textStyle: { ...node.textStyle, fontFamily: family } };
    default:
      return node;
  }
}

function dedupe<T extends { family: string; style: string }>(entries: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of entries) {
    const key = `${e.family}::${e.style}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
