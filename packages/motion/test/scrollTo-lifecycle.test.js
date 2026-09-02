import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

let calls = [];

const page = () => {
  document.body.innerHTML = '<a id="l" href="#t">go</a><div id="t"></div>';
  const target = document.getElementById('t');
  Object.defineProperty(target, 'offsetTop', { value: 1200, configurable: true });
  Object.defineProperty(target, 'offsetHeight', { value: 300, configurable: true });
  Object.defineProperty(target, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => {
  calls = [];
  page();
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  vi.spyOn(window, 'scrollTo').mockImplementation((...args) => calls.push(args));
});
afterEach(() => { vi.restoreAllMocks(); });

const click = () => document.getElementById('l').click();

/**
 * `destroy()` returns the instance to how it was constructed. `enabled` did
 * not come back, so a disable/destroy/init cycle left every listener attached
 * and every click ignored — silently.
 */
describe('destroy returns a scroll-to instance to its constructed state', () => {
  it('scrolls again after disable, destroy and re-init', () => {
    const s = createScrollTo({ respectReducedMotion: false, duration: 0 });
    s.init();
    click();
    expect(calls).toHaveLength(1);

    calls.length = 0;
    s.disable();
    s.destroy();
    s.init();

    expect(s.enabled).toBe(true);
    click();
    expect(calls).toHaveLength(1);
    s.destroy();
  });

  it('still honours a disable that was not followed by a destroy', () => {
    const s = createScrollTo({ respectReducedMotion: false, duration: 0 });
    s.init();
    s.disable();
    click();
    expect(calls).toEqual([]);

    s.enable();
    click();
    expect(calls).toHaveLength(1);
    s.destroy();
  });

  it('drops diagnostics for a page it no longer looks at', () => {
    document.body.innerHTML = '<a id="l" href="#missing">go</a>';
    const s = createScrollTo({ respectReducedMotion: false, duration: 0 });
    s.init();
    expect(s.rejected).toHaveLength(1);
    expect(s.rejected[0].reason).toMatch(/missing/);

    s.destroy();
    expect(s.rejected).toEqual([]);
  });
});
