import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('scrollTo', vi.fn());
  document.body.innerHTML = '';
});
afterEach(() => vi.unstubAllGlobals());

/** happy-dom has no layout, so the target gets stubbed offsets. */
const addAnchor = (attributes = '') => {
  document.body.innerHTML =
    `<nav><a id="l" href="#one" ${attributes}>one</a></nav><section id="one"></section>`;
  const el = document.getElementById('one');
  Object.defineProperty(el, 'offsetTop', { value: 1000, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: 800, configurable: true });
  Object.defineProperty(el, 'offsetParent', { value: null, configurable: true });
};

/**
 * Records whether *the library* prevented the default, then prevents it
 * regardless.
 *
 * The tests below deliberately leave modified clicks un-prevented, which is
 * the whole point — and happy-dom responds by attempting a real `window.open`
 * to `http://localhost:3000/#one`. The resulting connection failure surfaced
 * as an unhandled rejection that killed the worker pool, so the suite hung
 * rather than failed. Reading the flag before preventing keeps the assertion
 * honest without asking the environment to navigate.
 */
const click = (init = {}) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  let preventedByLibrary = false;
  const real = event.preventDefault.bind(event);
  event.preventDefault = () => {
    preventedByLibrary = true;
    real();
  };
  document.getElementById('l').dispatchEvent(event);
  real();
  return preventedByLibrary;
};

describe('modified clicks are left to the browser', () => {
  /**
   * A modified click on a link is a request to open it somewhere else. Calling
   * preventDefault() on those took new-tab and new-window away from every
   * in-page anchor on the site.
   */
  it('intercepts a plain click', () => {
    addAnchor();
    const s = createScrollTo();
    s.init();
    expect(click()).toBe(true);
    s.destroy();
  });

  for (const [name, init] of [
    ['meta', { metaKey: true }],
    ['ctrl', { ctrlKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['middle button', { button: 1 }],
  ]) {
    it(`leaves a ${name} click alone`, () => {
      addAnchor();
      const s = createScrollTo();
      s.init();
      expect(click(init)).toBe(false);
      s.destroy();
    });
  }

  it('leaves target="_blank" alone', () => {
    addAnchor('target="_blank"');
    const s = createScrollTo();
    s.init();
    expect(click()).toBe(false);
    s.destroy();
  });
});

describe('links added after init', () => {
  /**
   * init() used to return early when collect() found no links, leaving the
   * instance started with nothing listening — so collect(), the method
   * documented as "call after the page adds or removes some", had no
   * listeners to feed. A nav rendered after init was silently dead.
   */
  it('collect() works even when there were no anchors at init', () => {
    const s = createScrollTo();
    s.init();
    addAnchor();
    s.collect();
    expect(click()).toBe(true);
    s.destroy();
  });

  it('control: an anchor present at init still works', () => {
    addAnchor();
    const s = createScrollTo();
    s.init();
    expect(click()).toBe(true);
    s.destroy();
  });
});
