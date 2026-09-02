/**
 * The element arena: every curve and scratch buffer carved out of one
 * Float64Array, as persistent views.
 *
 * The hazard this suite exists for is the one shared buffers introduce and
 * nothing else does: an off-by-one in the offset arithmetic corrupts a
 * *neighbouring* curve, silently, and the symptom surfaces on whichever
 * property that neighbour drives — nowhere near the arithmetic. Every test
 * here writes into one slice and asserts about the slices beside it.
 */
import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { buildCurve, curveDoubles, fillCurve, evaluate } from '../src/modules/curve.ts';
import { parseElement } from '../src/modules/parse.ts';
import {
  createRuntimeElement, updateElement, clearElement, resetElement,
} from '../src/modules/runtime.ts';

const ctx = {
  origin: 'https://example.com/',
  breakpoints: new Map([['mobile', { min: 0, max: 640 }], ['tablet', { min: 641, max: 1024 }]]),
};
const S = { scrollDirection: 'vertical', inertia: 1, inertiaEase: 'linear', ease: 'linear' };
const win = (start = 0, width = 1400) => ({ start, end: start + 900, size: 900, width, height: 900 });

const build = (html, settings = S) => {
  document.body.innerHTML = html;
  const node = document.body.firstElementChild;
  Object.defineProperty(node, 'offsetTop', { value: 1000, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 400, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  return createRuntimeElement(parseElement(node, ctx), settings);
};

beforeEach(() => { document.body.innerHTML = ''; });

const pts = (...pairs) => pairs.map(([position, value]) => ({ position, value }));

describe('buildCurve with an arena', () => {
  it('evaluates identically to the standalone form', () => {
    const points = pts([0, 0], [0.3, 50], [1, 100]);
    const standalone = buildCurve(points);
    const arena = new Float64Array(curveDoubles(3) + 4);
    const carved = buildCurve(points, null, false, arena, 2);
    for (const t of [-1, 0, 0.15, 0.3, 0.65, 1, 2]) {
      expect(evaluate(carved, t)).toBe(evaluate(standalone, t));
    }
  });

  it('stays inside its slice — the doubles either side are untouched', () => {
    /** Slack before and after, poisoned so a stray write is unmistakable. */
    const arena = new Float64Array(2 + curveDoubles(3) + 2).fill(-999);
    const c = buildCurve(pts([0, 1], [0.5, 2], [1, 3]), null, false, arena, 2);
    fillCurve(c, pts([0, 7], [0.5, 8], [1, 9]));
    expect(Array.from(arena.slice(0, 2))).toEqual([-999, -999]);
    expect(Array.from(arena.slice(arena.length - 2))).toEqual([-999, -999]);
  });

  it('two curves placed by curveDoubles never overlap', () => {
    const arena = new Float64Array(curveDoubles(3) + curveDoubles(2));
    const first = buildCurve(pts([0, 10], [0.5, 20], [1, 30]), null, false, arena, 0);
    const before = { positions: [...first.positions], values: [...first.values], slopes: [...first.slopes] };
    const second = buildCurve(pts([0, -5], [1, -6]), null, false, arena, curveDoubles(3));
    fillCurve(second, pts([0, -70], [1, -80]));
    expect([...first.positions]).toEqual(before.positions);
    expect([...first.values]).toEqual(before.values);
    expect([...first.slopes]).toEqual(before.slopes);
  });
});

describe('the element arena', () => {
  /**
   * The lone-keyframe opacity is load-bearing: `mergeForWidth` gives it a
   * resting partner on the first measure, so a slice sized off the raw
   * attribute would be abandoned immediately — the buffer-membership check
   * below is what holds `planFor` to sizing for the fill instead.
   */
  const MARKUP = `<div data-vera-motion
    data-vera-motion-translate-y="0% 0px, 100% 100px"
    data-vera-motion-scale="0% 1, 50% 1.5, 100% 2"
    data-vera-motion-blur="0% 0px, 100% 4px"
    data-vera-motion-opacity="0"
    data-vera-motion-radius-top-left="0% 0px, 100% 8px"></div>`;

  /** Every view of the plan, named for the failure report. */
  const views = (plan) => {
    const all = [];
    plan.all.forEach((a, i) => {
      all.push([`curve ${i} positions`, a.curve.positions]);
      all.push([`curve ${i} values`, a.curve.values]);
      all.push([`curve ${i} slopes`, a.curve.slopes]);
    });
    all.push(['transformValues', plan.transformValues]);
    all.push(['filterValues', plan.filterValues]);
    all.push(['lastProperties', plan.lastProperties]);
    return all;
  };

  it('holds every curve and scratch buffer in one buffer, in disjoint slices', () => {
    const e = build(MARKUP);
    const all = views(e.plan);
    const buffer = e.plan.transformValues.buffer;
    /** A failure names the stray view rather than printing `false`. */
    expect(all.filter(([, view]) => view.buffer !== buffer).map(([name]) => name)).toEqual([]);
    const spans = all
      .map(([name, view]) => [name, view.byteOffset, view.byteOffset + view.byteLength])
      .sort((a, b) => a[1] - b[1]);
    const overlaps = [];
    for (let i = 1; i < spans.length; i++) {
      if (spans[i][1] < spans[i - 1][2]) overlaps.push(`${spans[i][0]} overlaps ${spans[i - 1][0]}`);
    }
    expect(overlaps).toEqual([]);
  });

  it('refilling one curve leaves every neighbouring slice intact', () => {
    const e = build(MARKUP);
    const scale = e.plan.all.find((a) => a.property.attribute === 'scale');
    const others = views(e.plan).filter(([name]) => !name.startsWith(`curve ${e.plan.all.indexOf(scale)} `));
    const before = others.map(([name, view]) => [name, [...view]]);
    fillCurve(scale.curve, pts([0, 9], [0.25, 8], [1, 7]));
    expect(others.map(([name, view]) => [name, [...view]])).toEqual(before);
  });

  it('clearElement resets the write cache without reaching curve data', () => {
    const e = build(MARKUP);
    updateElement(e, win(800), S);
    const curves = e.plan.all.map((a) => [...a.curve.positions, ...a.curve.values, ...a.curve.slopes]);
    clearElement(e, S);
    expect([...e.plan.lastProperties].every(Number.isNaN)).toBe(true);
    e.plan.all.forEach((a, i) => {
      expect([...a.curve.positions, ...a.curve.values, ...a.curve.slopes]).toEqual(curves[i]);
    });
  });

  /**
   * Which keyframe shapes keep their arena slice, and which give it up.
   *
   * The slice is sized from the base keyframes, before `mergeForWidth` has run
   * — so a band that **adds** a position produces more points than the slice
   * holds, and that curve is rebuilt standalone on its first measure: it pays
   * for three separate typed arrays *and* strands its slice, both of the costs
   * the arena exists to avoid. A band that only *replaces* a position is fine,
   * and so are duplicates in the base, which `mergeForWidth` keeps whole.
   *
   * Sizing for the widest possible merge was tried and reverted: a curve's
   * views are carved at one length while the merged count moves with viewport
   * width, so it merely moved the standalone rebuild to the widths where the
   * band does *not* match. Recorded here as measured behaviour rather than as
   * an aspiration, so the day it changes is a day someone chose.
   */
  it('keeps its arena slice unless a band adds a keyframe position', () => {
    const inArena = (attributes) => {
      const e = build(`<div data-vera-motion ${attributes}></div>`);
      /** The control: the shape produced a curve at all. */
      expect(e.plan.all.length > 0).toBe(true);
      const arena = e.plan.transformValues.buffer;
      return e.plan.all.every((a) => a.curve.positions.buffer === arena);
    };

    expect(inArena('data-vera-motion-translate-y="0% 0px, 100% 40px"')).toBe(true);
    expect(inArena('data-vera-motion-opacity="0"')).toBe(true);
    expect(inArena('data-vera-motion-translate-y="0% 0px, 50% 10px, 50% 90px, 100% 40px"')).toBe(true);
    expect(inArena(
      'data-vera-motion-opacity="0% 0, 100% 1" data-vera-motion-opacity-tablet="100% 0.5"')).toBe(true);

    /** The one that gives it up, and the reason this test is not a formality. */
    expect(inArena(
      'data-vera-motion-opacity="0% 0, 100% 1" data-vera-motion-opacity-tablet="50% 0.5"')).toBe(false);
  });

  it('a band edge rebuilds one curve standalone and leaves the rest in the arena', () => {
    /** happy-dom's 1024px viewport is outside the mobile band, so the extra
     * keyframe only exists after the resize below crosses into it. */
    const e = build(`<div data-vera-motion
      data-vera-motion-translate-y="0% 0px, 100% 100px"
      data-vera-motion-opacity="0% 0, 100% 1"
      data-vera-motion-opacity-mobile="50% 0.5"></div>`);
    const buffer = e.plan.transformValues.buffer;
    const opacity = () => e.plan.all.find((a) => a.property.attribute === 'opacity');
    expect(opacity().curve.positions).toHaveLength(2);
    expect(opacity().curve.positions.buffer === buffer).toBe(true);

    resetElement(e, S, win(0, 600));

    /** The rebuilt curve owns its arrays and carries the merged keyframe... */
    expect(opacity().curve.positions).toHaveLength(3);
    expect(opacity().curve.positions.buffer === buffer).toBe(false);
    expect(evaluate(opacity().curve, 0.5)).toBeCloseTo(0.5, 9);
    /** ...and its bandless neighbour still evaluates out of the arena. */
    const translate = e.plan.all.find((a) => a.property.attribute === 'translate-y');
    expect(translate.curve.positions.buffer === buffer).toBe(true);
    expect(evaluate(translate.curve, 1)).toBeCloseTo(100, 9);
  });
});
