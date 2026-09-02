/**
 * Retargeting, cancelling, and noticing that the page moved underneath.
 *
 * Three behaviours nothing held. The first two are what a visitor does — click
 * a second link while the first is still travelling, or abandon it — and the
 * third is what the page does to itself: targets are measured once, so a layout
 * change makes every stored `start` and `end` a lie until something re-measures.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

let queue, handle, now, scrolled;
const frames = (count) => {
  for (let i = 0; i < count && queue.length; i++) {
    const batch = queue; queue = []; now += 16.7;
    batch.forEach(([, fn]) => fn(now));
  }
};
const settle = () => frames(400);

const place = (node, top) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 600, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

const page = () => {
  document.body.innerHTML =
    '<nav><a id="a" href="#one">1</a><a id="b" href="#two">2</a></nav>' +
    '<section id="one"></section><section id="two"></section>';
  place(document.getElementById('one'), 1000);
  place(document.getElementById('two'), 3000);
};

const click = (id) =>
  document.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

beforeEach(() => {
  queue = []; handle = 0; now = 0; scrolled = [];
  vi.stubGlobal('requestAnimationFrame', (fn) => { const h = ++handle; queue.push([h, fn]); return h; });
  vi.stubGlobal('cancelAnimationFrame', (h) => { queue = queue.filter(([q]) => q !== h); });
  vi.stubGlobal('scrollTo', vi.fn((x, y) => {
    scrolled.push(y);
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  }));
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  page();
});
afterEach(() => vi.unstubAllGlobals());

describe('a second click while the first is still travelling', () => {
  it('retargets rather than fighting', () => {
    const s = createScrollTo({ duration: 500 });
    s.init();
    click('a');
    frames(5);
    expect(scrolled.at(-1)).toBeGreaterThan(0);
    expect(scrolled.at(-1)).toBeLessThan(1000);

    click('b');
    settle();
    expect(scrolled.at(-1)).toBe(3000);
    expect(queue).toHaveLength(0);

    /**
     * The endpoint alone cannot tell retargeting from two tweens fighting:
     * both land on 3000, because the second one starts later and so finishes
     * last. What separates them is the journey — a single tween only ever
     * travels down the page, while two of them pull towards 1000 and 3000 in
     * alternate frames.
     */
    expect(scrolled, 'positions only ever move down the page').toEqual(
      [...scrolled].sort((first, second) => first - second)
    );
    s.destroy();
  });
});

describe('cancel()', () => {
  it('stops the tween where it is', () => {
    const s = createScrollTo({ duration: 500 });
    s.init();
    click('a');
    frames(5);
    const stopped = scrolled.length;

    s.cancel();
    settle();

    expect(scrolled).toHaveLength(stopped);
    s.destroy();
  });
});

describe('a layout change', () => {
  /**
   * The debounce is 100ms, in `resizeListener`. Worth asserting the timing as
   * well as the outcome: a probe that flushed animation frames but never
   * advanced timers reported that a resize does not re-measure at all, which
   * looked exactly like a defect.
   */
  it('re-measures targets, after the resize debounce', () => {
    vi.useFakeTimers();
    const s = createScrollTo({ activeClass: 'here', activeThreshold: 0.5 });
    s.init();
    Object.defineProperty(window, 'scrollY', { value: 1050, configurable: true });
    s.update();
    expect(document.getElementById('a').classList.contains('here')).toBe(true);

    place(document.getElementById('one'), 5000);
    place(document.getElementById('two'), 7000);
    window.dispatchEvent(new Event('resize'));

    expect(document.getElementById('a').classList.contains('here'), 'still stale mid-debounce').toBe(true);
    vi.advanceTimersByTime(150);
    expect(document.getElementById('a').classList.contains('here'), 're-measured').toBe(false);

    s.destroy();
    vi.useRealTimers();
  });
});
