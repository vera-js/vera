import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { parseKeyframeList, getProperty } from '../src/modules/schema.ts';

const ty = getProperty('translate-y');

/**
 * The grammar splits position from value at the *first* whitespace, and splits
 * the keyframe list on commas at paren depth zero. Both were needed before any
 * CSS value containing a space or a comma could be a keyframe.
 */
describe('keyframe grammar with CSS-shaped values', () => {
  it('still parses ordinary numeric keyframes', () => {
    const r = parseKeyframeList('0% 0px, 100% 40px', ty);
    expect(r.rejected).toEqual([]);
    expect(r.keyframes.map((k) => k.value)).toEqual([0, 40]);
  });

  it('still accepts the bare-value sugar', () => {
    const r = parseKeyframeList('40px', ty);
    expect(r.rejected).toEqual([]);
    expect(r.keyframes[0].position).toBe(100);
  });

  /** The guard this replaced counted tokens; the value parser refuses it instead. */
  it('still rejects a numeric value with a stray space', () => {
    const r = parseKeyframeList('0% 10 20', ty);
    expect(r.keyframes).toHaveLength(0);
    /** The entry exactly, and a reason after it — see `whyRefused`. */
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]).toMatch(/^0% 10 20 \u2014 ./);
  });

  it('does not split a comma inside parentheses', () => {
    const def = {
      attribute: 'paint-test', category: 'border', cssProperty: 'background',
      defaultUnit: '', units: [''], initial: 0,
      parse: (raw) => (raw.includes('gradient') ? 1 : 0),
    };
    const r = parseKeyframeList('0% linear-gradient(red, blue), 100% #0a0', def);
    expect(r.rejected).toEqual([]);
    expect(r.keyframes).toHaveLength(2);
    expect(r.keyframes.map((k) => k.value)).toEqual([1, 0]);
  });

  it('keeps a value containing spaces intact', () => {
    const seen = [];
    const def = {
      attribute: 'shadow-test', category: 'border', cssProperty: 'box-shadow',
      defaultUnit: '', units: [''], initial: 0,
      parse: (raw) => { seen.push(raw); return 0; },
    };
    parseKeyframeList('0% 0 2px 8px rgb(0 0 0 / 0.3)', def);
    expect(seen).toEqual(['0 2px 8px rgb(0 0 0 / 0.3)']);
  });
});
