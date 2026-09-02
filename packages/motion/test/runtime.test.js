import { describe, it, beforeEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { easings } from '../src/easings.ts';
import { wireMotion } from '../src/index.ts';
import { parseElement } from '../src/modules/parse.ts';
import {
  createRuntimeElement, updateElement, animateElement, resetElement, clearElement,
  setElementStyles, setTransitions,
} from '../src/modules/runtime.ts';

const ctx = {
  origin: 'https://example.com/',
  /** Names are aliases the instance registers; nothing is built in any more. */
  breakpoints: new Map([['mobile', { min: 0, max: 640 }], ['tablet', { min: 641, max: 1024 }]]),
};
const S = {
  scrollDirection: 'vertical', inertia: 1, inertiaEase: 'linear', ease: 'linear'
};
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

wireMotion(easings);

describe('createRuntimeElement', () => {
  it('groups animations by category, in schema order', () => {
    const e = build(`<div data-vera-motion data-vera-motion-scale="2" data-vera-motion-translate-y="10px"
      data-vera-motion-blur="4px" data-vera-motion-radius-top-left="8px"></div>`);
    expect(e.plan.transform.map((a) => a.property.attribute)).toEqual(['translate-y', 'scale']);
    expect(e.plan.filter.map((a) => a.property.attribute)).toEqual(['blur']);
    expect(e.plan.properties.map((a) => a.property.attribute)).toEqual(['radius-top-left']);
  });

  it('pre-allocates value buffers so frames never allocate', () => {
    const e = build('<div data-vera-motion data-vera-motion-translate-y="10px" data-vera-motion-blur="2px"></div>');
    expect(e.plan.transformValues).toBeInstanceOf(Float64Array);
    expect(e.plan.transformValues).toHaveLength(1);
    expect(e.plan.filterValues).toHaveLength(1);
  });

  it('resolves run-once once, not per frame', () => {
    expect(build('<div data-vera-motion data-vera-motion-opacity="0"></div>').runOnce).toBe(false);
    expect(build('<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-run-once></div>').runOnce).toBe(true);
  });

  /**
   * One plan, not one per breakpoint. There used to be three — each with its
   * own curves and scratch buffers — of which exactly one was ever read.
   */
  it('builds a single plan', () => {
    const e = build('<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-opacity-tablet="0.5"></div>');
    expect(e.plan.all).toHaveLength(1);
    expect(e.plan.all[0].bands).toHaveLength(1);
  });

  /** AUDIT A14 — the transition was built from the desktop plan alone. */
  it('builds a transition covering a property that only appears in a band', () => {
    const e = build('<div data-vera-motion data-vera-motion-translate-y="10px" data-vera-motion-blur-tablet="8px"></div>');
    expect(e.transition).toContain('transform');
    expect(e.transition).toContain('filter');
  });

  /**
   * These were declared in the schema and parsed, and then read by nothing —
   * both attributes did nothing at all.
   */
  it('honours a per-category inertia override', () => {
    const e = build(`<div data-vera-motion data-vera-motion-translate-y="10px" data-vera-motion-blur="4px"
      data-vera-motion-transform-inertia="2" data-vera-motion-filter-inertia="0.05"></div>`);
    expect(e.transition).toContain('transform 2s');
    expect(e.transition).toContain('filter 0.05s');
  });

  it('falls back to the base inertia for a category with no override', () => {
    const e = build(`<div data-vera-motion data-vera-motion-translate-y="10px" data-vera-motion-blur="4px"
      data-vera-motion-transform-inertia="2"></div>`);
    expect(e.transition).toContain('transform 2s');
    expect(e.transition).toContain('filter 1s');   // S fixture's base speed
  });

  it('a per-category inertia of 0 drops only that category from the transition', () => {
    const e = build(`<div data-vera-motion data-vera-motion-translate-y="10px" data-vera-motion-blur="4px"
      data-vera-motion-transform-inertia="0"></div>`);
    expect(e.transition).not.toContain('transform');
    expect(e.transition).toContain('filter');
  });

  it('has no transition at zero speed, so values track scroll exactly', () => {
    const e = build('<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-inertia="0"></div>');
    expect(e.transition).toBeNull();
  });
});

describe('keyframe positions resolve against geometry', () => {
  /**
   * Every absolute position divides by the scroll window — the element's own
   * size plus the viewport's — which is the same quantity a timeline position
   * is measured against. Taken from the environment rather than hard-coded, so
   * this says what the rule is rather than what happy-dom's defaults are. The
   * same arithmetic is checked against real Chromium layout in spike/units.mjs.
   */
  const WINDOW = () => 400 + window.innerHeight;
  const positions = (e, property) =>
    [...e.plan.all.find((a) => a.property.attribute === property).curve.positions];

  it('takes a percentage as the fraction it already is', () => {
    const e = build('<div data-vera-motion data-vera-motion-opacity="0% 0, 60% 1"></div>');
    expect(positions(e, 'opacity')).toEqual([0, 0.6]);
    expect(e.geometryDependent).toBe(false);
  });

  it.each([
    ['px', '650px 1', () => 650],
    ['vh', '50vh 1', () => window.innerHeight / 2],
    ['vw', '10vw 1', () => window.innerWidth / 10],
    ['rem', '2rem 1', () => 2 * parseFloat(getComputedStyle(document.documentElement).fontSize)],
  ])('divides a %s position by the scroll window', (_unit, raw, pixels) => {
    const e = build(`<div data-vera-motion data-vera-motion-opacity="${raw}"></div>`);
    /** The lone keyframe fills its missing end at 0%, so the authored one is second. */
    expect(positions(e, 'opacity')[1]).toBeCloseTo(pixels() / WINDOW(), 9);
    expect(e.geometryDependent).toBe(true);
  });

  it('records the authored range on the element, not the parse', () => {
    const e = build('<div data-vera-motion data-vera-motion-opacity="-50% 0, 150% 1"></div>');
    expect(e.lowestStart).toBeCloseTo(-0.5, 9);
    expect(e.highestEnd).toBeCloseTo(1.5, 9);
  });

  it('rebuilds a geometry-dependent curve in place when the element resizes', () => {
    const e = build('<div data-vera-motion data-vera-motion-opacity="650px 1"></div>');
    const before = e.plan.all[0].curve;
    expect(positions(e, 'opacity')[1]).toBeCloseTo(650 / WINDOW(), 9);

    Object.defineProperty(e.node, 'offsetHeight', { value: 900, configurable: true });
    resetElement(e, S);

    /** In place: the plan still holds the same typed arrays. */
    expect(e.plan.all[0].curve).toBe(before);
    expect(positions(e, 'opacity')[1]).toBeCloseTo(650 / (900 + window.innerHeight), 9);
  });

  it('leaves a percentage-only curve alone across a resize', () => {
    const e = build('<div data-vera-motion data-vera-motion-opacity="0% 0, 60% 1"></div>');
    Object.defineProperty(e.node, 'offsetHeight', { value: 900, configurable: true });
    resetElement(e, S);
    expect(positions(e, 'opacity')).toEqual([0, 0.6]);
  });
});

describe('perspective makes the 3D properties do something', () => {
  /**
   * Measured in Chromium: `translateZ(200px)` leaves a 100x100 box at exactly
   * 100x100 with no perspective, and doubles it with one. Without this setting
   * `data-vera-motion-translate-z` was inert unless the author happened to put a
   * `perspective` on an ancestor themselves, and nothing in the library said so.
   */
  it('prefixes the transform, so it applies to the functions after it', () => {
    const e = build(`<div data-vera-motion data-vera-motion-perspective="400px"
      data-vera-motion-translate-z="0% 0px, 100% 200px"></div>`);
    e.timelinePosition = 1;
    animateElement(e);
    expect(e.node.style.transform).toBe('perspective(400px) translateZ(200px)');
  });

  it('defaults a bare number to px, like every other length setting', () => {
    const e = build('<div data-vera-motion data-vera-motion-perspective="400" data-vera-motion-scale="2"></div>');
    expect(e.node.style.transform || e.transformPrefix).toContain('perspective(400px)');
  });

  it('composes with the compositor prefix, perspective first', () => {
    const e = build(`<div data-vera-motion data-vera-motion-perspective="400px"
      data-vera-motion-translate-z="0% 0px, 100% 200px"></div>`, { ...S, translateZFix: true });
    expect(e.transformPrefix).toBe('perspective(400px) translateZ(0px)');
  });

  it('adds nothing when unset', () => {
    const e = build('<div data-vera-motion data-vera-motion-scale="0% 1, 100% 2"></div>');
    expect(e.transformPrefix).toBe('');
    e.timelinePosition = 1;
    animateElement(e);
    expect(e.node.style.transform).toBe('scale(2)');
  });

  it('rejects a perspective that is not a length', () => {
    const e = build('<div data-vera-motion data-vera-motion-perspective="far" data-vera-motion-scale="2"></div>');
    expect(e.parsed.rejected.join(' | '))
      .toContain('data-vera-motion-perspective: is not a length');
    expect(e.transformPrefix).toBe('');
  });
});

describe('stagger shifts the curve, in whatever unit it was written', () => {
  const positions = (e) => [...e.plan.all[0].curve.positions];

  const grid = (attrs, index) => {
    document.body.innerHTML =
      `<div ${attrs}>${'<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>'.repeat(3)}</div>`;
    const node = document.querySelectorAll('[data-vera-motion]')[index];
    Object.defineProperty(node, 'offsetTop', { value: 1000, configurable: true });
    Object.defineProperty(node, 'offsetHeight', { value: 400, configurable: true });
    Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
    return createRuntimeElement(parseElement(node, ctx), S);
  };

  it('leaves the first element where it was', () => {
    expect(positions(grid('data-vera-motion-stagger="10"', 0))).toEqual([0, 1]);
  });

  it('shifts a percentage stagger straight onto the timeline', () => {
    expect(positions(grid('data-vera-motion-stagger="10"', 1))).toEqual([0.1, 1.1]);
    expect(positions(grid('data-vera-motion-stagger="10"', 2))).toEqual([0.2, 1.2]);
  });

  /**
   * The reason the offset is normalised at runtime rather than added at parse
   * time: a `px` stagger and a `%` keyframe measure different things until
   * both are timeline fractions.
   */
  it('normalises an absolute stagger against the same scroll window a position uses', () => {
    const e = grid('data-vera-motion-stagger="650px"', 1);
    const step = 650 / (400 + window.innerHeight);
    expect(positions(e)[0]).toBeCloseTo(step, 9);
    expect(positions(e)[1]).toBeCloseTo(1 + step, 9);
  });

  it('marks an absolute stagger as geometry-dependent, and a percentage not', () => {
    expect(grid('data-vera-motion-stagger="10vh"', 1).geometryDependent).toBe(true);
    expect(grid('data-vera-motion-stagger="10"', 1).geometryDependent).toBe(false);
  });

  it('rebuilds an absolute stagger when the element resizes', () => {
    const e = grid('data-vera-motion-stagger="650px"', 1);
    Object.defineProperty(e.node, 'offsetHeight', { value: 900, configurable: true });
    resetElement(e, S);
    expect(positions(e)[0]).toBeCloseTo(650 / (900 + window.innerHeight), 9);
  });

  it('moves the authored range with it, so the tracker still covers the animation', () => {
    const e = grid('data-vera-motion-stagger="10"', 2);
    expect(e.lowestStart).toBeCloseTo(0.2, 9);
    expect(e.highestEnd).toBeCloseTo(1.2, 9);
  });

  it('runs a row in reverse for a negative step', () => {
    expect(positions(grid('data-vera-motion-stagger="-10"', 2))).toEqual([-0.2, 0.8]);
  });
});

describe('width bands merge onto the base', () => {
  const curveOf = (e) => e.plan.all[0].curve;
  const pairs = (e) => [...curveOf(e).positions].map((p, i) => [p, curveOf(e).values[i]]);

  const at = (html, width) => {
    const e = build(html);
    resetElement(e, S, win(0, width));
    return e;
  };

  const BASE = '<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 100px; [0-500]: 100% 20px"></div>';

  it('uses the base outside every band', () => {
    expect(pairs(at(BASE, 1200))).toEqual([[0, 0], [1, 100]]);
  });

  /** Merge, not replace: the 0% start survives and only the end is overridden. */
  it('overrides only the keyframe at the same position', () => {
    expect(pairs(at(BASE, 400))).toEqual([[0, 0], [1, 20]]);
  });

  it('adds a keyframe the base does not have', () => {
    const e = at('<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1; [0-500]: 50% 0.9"></div>', 400);
    expect(pairs(e)).toEqual([[0, 0], [0.5, 0.9], [1, 1]]);
  });

  it('applies later bands over earlier ones where they overlap', () => {
    const html = `<div data-vera-motion
      data-vera-motion-opacity="0% 0, 100% 1; [0-800]: 100% 0.5; [0-400]: 100% 0.2"></div>`;
    expect(pairs(at(html, 300)).at(-1)).toEqual([1, 0.2]);
    expect(pairs(at(html, 600)).at(-1)).toEqual([1, 0.5]);
  });

  it('honours an open-ended band', () => {
    const html = '<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1; [900+]: 100% 0.3"></div>';
    expect(pairs(at(html, 1400)).at(-1)).toEqual([1, 0.3]);
    expect(pairs(at(html, 800)).at(-1)).toEqual([1, 1]);
  });

  /** The lone-keyframe fill happens after merging, so a band can supply the end. */
  it('fills a lone keyframe after merging, not before', () => {
    const e = at('<div data-vera-motion data-vera-motion-opacity="[0-500]: 0% 0.25"></div>', 400);
    expect(pairs(e)).toEqual([[0, 0.25], [1, 1]]);
  });

  it('leaves an element inert where no band applies and there is no base', () => {
    const e = at('<div data-vera-motion data-vera-motion-opacity="[0-500]: 0% 0.25"></div>', 1200);
    expect(pairs(e)).toEqual([[0, 1], [1, 1]]);
  });

  it('rebuilds when the viewport crosses a band edge', () => {
    const e = build(BASE);
    resetElement(e, S, win(0, 1200));
    expect(pairs(e).at(-1)).toEqual([1, 100]);
    resetElement(e, S, win(0, 400));
    expect(pairs(e).at(-1)).toEqual([1, 20]);
    resetElement(e, S, win(0, 1200));
    expect(pairs(e).at(-1)).toEqual([1, 100]);
  });
});

describe('the two easings do different jobs', () => {
  const valueAt = (e, t) => { e.timelinePosition = t; animateElement(e); return e.node.style.transform; };

  it('data-vera-motion-ease shapes the curve, and does not appear in the transition', () => {
    const e = build(`<div data-vera-motion data-vera-motion-ease="ease-in-out"
      data-vera-motion-translate-y="0% 0px, 100% 500px"></div>`);
    expect(valueAt(e, 0.25)).toBe('translateY(64.581px)');   // a linear curve would be 125
    /** The curve easing is evaluated here; only inertia-ease reaches CSS. */
    expect(e.transition).not.toContain('ease-in-out');
  });

  it('data-vera-motion-inertia-ease shapes the transition, and does not touch the curve', () => {
    const e = build(`<div data-vera-motion data-vera-motion-inertia-ease="ease-in-out"
      data-vera-motion-translate-y="0% 0px, 100% 500px"></div>`);
    expect(valueAt(e, 0.25)).toBe('translateY(125px)');      // curve untouched
    expect(e.transition).toContain('ease-in-out');
  });

  it('lets an element use both at once, independently', () => {
    const e = build(`<div data-vera-motion data-vera-motion-ease="ease-in"
      data-vera-motion-inertia-ease="ease-out" data-vera-motion-inertia="0.4"
      data-vera-motion-translate-y="0% 0px, 100% 500px"></div>`);
    expect(Number(/translateY\(([\d.]+)px\)/.exec(valueAt(e, 0.5))[1])).toBeLessThan(250);
    expect(e.transition).toBe('transform 0.4s ease-out');
  });

  /** Default `linear` is what keeps every existing animation byte-identical. */
  it('defaults the curve to a straight line', () => {
    const e = build('<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 500px"></div>');
    expect(valueAt(e, 0.25)).toBe('translateY(125px)');
    expect(valueAt(e, 0.5)).toBe('translateY(250px)');
    expect(valueAt(e, 0.75)).toBe('translateY(375px)');
  });

  it('falls back to the instance easing when the element declares none', () => {
    const e = build('<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 500px"></div>',
      { ...S, ease: 'ease-in-out' });
    expect(valueAt(e, 0.25)).toBe('translateY(64.581px)');
  });

  it('keeps the easing across a geometry rebuild', () => {
    const e = build(`<div data-vera-motion data-vera-motion-ease="ease-in-out"
      data-vera-motion-translate-y="0px 0px, 1300px 500px"></div>`);
    const before = valueAt(e, 0.25);
    resetElement(e, S);
    expect(valueAt(e, 0.25)).toBe(before);
  });

  it('rejects a curve easing that is not a timing function', () => {
    const e = build(`<div data-vera-motion data-vera-motion-ease="linear, all 9999s linear"
      data-vera-motion-translate-y="0% 0px, 100% 500px"></div>`);
    expect(e.parsed.rejected.join(' | '))
      .toContain('data-vera-motion-ease: is not an easing name');
    expect(valueAt(e, 0.25)).toBe('translateY(125px)');      // falls back to the default
  });
});

describe('updateElement', () => {
  it('writes a composed transform in schema order', () => {
    const e = build(`<div data-vera-motion data-vera-motion-scale="0% 0.5, 100% 1"
      data-vera-motion-translate-y="0% 40px, 100% 0px"></div>`);
    updateElement(e, win(1200), S);
    const t = e.node.style.transform;
    expect(t.indexOf('translateY')).toBeLessThan(t.indexOf('scale'));
  });

  /**
   * Width bands are resolved when the element is measured, not per frame —
   * `getScreenType` used to run once per element per frame to answer a
   * question that only changes on resize.
   */
  it('resolves the width band at measure time', () => {
    const e = build(`<div data-vera-motion data-vera-motion-translate-y="100px"
      data-vera-motion-translate-y-tablet="50px"></div>`);
    const endValue = () => e.plan.all[0].curve.values[e.plan.all[0].curve.values.length - 1];

    resetElement(e, S, win(0, 1400));
    expect(endValue()).toBe(100);

    resetElement(e, S, win(0, 800));
    expect(endValue()).toBe(50);
  });

  /**
   * AUDIT A12/A13 — two object literals were built and discarded every call:
   * one to ask getElementPosition a question whose answer nothing read, and
   * one to pass breakpoint settings by name.
   *
   * Asserting "allocates nothing" would be false — composing the transform
   * string for the style write allocates, inherently. What is testable is that
   * the two avoidable ones are gone: the dead call by its absence, and the
   * other by getScreenType now taking primitives.
   */
  it('no longer computes a position nothing reads', () => {
    const e = build('<div data-vera-motion data-vera-motion-translate-y="10px"></div>');
    updateElement(e, win(1200), S);
    expect('position' in e).toBe(false);
    expect('init' in e).toBe(false);
  });

  it('a run-once animation does not walk backwards once it has played', () => {
    const e = build(`<div data-vera-motion data-vera-motion-run-once
      data-vera-motion-opacity="0% 0, 100% 1"></div>`);
    updateElement(e, win(4000), S);
    expect(e.runOnceRan).toBe(true);
    const settled = e.node.style.filter;
    updateElement(e, win(0), S);
    expect(e.node.style.filter).toBe(settled);
  });
});

/** 81% of writes were byte-identical to the previous one before this guard. */
describe('unchanged writes are skipped', () => {
  it('does not rewrite an identical transform', () => {
    const e = build('<div data-vera-motion data-vera-motion-translate-y="0% 40px, 100% 0px"></div>');
    updateElement(e, win(1200), S);
    const first = e.node.style.transform;

    const spy = vi.spyOn(e.node.style, 'transform', 'set');
    updateElement(e, win(1200), S);       // same scroll position
    expect(spy).not.toHaveBeenCalled();
    expect(e.node.style.transform).toBe(first);
    spy.mockRestore();
  });

  it('writes again when the value actually changes', () => {
    const e = build('<div data-vera-motion data-vera-motion-translate-y="0% 40px, 100% 0px"></div>');
    updateElement(e, win(1000), S);
    const first = e.node.style.transform;
    updateElement(e, win(1400), S);
    expect(e.node.style.transform).not.toBe(first);
  });

  /**
   * The failure mode of any such cache: clear the DOM but not the cache, and
   * the next write is skipped because it matches — leaving the element blank.
   */
  it('clearElement invalidates the cache so the next write lands', () => {
    const e = build('<div data-vera-motion data-vera-motion-translate-y="0% 40px, 100% 0px"></div>');
    updateElement(e, win(1200), S);
    const before = e.node.style.transform;
    expect(before).not.toBe('');

    clearElement(e, S);
    expect(e.node.style.transform).toBe('');

    updateElement(e, win(1200), S);
    expect(e.node.style.transform).toBe(before);
  });

  it('the same guard applies to plain CSS properties', () => {
    const e = build('<div data-vera-motion data-vera-motion-radius-top-left="0% 40px, 100% 0px"></div>');
    updateElement(e, win(1200), S);
    const first = e.node.style.getPropertyValue('border-top-left-radius');
    expect(first).not.toBe('');
    clearElement(e, S);
    updateElement(e, win(1200), S);
    expect(e.node.style.getPropertyValue('border-top-left-radius')).toBe(first);
  });
});

describe('reset and clear', () => {
  /**
   * The bug this guards: resetElement cleared style.transition, and the
   * ResizeObserver calls it at init — so the transition was written and
   * immediately wiped, and inertia did not work at all. Nothing asserted the
   * applied style, only the computed field, so 418 tests missed it.
   */
  it('resetElement does not clear the applied transition', () => {
    const e = build('<div data-vera-motion data-vera-motion-opacity="0"></div>');
    e.node.style.transition = e.transition;
    resetElement(e, S);
    expect(e.node.style.transition).toBe(e.transition);
  });

  it('resetElement writes nothing at all — it is a pure read', () => {
    const e = build('<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-pin="10px"></div>');
    setElementStyles(e, S);
    updateElement(e, win(1200), S);
    const before = e.node.getAttribute('style');
    resetElement(e, S);
    expect(e.node.getAttribute('style')).toBe(before);
  });

  it('resetElement clears animated styles but keeps configuration', () => {
    const e = build('<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-pin="20px"></div>');
    setElementStyles(e, S);
    updateElement(e, win(1200), S);
    expect(e.node.style.position).toBe('sticky');

    resetElement(e, S);
    expect(e.node.style.transform).toBe('');
    /** The pin is configuration — stripping it here is how it silently vanished. */
    expect(e.node.style.position).toBe('sticky');
  });

  it('clearElement removes configuration too', () => {
    const e = build('<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-pin="20px"></div>');
    setElementStyles(e, S);
    updateElement(e, win(1200), S);

    clearElement(e, S);
    expect(e.node.style.position).toBe('');
    expect(e.node.style.transform).toBe('');
  });

  it('re-measures on reset', () => {
    const e = build('<div data-vera-motion data-vera-motion-opacity="0"></div>');
    Object.defineProperty(e.node, 'offsetTop', { value: 2500, configurable: true });
    resetElement(e, S);
    expect(e.start).toBe(2500);
  });
});

describe('setTransitions', () => {
  /** AUDIT A15 — one animation frame per element, for writes that could share one. */
  it('schedules a single frame for the whole set', () => {
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    const els = [
      build('<div data-vera-motion data-vera-motion-opacity="0"></div>'),
      build('<div data-vera-motion data-vera-motion-opacity="0"></div>'),
      build('<div data-vera-motion data-vera-motion-opacity="0"></div>'),
    ];
    setTransitions(els);
    expect(raf).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('schedules nothing when no element has a transition', () => {
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    setTransitions([build('<div data-vera-motion data-vera-motion-opacity="0" data-vera-motion-inertia="0"></div>')]);
    expect(raf).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('setTransitions is cancellable', () => {
  it('setTransitions: a queued frame must not write after teardown', () => {
    /** A frame queue that honours cancellation — the thing under test. */
    const frames = new Map();
    let next = 0;
    vi.stubGlobal('requestAnimationFrame', (fn) => { frames.set(++next, fn); return next; });
    vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id));
    document.body.innerHTML = '<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>';
    const node = document.body.firstElementChild;
    const e = createRuntimeElement(parseElement(node, { origin: 'https://x.test/' }),
      { scrollDirection: 'vertical', inertia: 0.1, inertiaEase: 'linear', ease: 'linear' });

    const cancel = setTransitions([e]);
    node.style.transition = '';          // stands in for clearElement during destroy
    if (typeof cancel === 'function') cancel();
    for (const fn of frames.values()) fn();

    expect(node.style.transition, 'transition written after teardown').toBe('');
    vi.unstubAllGlobals();
  });
});
