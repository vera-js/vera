import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { parseKeyframeList, parseBandedList, getProperty, MAX_KEYFRAMES, MAX_BANDS } from '../src/modules/schema.ts';

/**
 * The caps are real, and the generated reference says so.
 *
 * It said "**Any number of keyframes.** There is no midpoint limit" — the
 * second half true and the first not, for as long as `MAX_KEYFRAMES` has
 * existed. The sentence was written when `curve.ts` removed the LUT's hard cap
 * of two midpoints and outlived the thing it was contrasting with, in the one
 * document that is public and machine-generated.
 *
 * Pinned against the exported constants rather than the numbers, so the
 * reference and the parser cannot say different things.
 */
const ty = getProperty('translate-y');

const keyframes = (n) =>
  Array.from({ length: n }, (_, i) => `${i % 100}% ${i}px`).join(', ');

describe('the declared caps', () => {
  it('stop at MAX_KEYFRAMES and say so', () => {
    const under = parseKeyframeList(keyframes(MAX_KEYFRAMES), ty);
    expect(under.keyframes).toHaveLength(MAX_KEYFRAMES);
    expect(under.rejected).toEqual([]);

    const over = parseKeyframeList(keyframes(MAX_KEYFRAMES + 10), ty);
    expect(over.keyframes).toHaveLength(MAX_KEYFRAMES);
    expect(over.rejected).toEqual([`more than ${MAX_KEYFRAMES} keyframes`]);
  });

  it('stop at MAX_BANDS and say so', () => {
    const bands = (n) =>
      '0% 0px, 100% 10px; ' +
      Array.from({ length: n }, (_, i) => `[${i * 10}-${i * 10 + 5}]: 100% ${i}px`).join('; ');

    const over = parseBandedList(bands(MAX_BANDS + 5), ty);
    expect(over.rejected).toContain(`more than ${MAX_BANDS} bands`);
    expect(over.bands.length).toBeLessThanOrEqual(MAX_BANDS);
  });

  /** Reported, not silently truncated — the difference the reference now states. */
  it('report rather than truncate in silence', () => {
    expect(parseKeyframeList(keyframes(MAX_KEYFRAMES + 1), ty).rejected).not.toEqual([]);
  });
});
