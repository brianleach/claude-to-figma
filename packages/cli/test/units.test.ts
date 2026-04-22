/**
 * Unit-parsing tests — rem / vw / vh support added after M11.
 *
 * Covers both the pure parser (parsePx) and the end-to-end layout
 * behaviour when a fixture uses rem / vw / vh in padding, gap, margin,
 * and dimensions.
 */

import { describe, expect, it } from 'vitest';
import { convertHtml } from '../src/convert.js';
import { parsePx } from '../src/style.js';

describe('parsePx with unit context', () => {
  it('returns the number unchanged for px values', () => {
    expect(parsePx('24px')).toBe(24);
    expect(parsePx('-8px')).toBe(-8);
    expect(parsePx('0')).toBe(0);
    expect(parsePx('12.5px')).toBe(12.5);
  });

  it('accepts bare numbers without a unit', () => {
    expect(parsePx('16')).toBe(16);
  });

  it('resolves rem against the default 16px root font-size', () => {
    expect(parsePx('1rem')).toBe(16);
    expect(parsePx('1.5rem')).toBe(24);
    expect(parsePx('0.5rem')).toBe(8);
  });

  it('honours a custom rootFontSize when provided', () => {
    expect(parsePx('1rem', { rootFontSize: 18 })).toBe(18);
    expect(parsePx('2rem', { rootFontSize: 20 })).toBe(40);
  });

  it('resolves vw against ctx.viewportWidth', () => {
    expect(parsePx('50vw', { viewportWidth: 1440 })).toBe(720);
    expect(parsePx('100vw', { viewportWidth: 1440 })).toBe(1440);
    expect(parsePx('1vw', { viewportWidth: 1000 })).toBe(10);
  });

  it('resolves vh against ctx.viewportHeight', () => {
    expect(parsePx('50vh', { viewportHeight: 900 })).toBe(450);
    expect(parsePx('100vh', { viewportHeight: 900 })).toBe(900);
  });

  it('returns undefined for vw/vh when the matching viewport dim is missing', () => {
    expect(parsePx('50vw')).toBeUndefined();
    expect(parsePx('50vh', { viewportWidth: 1440 })).toBeUndefined();
  });

  it('returns undefined for unsupported units (em, %, calc, ch)', () => {
    // em isn't threaded through parsePx (needs element-local context).
    expect(parsePx('1em')).toBeUndefined();
    expect(parsePx('50%')).toBeUndefined();
    expect(parsePx('calc(100% - 16px)')).toBeUndefined();
    expect(parsePx('1ch')).toBeUndefined();
  });

  it('returns undefined for malformed input', () => {
    expect(parsePx(undefined)).toBeUndefined();
    expect(parsePx('')).toBeUndefined();
    expect(parsePx('not a length')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// End-to-end: rem propagates through CSS padding / gap
// ---------------------------------------------------------------------------

describe('convertHtml with rem-based CSS', () => {
  it('resolves rem paddings to px via the default 16 base', () => {
    const html = `
      <html>
        <body style="margin:0;width:400px;height:200px;">
          <div style="padding:1.5rem;background:#eee;display:flex;gap:0.5rem;">
            <span>a</span><span>b</span>
          </div>
        </body>
      </html>
    `;
    const { document } = convertHtml(html, { name: 'rem' });
    // Root → body > div. The inner div carries the padding.
    const div = (document.root as { children: unknown[] }).children[0] as {
      layout?: {
        paddingTop: number;
        paddingRight: number;
        paddingBottom: number;
        paddingLeft: number;
        itemSpacing: number;
      };
    };
    expect(div.layout).toBeDefined();
    // 1.5rem = 24px
    expect(div.layout?.paddingTop).toBe(24);
    expect(div.layout?.paddingRight).toBe(24);
    expect(div.layout?.paddingBottom).toBe(24);
    expect(div.layout?.paddingLeft).toBe(24);
    // 0.5rem gap = 8px
    expect(div.layout?.itemSpacing).toBe(8);
  });

  it('honours an explicit html { font-size } override for rem', () => {
    // CSS spec: `html { font-size: 20px }` shifts rem base from 16 → 20.
    const html = `
      <html><head><style>html{font-size:20px}</style></head>
        <body style="margin:0;width:400px;">
          <div style="padding:1rem;display:flex;background:#eee"></div>
        </body>
      </html>
    `;
    const { document } = convertHtml(html, { name: 'rem-override' });
    const div = (document.root as { children: unknown[] }).children[0] as {
      layout?: { paddingTop: number };
    };
    // 1rem = 20px per the overridden html font-size.
    expect(div.layout?.paddingTop).toBe(20);
  });

  it('resolves vw/vh against the convertHtml viewport options', () => {
    const html = `
      <html><body style="margin:0;">
        <div style="width:50vw;height:25vh;background:#eee"></div>
      </body></html>
    `;
    const { document } = convertHtml(html, {
      name: 'vw-vh',
      viewportWidth: 1440,
      viewportHeight: 800,
    });
    const div = (document.root as { children: unknown[] }).children[0] as {
      geometry: { width: number; height: number };
    };
    // 50vw = 720, 25vh = 200
    expect(div.geometry.width).toBe(720);
    expect(div.geometry.height).toBe(200);
  });

  it('falls back to the 1440×900 default viewport for vw/vh when none passed', () => {
    const html = `
      <html><body style="margin:0;">
        <div style="width:100vw;height:100vh;background:#eee"></div>
      </body></html>
    `;
    const { document } = convertHtml(html, { name: 'vw-vh-default' });
    const div = (document.root as { children: unknown[] }).children[0] as {
      geometry: { width: number; height: number };
    };
    expect(div.geometry.width).toBe(1440);
    expect(div.geometry.height).toBe(900);
  });
});
