import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/scroll-to.ts';

/**
 * `html { scroll-behavior: smooth }` is in a very large number of themes, and
 * the tween writes a scroll position every frame. With the rule in force the
 * browser animates each of those writes: two things animating one property, and
 * this module's duration, easing and offset all overridden.
 *
 * Worse than slow, it made `onComplete` a lie — the tween ends on elapsed time,
 * so it reported arrival at scrollY 94 with the target at 1,800, and
 * `manageFocus` moves focus on that signal. Measured in three engines by
 * `spikes/smooth-css.mjs`; what these pin is the taking and the giving back.
 */
let frames;

beforeEach(() => {
  frames = [];
  document.documentElement.removeAttribute('style');
  /**
   * Back to the top between tests. A finished tween leaves the page where it
   * sent it, and `toPosition` returns without starting anything when it is
   * already there — so the second test to ask for 1,800 tweened nothing, took
   * no `scroll-behavior`, and read as a defect in the giving back.
   */
  Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
  document.body.innerHTML =
    '<a id="link" href="#target">go</a><div id="target"></div>';
  const target = document.getElementById('target');
  Object.defineProperty(target, 'offsetTop', { value: 1800, configurable: true });
  Object.defineProperty(target, 'offsetParent', { value: null, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 700, configurable: true });
  /** Frames are run by hand, so the tween can be inspected part-way. */
  vi.stubGlobal('requestAnimationFrame', (fn) => { frames.push(fn); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('style');
});

const runFrames = (times, from = 0) => {
  for (let i = 0; i < times; i++) {
    const next = frames.shift();
    if (next) next(from + i * 100);
  }
};

describe('the tween and the page both animating the scroll', () => {
  it('takes scroll-behavior for its duration', () => {
    const s = createScrollTo({ duration: 600 });
    s.init();
    s.toPosition(1800);
    runFrames(1);
    expect(document.documentElement.style.scrollBehavior).toBe('auto');
    s.destroy();
  });

  it('gives it back when the tween finishes', () => {
    const s = createScrollTo({ duration: 600 });
    s.init();
    s.toPosition(1800);
    runFrames(12);
    expect(document.documentElement.style.scrollBehavior).toBe('');
    s.destroy();
  });

  /**
   * Setting a property on an element with no `style` attribute creates one, and
   * removing the property leaves it behind empty — `<html style="">` on every
   * page that ever used an anchor link.
   *
   * This passes here either way. happy-dom's `removeProperty` drops the emptied
   * attribute by itself, and it calls `removeAttribute('style')` to do it, so
   * neither the result nor a spy on the call can tell the guard from the host's
   * own behaviour. An assertion that cannot fail is worse than none, so there
   * is no test of the guard itself and no planted mutation for it —
   * `spikes/smooth-css.mjs` is where it is checked, in engines that keep the
   * empty attribute.
   */
  it('and does not leave an empty style attribute behind', () => {
    const s = createScrollTo({ duration: 600 });
    s.init();
    s.toPosition(1800);
    runFrames(12);
    expect(document.documentElement.getAttribute('style')).toBeNull();
    s.destroy();
  });

  it("restores the page's own inline value rather than its own", () => {
    document.documentElement.style.scrollBehavior = 'smooth';
    const s = createScrollTo({ duration: 600 });
    s.init();
    s.toPosition(1800);
    runFrames(1);
    expect(document.documentElement.style.scrollBehavior).toBe('auto');
    runFrames(12);
    expect(document.documentElement.style.scrollBehavior).toBe('smooth');
    s.destroy();
  });

  /** An interrupted tween has to give it back too, or the page keeps `auto`. */
  it('gives it back when the tween is interrupted', () => {
    const s = createScrollTo({ duration: 600 });
    s.init();
    s.toPosition(1800);
    runFrames(1);
    expect(document.documentElement.style.scrollBehavior).toBe('auto');
    s.destroy();
    expect(document.documentElement.getAttribute('style')).toBeNull();
  });

  /**
   * A tween that never starts must not touch it: a zero duration, or reduced
   * motion, arrives in one write and the browser animating that one write is
   * the page's business.
   */
  it('leaves it alone when there is no tween to protect', () => {
    const s = createScrollTo({ duration: 0 });
    s.init();
    s.toPosition(1800);
    expect(document.documentElement.getAttribute('style')).toBeNull();
    s.destroy();
  });
});
