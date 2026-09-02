/**
 * A throwing `onComplete`, at the end of a real tween.
 *
 * The two synchronous completion paths — a zero-length move and a zero-duration
 * one — hand the exception straight back to the caller's own `toPosition(…)`
 * call, which is what should happen: the consumer called the function and their
 * callback threw. Guarding those would swallow someone's error at the exact
 * line they wrote it on.
 *
 * The tween path is different. `done?.()` runs inside a `requestAnimationFrame`
 * callback, where nothing the consumer wrote can catch it, so whatever the
 * instance has not finished doing by that point stays undone. It does finish
 * first — `frame = null` and the final `writePosition` both precede the call.
 *
 * That ordering turns out **not to be observable**, and this file does not
 * claim to protect it: moving `done?.()` above both lines leaves every
 * assertion here passing. The reason is that the write at the top of `step`
 * has already landed on the destination by the time `elapsed >= duration` —
 * `easing(duration, start, change, duration)` is `start + change` for any
 * well-formed curve — so the final `writePosition` is a belt-and-braces write,
 * and the stale `frame` handle only ever reaches a `cancelAnimationFrame` for
 * a frame that has already run.
 *
 * What is asserted is the contract a page can actually depend on: the scroll
 * lands on its destination, the instance still works, and nothing is left
 * scheduled.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

let queue, handle, now, scrolled;

const flush = (frames = 400) => {
  for (let i = 0; i < frames && queue.length; i++) {
    const batch = queue; queue = []; now += 16.7;
    batch.forEach(([, fn]) => {
      /** The rAF boundary: an exception here reaches no caller, exactly as in a browser. */
      try { fn(now); } catch { /* swallowed by the frame, as the engine would */ }
    });
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

const boom = () => { throw new Error('consumer onComplete bug'); };

describe('onComplete throws at the end of a tween', () => {
  it('the scroll still lands exactly on its destination', () => {
    const s = createScrollTo({ duration: 300 });
    s.init();
    s.toPosition(1200, { onComplete: boom });
    flush();
    expect(scrolled[scrolled.length - 1]).toBe(1200);
    s.destroy();
  });

  it('and the instance can scroll again afterwards', () => {
    const s = createScrollTo({ duration: 300 });
    s.init();
    s.toPosition(1200, { onComplete: boom });
    flush();
    scrolled = [];
    s.toPosition(400);
    flush();
    expect(scrolled[scrolled.length - 1]).toBe(400);
    s.destroy();
  });

  it('leaves no frame in flight to cancel', () => {
    const s = createScrollTo({ duration: 300 });
    s.init();
    s.toPosition(1200, { onComplete: boom });
    flush();
    expect(queue).toHaveLength(0);
    s.destroy();
  });

  /**
   * The synchronous paths, asserted as the deliberate behaviour they are rather
   * than left ambiguous: the caller gets their own exception back.
   */
  it('a zero-duration move hands the exception to the caller', () => {
    const s = createScrollTo({ duration: 0 });
    s.init();
    expect(() => s.toPosition(1200, { onComplete: boom })).toThrow('consumer onComplete bug');
    expect(scrolled[scrolled.length - 1]).toBe(1200);
    s.destroy();
  });

  it('and so does a move of zero distance', () => {
    const s = createScrollTo({ duration: 300 });
    s.init();
    expect(() => s.toPosition(0, { onComplete: boom })).toThrow('consumer onComplete bug');
    s.destroy();
  });
});

/**
 * An `onComplete` that is not a function at all.
 *
 * `opts.onComplete?.()` calls anything that is not null or undefined, so
 * `{ onComplete: 5 }` threw `done is not a function` **out of a public
 * method** — taking down the caller's own click handler with a value the
 * library was handed.
 *
 * `createMotion` has guarded `onProgress` this way for a long time, on the
 * argument that a callback is the one option a page *builds* rather than
 * writes down, so it is the one most likely to arrive as whatever an
 * expression evaluated to. This is the same option on the other entry point,
 * and it had neither that guard nor the try/catch that goes with it.
 */
describe('an onComplete that is not a function', () => {
  const started = () => {
    const s = createScrollTo({ respectReducedMotion: false, duration: 100 });
    s.init();
    Object.defineProperty(document.getElementById('one'), 'offsetTop', { value: 1200, configurable: true });
    return s;
  };

  it('does not throw out of the public method', () => {
    const s = started();
    expect(() => s.toElement(document.getElementById('one'), { onComplete: 5 })).not.toThrow();
    s.destroy();
  });

  it('and says so, naming what it got', () => {
    const s = started();
    s.toElement(document.getElementById('one'), { onComplete: 'nope' });
    expect(s.rejected.map((problem) => problem.reason).join(' | '))
      .toContain('onComplete must be a function, not string');
    s.destroy();
  });

  /** The scroll still happens: the callback is not the point of the call. */
  it('and still scrolls', () => {
    const s = started();
    s.toElement(document.getElementById('one'), { onComplete: {} });
    flush();
    expect(scrolled.length).toBeGreaterThan(0);
    s.destroy();
  });

  it('and a real function is still called', () => {
    const s = started();
    let called = 0;
    s.toElement(document.getElementById('one'), { onComplete: () => { called += 1; } });
    flush();
    expect(called).toBeGreaterThan(0);
    s.destroy();
  });
});
