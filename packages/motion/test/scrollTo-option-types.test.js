import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

/**
 * Three options that were checked for the wrong thing, or not at all.
 *
 * Every *value* has been checked since decision 31 — `offset`,
 * `activeThreshold`, `duration`, `easing`, `selector`, `scrollElement`. What
 * was missing was a **range**, a **token**, and a **type**.
 */
const place = (node, top) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 600, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  document.body.innerHTML = '<nav><a id="l" href="#one">one</a></nav><section id="one"></section>';
  place(document.getElementById('one'), 0);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const reasons = (s) => s.rejected.map((entry) => entry.reason).join(' | ');

/**
 * `classList.toggle` throws on an empty string and on one containing
 * whitespace — `SyntaxError` and `InvalidCharacterError`, verified in Chromium,
 * WebKit and Firefox. `update()` runs from the scroll listener, so a bad class
 * did not fail at `init()` where someone is looking: it threw on the first
 * frame a link became current, and on every frame after that. happy-dom throws
 * on neither, so what this pins is the refusal rather than the throw.
 */
describe('activeClass that is not a single class name', () => {
  for (const [name, value] of [['empty', ''], ['two classes', 'nav-link active'], ['a number', 42]]) {
    it(`refuses ${name} and falls back`, () => {
      const s = createScrollTo({ activeClass: value });
      s.init();
      s.update();

      expect(reasons(s)).toContain('activeClass');
      expect(document.getElementById('l').className, 'the default is used instead').toBe('active');
      s.destroy();
    });
  }

  it('and leaves a real one alone', () => {
    const s = createScrollTo({ activeClass: 'is-current' });
    s.init();
    s.update();
    expect(s.rejected).toEqual([]);
    expect(document.getElementById('l').className).toBe('is-current');
    s.destroy();
  });
});

describe('activeThreshold outside the viewport it is a fraction of', () => {
  for (const value of [5, -1]) {
    it(`refuses ${value}`, () => {
      const s = createScrollTo({ activeThreshold: value });
      s.init();
      expect(reasons(s)).toContain('activeThreshold');
      s.destroy();
    });
  }

  for (const value of [0, 1, 0.25]) {
    it(`leaves ${value} alone, which is inside it`, () => {
      const s = createScrollTo({ activeThreshold: value });
      s.init();
      expect(s.rejected).toEqual([]);
      s.destroy();
    });
  }
});

/**
 * The misleading one: a string root made `root.querySelectorAll` throw, the
 * `catch` around it assumes a malformed selector, and the instance reported
 * "selector is not valid CSS: a[href*=\"#\"]" — about the default selector,
 * which is perfectly valid.
 */
describe('a root that is not a node', () => {
  for (const [name, value] of [['a string', 'body'], ['a number', 42]]) {
    it(`says so, rather than blaming the selector, when it is ${name}`, () => {
      const s = createScrollTo({ root: value });
      s.init();

      expect(reasons(s)).toContain('root is not an element');
      expect(reasons(s), 'and does not accuse the selector').not.toContain('not valid CSS');
      /** The document is scanned instead, so the link still works. */
      expect(s.rejected.filter((entry) => entry.node !== null)).toEqual([]);
      s.destroy();
    });
  }

  /**
   * And an **element** root works, which it did not.
   *
   * `root: document.querySelector('nav')` is the natural way to say "only
   * these links", and every one of them reported `no element with id "..."`:
   * target lookup was scoped to the root too, and the sections an anchor
   * points at are outside the nav. Scoping to the root is what audit SC2 fixed
   * for shadow roots, where ids really are private; the root is searched first
   * and then the tree it is in, which is the same tree in both cases.
   */
  it('and an element root finds a target outside itself', () => {
    document.body.innerHTML =
      '<div id="host"><a href="#one">one</a></div><section id="one"></section>';
    place(document.getElementById('one'), 0);
    const s = createScrollTo({ root: document.getElementById('host') });
    s.init();

    expect(s.rejected).toEqual([]);
    expect(document.getElementById('one').hasAttribute('data-vera-motion-scroll-target')).toBe(true);
    s.destroy();
  });

  /** And a link *outside* the root is still not collected, which is the point of it. */
  it('while still collecting only the links inside it', () => {
    document.body.innerHTML =
      '<div id="host"><a href="#one">in</a></div><a href="#one">out</a><section id="one"></section>';
    place(document.getElementById('one'), 0);
    const s = createScrollTo({ root: document.getElementById('host') });
    s.init();
    s.update();

    const [inside, outside] = document.querySelectorAll('a');
    expect(inside.className).toBe('active');
    expect(outside.className).toBe('');
    s.destroy();
  });
});
