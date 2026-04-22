/**
 * Token extraction orchestrator. Run after detection so component
 * masters get the same paint/text style ids as their instances'
 * (would-have-been) inline fills.
 */

import type { IRDocument } from '@claude-to-figma/ir';
import { applyPaintStyles, extractPaintStyles } from './colors.js';
import { applyEffectStyles, extractEffectStyles } from './effect-styles.js';
import { applyTextStyles, extractTextStyles } from './text-styles.js';

export interface ExtractResult {
  document: IRDocument;
  stats: { paints: number; texts: number; effects: number };
}

export function extractTokens(doc: IRDocument): ExtractResult {
  const paints = extractPaintStyles(doc);
  const texts = extractTextStyles(doc);
  const effects = extractEffectStyles(doc);

  let updated = applyPaintStyles(doc, paints.styleIdByColorKey);
  updated = applyTextStyles(updated, texts.styleIdByKey);
  updated = applyEffectStyles(updated, effects.styleIdByKey);
  updated = {
    ...updated,
    styles: { paints: paints.styles, texts: texts.styles, effects: effects.styles },
  };

  return {
    document: updated,
    stats: {
      paints: paints.styles.length,
      texts: texts.styles.length,
      effects: effects.styles.length,
    },
  };
}
