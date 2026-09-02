/**
 * `toPosition` clamps what it is given.
 *
 * `toElement` was clamped, through `destinationFor`, and `toPosition` was not —
 * so the public method that takes a raw number animated towards somewhere the
 * container cannot reach. The endpoint was always right, because a browser
 * clamps a scroll write of its own accord; what was wrong is the trip. The page
 * arrived early and sat still while the tween ran out its duration, and
 * everything in `onComplete` — the hash update, the focus move — waited for a
 * journey that had already finished.
 *
 * The clamp now lives in `toPosition` only, which is the one place both paths
 * go through.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

let queue, handle, now, scrolled;
const MAX = 6000 - 800;

const flush = (frames = 400) => {
  for (let i = 0; i < frames && queue.length; i++) {
    const batch = queue; queue = []; now += 16.7;
    batch.forEach(([, fn]) => fn(now));
  }
};

beforeEach(() => {
  queue = []; handle = 0; now = 0; scrolled = [];
  vi.stubGlobal('requestAnimationFrame', (fn) => { const h = ++handle; queue.push([h, fn]); return h; });
  vi.stubGlobal('cancelAnimationFrame', (h) => { queue = queue.filter(([q]) => q !== h); });
  vi.stubGlobal('scrollTo', vi.fn((x, y) => {
    scrolled.push(y);
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  }));
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  document.body.innerHTML = '<nav><a href="#one">one</a></nav><section id="one"></section>';
});
afterEach(() => vi.unstubAllGlobals());

describe('a destination past the end', () => {
  it('never writes a position the container cannot reach', () => {
    const s = createScrollTo({ duration: 300 });
    s.init();
    s.toPosition(MAX * 20);
    flush();
    expect(Math.max(...scrolled)).toBeLessThanOrEqual(MAX);
    s.destroy();
  });

  /**
   * The symptom, rather than the cause: unclamped, the tween covered the
   * reachable distance in its first fraction and then wrote the same value for
   * the rest. Half way through it should still be well short of the end.
   */
  it('is still travelling half way through, rather than parked at the end', () => {
    const s = createScrollTo({ duration: 300, easing: 'easeLinear' });
    s.init();
    s.toPosition(MAX * 20);
    flush(9);
    expect(scrolled.at(-1)).toBeLessThan(MAX * 0.9);
    flush();
    expect(scrolled.at(-1)).toBe(MAX);
    s.destroy();
  });

  it('and arrives exactly at the maximum', () => {
    const s = createScrollTo({ duration: 0 });
    s.init();
    s.toPosition(MAX * 20);
    flush();
    expect(scrolled.at(-1)).toBe(MAX);
    s.destroy();
  });
});

describe('a negative destination', () => {
  it('clamps to the top', () => {
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true });
    const s = createScrollTo({ duration: 0 });
    s.init();
    s.toPosition(-5000);
    flush();
    expect(scrolled.at(-1)).toBe(0);
    s.destroy();
  });
});

describe('toElement still arrives where it did', () => {
  it('with the clamp moved out of destinationFor', () => {
    const target = document.getElementById('one');
    Object.defineProperty(target, 'offsetTop', { value: 1000, configurable: true });
    Object.defineProperty(target, 'offsetHeight', { value: 600, configurable: true });
    Object.defineProperty(target, 'offsetParent', { value: null, configurable: true });

    const s = createScrollTo({ duration: 0, offset: 120 });
    s.init();
    s.toElement(target);
    flush();
    expect(scrolled.at(-1)).toBe(880);
    s.destroy();
  });
});

/**
 * And refuses what it cannot clamp.
 *
 * `parseInt` of a data attribute, offset arithmetic that touched an
 * `undefined`, a position computed from an element that is not laid out — every
 * one of them hands a **public method taking a number** a `NaN`, which is the
 * one place a caller's mistake arrives undeclared. `Math.min(NaN, max)` is
 * `NaN`, so the clamp above passes it straight through: measured before the
 * guard, a 30ms tween ran its whole duration writing 27 scroll positions that
 * moved nothing, and `onComplete` fired as though it had arrived.
 */
describe('toPosition refuses a destination that is not a number', () => {
  for (const [name, value] of [['NaN', Number.NaN], ['Infinity', Infinity], ['a string', '400']]) {
    it(`does not tween towards ${name}`, () => {
      const s = createScrollTo({ duration: 300 });
      s.init();

      let arrived = false;
      s.toPosition(value, { onComplete: () => { arrived = true; } });
      flush();

      expect(scrolled, 'nothing was written').toEqual([]);
      expect(arrived, 'and the caller is not left hanging').toBe(true);
      expect(s.rejected.map((entry) => entry.node)).toEqual([null]);
      expect(s.rejected[0].reason).toContain('not a number');
      s.destroy();
    });
  }

  /** A real destination still travels, which is the control. */
  it('and still tweens to a real one', () => {
    const s = createScrollTo({ duration: 300 });
    s.init();
    s.toPosition(1200);
    flush();
    expect(scrolled.at(-1)).toBe(1200);
    expect(s.rejected).toEqual([]);
    s.destroy();
  });
});
