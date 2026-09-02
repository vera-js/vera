import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

const place = (n, top = 500) => {
  Object.defineProperty(n, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};
const MARKUP =
  '<div data-vm data-vm-translate-y="0% 0px, 100% 40px" data-vm-opacity="0% 0, 100% 1"></div>';

const saved = {};
const remove = (name) => { saved[name] = globalThis[name]; delete globalThis[name]; };
/**
 * Restored with defineProperty, not assignment: some of these are read-only
 * accessors on globalThis, and plain assignment throws — which failed the test
 * during cleanup while every case it was checking had actually survived.
 */
const restoreAll = () => {
  for (const [k, v] of Object.entries(saved)) {
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
    delete saved[k];
  }
};

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { restoreAll(); vi.restoreAllMocks(); });

describe('degraded environments', () => {
  const withMotion = (label, prepare) => {
    document.body.innerHTML = MARKUP;
    const node = document.body.firstElementChild;
    place(node);
    prepare?.();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let threw = null;
    let styled = false;
    try {
      const m = createMotion({ respectReducedMotion: false, inertia: 0 });
      m.init();
      m.refresh();
      m.disable();
      m.enable();
      /** Read before teardown — destroy() clears the styles by design. */
      styled = node.style.transform !== '';
      m.destroy();
    } catch (e) { threw = e.message; }
    warn.mockRestore();
    return { label, threw, styled };
  };

  it('degrades rather than throwing when an observer is missing', () => {
    const results = [
      withMotion('everything present'),
      withMotion('no IntersectionObserver', () => remove('IntersectionObserver')),
      withMotion('no MutationObserver', () => remove('MutationObserver')),
      withMotion('no ResizeObserver', () => remove('ResizeObserver')),
      withMotion('no matchMedia', () => { saved.matchMedia = window.matchMedia; delete window.matchMedia; }),
      withMotion('IntersectionObserver throws', () => {
        saved.IntersectionObserver = globalThis.IntersectionObserver;
        globalThis.IntersectionObserver = class { constructor() { throw new Error('boom'); } };
      }),
    ];
    expect(results.filter((r) => r.threw)).toEqual([]);
    /**
     * Not throwing is not the contract. The tracker "can subtract work, never
     * withhold it", so every degraded case must still paint — falling back to
     * iterating the whole element list, which is what no-tracker means.
     */
    expect(results.filter((r) => !r.styled).map((r) => r.label)).toEqual([]);
    restoreAll();
  });

  it('scroll-to degrades the same way', () => {
    const run = (label, prepare) => {
      document.body.innerHTML = '<nav><a id="l" href="#t">go</a></nav><section id="t"></section>';
      place(document.getElementById('t'), 900);
      prepare?.();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let threw = null;
      try {
        const s = createScrollTo();
        s.init();
        s.collect();
        s.refresh();
        s.destroy();
      } catch (e) { threw = e.message; }
      warn.mockRestore();
      return { label, threw };
    };
    const results = [
      run('everything present'),
      run('no ResizeObserver', () => remove('ResizeObserver')),
      run('no CSS.escape', () => { saved.CSS = globalThis.CSS; globalThis.CSS = {}; }),
      run('no history.replaceState', () => {
        saved.history = globalThis.history;
        Object.defineProperty(globalThis, 'history', { value: {}, configurable: true });
      }),
    ];
    expect(results.filter((r) => r.threw)).toEqual([]);
    restoreAll();
  });
});
