/**
 * Text intrinsic-size estimator. Yoga has no concept of text — every TEXT
 * node needs a measure callback that returns a Size given the proposed
 * width constraint.
 *
 * M4 ships a heuristic only: average char width = 0.55 × fontSize, line
 * height = fontSize when CSS says auto. M5+ may swap this for a real text
 * shaper if visual fidelity demands it; the contract here is a pure
 * function of (characters, fontSize, lineHeight, constraint), nothing
 * font-loading required.
 */

import type { LineHeight } from '@claude-to-figma/ir';
import { type MeasureFunction, MeasureMode } from 'yoga-layout';

const AVG_CHAR_WIDTH_RATIO = 0.55;
const AUTO_LINE_HEIGHT_FACTOR = 1.2;

/**
 * Constant-size measure function. Used when hydrate.ts captured the real
 * post-layout bounding box from Chromium (see ADR 0006) — yoga just needs
 * to hand those dimensions back regardless of proposed constraint, because
 * the whole point is that Chromium already resolved the wrap at the same
 * viewport we're about to lay out at.
 */
export function measuredText(size: { width: number; height: number }): MeasureFunction {
  const width = Math.ceil(size.width);
  const height = Math.ceil(size.height);
  return () => ({ width, height });
}

export function measureText(args: {
  characters: string;
  fontSize: number;
  lineHeight: LineHeight;
}): MeasureFunction {
  const { characters, fontSize } = args;
  const lineHeightPx = lineHeightToPx(args.lineHeight, fontSize);
  const charWidth = fontSize * AVG_CHAR_WIDTH_RATIO;
  const lines = characters.split(/\n/);
  const widestLine = lines.reduce((max, l) => Math.max(max, l.length), 0);
  const naturalWidth = widestLine * charWidth;
  const naturalLineCount = Math.max(1, lines.length);

  return (width, widthMode, _height, _heightMode) => {
    let usedWidth = naturalWidth;
    let lineCount = naturalLineCount;

    if (widthMode === MeasureMode.Exactly) {
      usedWidth = width;
      lineCount = wrapLineCount(lines, charWidth, width);
    } else if (widthMode === MeasureMode.AtMost) {
      if (width < naturalWidth) {
        usedWidth = width;
        lineCount = wrapLineCount(lines, charWidth, width);
      } else {
        usedWidth = naturalWidth;
      }
    }

    return {
      width: Math.ceil(usedWidth),
      height: Math.ceil(lineCount * lineHeightPx),
    };
  };
}

function wrapLineCount(lines: string[], charWidth: number, maxWidth: number): number {
  if (charWidth <= 0 || maxWidth <= 0) return lines.length;
  let total = 0;
  for (const line of lines) {
    const lineWidth = line.length * charWidth;
    total += Math.max(1, Math.ceil(lineWidth / maxWidth));
  }
  return total;
}

function lineHeightToPx(lh: LineHeight, fontSize: number): number {
  if (lh.unit === 'PIXELS') return lh.value;
  if (lh.unit === 'PERCENT') return (fontSize * lh.value) / 100;
  return fontSize * AUTO_LINE_HEIGHT_FACTOR;
}
