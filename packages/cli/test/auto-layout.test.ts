/**
 * Flex → auto-layout mapping tests — covers V-M5-MAPPING-TESTS.
 *
 * Pure-function tests against `mapFlexContainer` and `mapFlexChild`. The
 * convertHtml-level integration is exercised in the snapshot tests for
 * the M5 fixtures (flex-justify-variations, flex-align-variations,
 * flex-wrap).
 */

import { describe, expect, it } from 'vitest';
import type { ComputedStyle } from '../src/cascade/index.js';
import { mapFlexChild, mapFlexContainer } from '../src/layout/auto-layout.js';

function s(entries: Record<string, string>): ComputedStyle {
  return new Map(Object.entries(entries));
}

describe('mapFlexContainer', () => {
  it('returns undefined when display is not flex', () => {
    expect(mapFlexContainer(s({ display: 'block' }))).toBeUndefined();
    expect(mapFlexContainer(s({}))).toBeUndefined();
  });

  it('returns layout for display: flex', () => {
    const layout = mapFlexContainer(s({ display: 'flex' }));
    expect(layout?.layoutMode).toBe('HORIZONTAL');
  });

  it('returns layout for display: inline-flex', () => {
    const layout = mapFlexContainer(s({ display: 'inline-flex' }));
    expect(layout?.layoutMode).toBe('HORIZONTAL');
  });

  it('maps flex-direction: row → HORIZONTAL', () => {
    expect(mapFlexContainer(s({ display: 'flex', 'flex-direction': 'row' }))?.layoutMode).toBe(
      'HORIZONTAL',
    );
  });

  it('maps flex-direction: column → VERTICAL', () => {
    expect(mapFlexContainer(s({ display: 'flex', 'flex-direction': 'column' }))?.layoutMode).toBe(
      'VERTICAL',
    );
  });

  it('maps flex-direction: row-reverse to HORIZONTAL', () => {
    expect(
      mapFlexContainer(s({ display: 'flex', 'flex-direction': 'row-reverse' }))?.layoutMode,
    ).toBe('HORIZONTAL');
  });

  it('maps flex-direction: column-reverse to VERTICAL', () => {
    expect(
      mapFlexContainer(s({ display: 'flex', 'flex-direction': 'column-reverse' }))?.layoutMode,
    ).toBe('VERTICAL');
  });

  it('maps gap to itemSpacing in horizontal mode', () => {
    const l = mapFlexContainer(s({ display: 'flex', gap: '12px' }));
    expect(l?.itemSpacing).toBe(12);
    expect(l?.counterAxisSpacing).toBe(12);
  });

  it('maps row-gap to counterAxisSpacing in horizontal mode', () => {
    const l = mapFlexContainer(s({ display: 'flex', 'row-gap': '8px' }));
    expect(l?.counterAxisSpacing).toBe(8);
    expect(l?.itemSpacing).toBe(0);
  });

  it('maps column-gap to itemSpacing in horizontal mode', () => {
    const l = mapFlexContainer(s({ display: 'flex', 'column-gap': '6px' }));
    expect(l?.itemSpacing).toBe(6);
    expect(l?.counterAxisSpacing).toBe(0);
  });

  it('swaps row-gap/column-gap roles in vertical mode', () => {
    const l = mapFlexContainer(
      s({ display: 'flex', 'flex-direction': 'column', 'row-gap': '8px', 'column-gap': '4px' }),
    );
    // vertical: row-gap = main axis (itemSpacing), column-gap = cross
    expect(l?.itemSpacing).toBe(8);
    expect(l?.counterAxisSpacing).toBe(4);
  });

  it('maps padding longhands', () => {
    const l = mapFlexContainer(
      s({
        display: 'flex',
        'padding-top': '4px',
        'padding-right': '8px',
        'padding-bottom': '12px',
        'padding-left': '16px',
      }),
    );
    expect(l).toMatchObject({ paddingTop: 4, paddingRight: 8, paddingBottom: 12, paddingLeft: 16 });
  });

  it('expands padding shorthand with 1, 2, 3, 4 values', () => {
    const one = mapFlexContainer(s({ display: 'flex', padding: '8px' }));
    expect(one).toMatchObject({ paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8 });

    const two = mapFlexContainer(s({ display: 'flex', padding: '8px 16px' }));
    expect(two).toMatchObject({
      paddingTop: 8,
      paddingRight: 16,
      paddingBottom: 8,
      paddingLeft: 16,
    });

    const three = mapFlexContainer(s({ display: 'flex', padding: '8px 16px 24px' }));
    expect(three).toMatchObject({
      paddingTop: 8,
      paddingRight: 16,
      paddingBottom: 24,
      paddingLeft: 16,
    });

    const four = mapFlexContainer(s({ display: 'flex', padding: '1px 2px 3px 4px' }));
    expect(four).toMatchObject({
      paddingTop: 1,
      paddingRight: 2,
      paddingBottom: 3,
      paddingLeft: 4,
    });
  });

  it('maps justify-content: flex-start → MIN', () => {
    expect(
      mapFlexContainer(s({ display: 'flex', 'justify-content': 'flex-start' }))
        ?.primaryAxisAlignItems,
    ).toBe('MIN');
  });

  it('maps justify-content: center → CENTER', () => {
    expect(
      mapFlexContainer(s({ display: 'flex', 'justify-content': 'center' }))?.primaryAxisAlignItems,
    ).toBe('CENTER');
  });

  it('maps justify-content: flex-end → MAX', () => {
    expect(
      mapFlexContainer(s({ display: 'flex', 'justify-content': 'flex-end' }))
        ?.primaryAxisAlignItems,
    ).toBe('MAX');
  });

  it('maps justify-content: space-between → SPACE_BETWEEN', () => {
    expect(
      mapFlexContainer(s({ display: 'flex', 'justify-content': 'space-between' }))
        ?.primaryAxisAlignItems,
    ).toBe('SPACE_BETWEEN');
  });

  it('collapses space-around / space-evenly to SPACE_BETWEEN (closest Figma primitive)', () => {
    expect(
      mapFlexContainer(s({ display: 'flex', 'justify-content': 'space-around' }))
        ?.primaryAxisAlignItems,
    ).toBe('SPACE_BETWEEN');
    expect(
      mapFlexContainer(s({ display: 'flex', 'justify-content': 'space-evenly' }))
        ?.primaryAxisAlignItems,
    ).toBe('SPACE_BETWEEN');
  });

  it('maps align-items: center → CENTER', () => {
    expect(
      mapFlexContainer(s({ display: 'flex', 'align-items': 'center' }))?.counterAxisAlignItems,
    ).toBe('CENTER');
  });

  it('maps align-items: flex-end → MAX', () => {
    expect(
      mapFlexContainer(s({ display: 'flex', 'align-items': 'flex-end' }))?.counterAxisAlignItems,
    ).toBe('MAX');
  });

  it('maps align-items: baseline → BASELINE', () => {
    expect(
      mapFlexContainer(s({ display: 'flex', 'align-items': 'baseline' }))?.counterAxisAlignItems,
    ).toBe('BASELINE');
  });

  it('maps flex-wrap: wrap → WRAP', () => {
    expect(mapFlexContainer(s({ display: 'flex', 'flex-wrap': 'wrap' }))?.layoutWrap).toBe('WRAP');
  });

  it('defaults to NO_WRAP', () => {
    expect(mapFlexContainer(s({ display: 'flex' }))?.layoutWrap).toBe('NO_WRAP');
  });

  it('maps wrap-reverse → WRAP', () => {
    expect(mapFlexContainer(s({ display: 'flex', 'flex-wrap': 'wrap-reverse' }))?.layoutWrap).toBe(
      'WRAP',
    );
  });

  it('longhands override shorthand padding when both are present', () => {
    const l = mapFlexContainer(s({ display: 'flex', padding: '8px', 'padding-left': '32px' }));
    expect(l).toMatchObject({
      paddingTop: 8,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 32,
    });
  });
});

describe('mapFlexChild', () => {
  const flexParent: ComputedStyle = s({ display: 'flex' });
  const blockParent: ComputedStyle = s({ display: 'block' });

  it('returns undefined when parent is not flex', () => {
    expect(mapFlexChild(blockParent, s({}))).toBeUndefined();
  });

  it('returns AUTO positioning by default', () => {
    expect(mapFlexChild(flexParent, s({}))?.layoutPositioning).toBe('AUTO');
  });

  it('maps position: absolute to ABSOLUTE positioning', () => {
    expect(mapFlexChild(flexParent, s({ position: 'absolute' }))?.layoutPositioning).toBe(
      'ABSOLUTE',
    );
  });

  it('maps position: fixed to ABSOLUTE positioning', () => {
    expect(mapFlexChild(flexParent, s({ position: 'fixed' }))?.layoutPositioning).toBe('ABSOLUTE');
  });

  it('maps flex-grow to layoutGrow', () => {
    expect(mapFlexChild(flexParent, s({ 'flex-grow': '2' }))?.layoutGrow).toBe(2);
  });

  it('clamps flex-grow: 0 to 0 (default hug)', () => {
    expect(mapFlexChild(flexParent, s({ 'flex-grow': '0' }))?.layoutGrow).toBe(0);
  });

  it('treats parent align-items: stretch as STRETCH on every child', () => {
    expect(mapFlexChild(s({ display: 'flex', 'align-items': 'stretch' }), s({}))?.layoutAlign).toBe(
      'STRETCH',
    );
  });

  it('defaults to STRETCH when align-items is unset (CSS default)', () => {
    expect(mapFlexChild(flexParent, s({}))?.layoutAlign).toBe('STRETCH');
  });

  it('does NOT stretch when parent align-items is center', () => {
    expect(mapFlexChild(s({ display: 'flex', 'align-items': 'center' }), s({}))?.layoutAlign).toBe(
      'INHERIT',
    );
  });

  it('honors child align-self: stretch over parent setting', () => {
    expect(
      mapFlexChild(s({ display: 'flex', 'align-items': 'center' }), s({ 'align-self': 'stretch' }))
        ?.layoutAlign,
    ).toBe('STRETCH');
  });

  it('honors child align-self overriding parent stretch', () => {
    // Child explicitly opts out of stretching by picking any non-stretch align-self.
    expect(
      mapFlexChild(s({ display: 'flex', 'align-items': 'stretch' }), s({ 'align-self': 'center' }))
        ?.layoutAlign,
    ).toBe('INHERIT');
  });
});
