import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { parseKeyframeList, parseBandedList, parseRange, getProperty, parseMeasure, parseEasing } from '../src/modules/schema.ts';
import { buildCurve, evaluate } from '../src/modules/curve.ts';
import { resolveEasing } from '../src/easings.ts';
import { parseElement } from '../src/modules/parse.ts';
import { createRuntimeElement, updateElement, resetElement } from '../src/modules/runtime.ts';

const opacity = getProperty('opacity');
const ty = getProperty('translate-y');

describe('edge cases', () => {
  it('range: rejects reversed and accepts touching', () => {
    expect(parseRange('[500-100]')).toBeNull();
    expect(parseRange('[500-500]')).toEqual({ min: 500, max: 500 });
  });
  it('range: rejects negatives and decimals', () => {
    expect(parseRange('[-5-100]')).toBeNull();
    expect(parseRange('[1.5-100]')).toBeNull();
  });
  it('range: rejects an unclosed or empty bracket', () => {
    expect(parseRange('[100-')).toBeNull();
    expect(parseRange('[]')).toBeNull();
    expect(parseRange('[+]')).toBeNull();
  });
  it('banded: a band with no colon is rejected, not silently dropped', () => {
    const r = parseBandedList('0% 0, 100% 1; [0-500] 100% 0.5', opacity);
    expect(r.rejected.length).toBeGreaterThan(0);
  });
  it('banded: an empty band body yields no band', () => {
    const r = parseBandedList('0% 0, 100% 1; [0-500]:', opacity);
    expect(r.bands).toHaveLength(0);
  });
  it('banded: bands-only value has an empty base', () => {
    const r = parseBandedList('[0-500]: 100% 1', opacity);
    expect(r.base.keyframes).toHaveLength(0);
    expect(r.bands).toHaveLength(1);
  });
  it('curve: two keyframes at the same position do not divide by zero', () => {
    const c = buildCurve([{ position: 0.5, value: 0 }, { position: 0.5, value: 1 }]);
    expect(Number.isNaN(evaluate(c, 0.5))).toBe(false);
  });
  it('curve: a single-point curve evaluates to that point', () => {
    const c = buildCurve([{ position: 0.5, value: 7 }]);
    expect(evaluate(c, 0)).toBe(7);
    expect(evaluate(c, 1)).toBe(7);
  });
  it('measure: rejects things that look numeric but are not', () => {
    for (const bad of ['1.2.3', '1e5px', '--4', '+', '.', 'Infinity', 'NaN', '0x10']) {
      expect(parseMeasure(bad, ty), bad).toBeNull();
    }
  });
  it('measure: accepts the forms the grammar promises', () => {
    for (const good of ['0', '.5', '-.5', '100px', '-40.5rem']) {
      expect(parseMeasure(good, ty), good).not.toBeNull();
    }
  });
  /**
   * The substantive half is unchanged: a trailing comma must not become a
   * keyframe. What changed is that it is no longer *reported* either. It was
   * pushed to `rejected` as itself — the empty string — so a perfectly good
   * animation carried a complaint with no text in it, and these attributes are
   * written by people and by AI, both of whom end lists the way CSS does.
   *
   * An attribute with nothing in it at all is still named; that is a mistake
   * with intent behind it. See `test/trailing-separators.test.js`.
   */
  it('keyframes: a trailing comma becomes neither a keyframe nor a complaint', () => {
    const r = parseKeyframeList('0% 0, 100% 1,', opacity);
    expect(r.keyframes).toHaveLength(2);
    expect(r.rejected).toHaveLength(0);
  });

  it('keyframes: but an empty value is still reported', () => {
    const r = parseKeyframeList('', opacity);
    expect(r.keyframes).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
  });
  it('easing: a step form that would divide by zero is rejected outright', () => {
    /**
     * This used to be accepted and merely guarded against NaN downstream.
     * Every engine rejects it (`spikes/steps-validity.mjs`), and an `ease`
     * value is handed to CSS verbatim for `inertia-ease` — so accepting it
     * meant the browser dropped the declaration while `rejected` called the
     * value fine. Rejecting beats surviving.
     */
    expect(parseEasing('steps(1, jump-none)')).toBeNull();
    expect(resolveEasing('steps(1, jump-none)')).toBeNull();
    /** The clamp is still there for the counts that are legal. */
    expect(Number.isFinite(resolveEasing('steps(2, jump-none)')(0.5))).toBe(true);
    expect(Number.isFinite(resolveEasing('steps(2, jump-none)')(1))).toBe(true);
  });
});

describe('runtime edge cases', () => {
  const S = { scrollDirection: 'vertical', inertia: 0.1, inertiaEase: 'linear', ease: 'linear' };
  const win = (start = 0, width = 1400, size = 900) =>
    ({ start, end: start + size, size, width, height: size });

  const build = (html, height = 300) => {
    document.body.innerHTML = html;
    const node = document.body.firstElementChild;
    Object.defineProperty(node, 'offsetTop', { value: 1000, configurable: true });
    Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
    Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
    return createRuntimeElement(parseElement(node, { origin: 'https://x.test/' }), S);
  };

  it('a zero-height element still has a scroll window', () => {
    const e = build('<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>', 0);
    updateElement(e, win(1000), S);
    expect(Number.isFinite(e.timelinePosition)).toBe(true);
  });

  it('an element taller than the viewport animates across its own height', () => {
    const e = build('<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>', 5000);
    updateElement(e, win(1000), S);
    expect(Number.isFinite(e.timelinePosition)).toBe(true);
    expect(e.node.style.filter).toMatch(/opacity/);
  });

  it('a band boundary is inclusive at both ends', () => {
    const html = '<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1; [500-700]: 100% 0.5"></div>';
    const inside = build(html);
    resetElement(inside, S, win(0, 500));
    expect(inside.plan.all[0].curve.values.at(-1)).toBe(0.5);
    resetElement(inside, S, win(0, 700));
    expect(inside.plan.all[0].curve.values.at(-1)).toBe(0.5);
    resetElement(inside, S, win(0, 701));
    expect(inside.plan.all[0].curve.values.at(-1)).toBe(1);
  });

  it('a stagger of zero changes nothing', () => {
    document.body.innerHTML =
      '<div data-vera-motion-stagger="0"><div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>' +
      '<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div></div>';
    const nodes = [...document.querySelectorAll('[data-vera-motion]')];
    const parsed = nodes.map((n) => parseElement(n, { origin: 'https://x.test/' }));
    expect(parsed[1].stagger?.position ?? 0).toBe(0);
  });

  it('run-once latches on an element whose keyframes are all in a band', () => {
    const e = build(`<div data-vera-motion data-vera-motion-run-once
      data-vera-motion-opacity="[0-2000]: 0% 0, 100% 1"></div>`);
    updateElement(e, win(4000), S);
    expect(e.runOnceRan).toBe(true);
  });
});
