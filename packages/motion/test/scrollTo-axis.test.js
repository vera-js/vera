import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

let calls = [];

beforeEach(() => {
  calls = [];
  document.body.innerHTML = '';
  vi.spyOn(window, 'scrollTo').mockImplementation((...args) => calls.push(args));
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollWidth', { value: 5000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientWidth', { value: 800, configurable: true });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/**
 * `window.scrollTo` takes both coordinates, so the axis that is not being
 * tweened has to be passed through rather than zeroed.
 */
describe('scrolling one axis leaves the other where it is', () => {
  it('keeps the horizontal position during a vertical scroll', async () => {
    vi.stubGlobal('scrollX', 250);
    vi.stubGlobal('scrollY', 0);
    const s = createScrollTo({ respectReducedMotion: false, duration: 0 });
    s.init();
    s.toPosition(400);
    await new Promise((r) => setTimeout(r, 40));

    expect(calls.length).toBeGreaterThan(0);
    for (const [x, y] of calls) {
      expect(x, 'horizontal position must be preserved').toBe(250);
      expect(y).toBe(400);
    }
    s.destroy();
  });

  it('keeps the vertical position during a horizontal scroll', async () => {
    vi.stubGlobal('scrollX', 0);
    vi.stubGlobal('scrollY', 175);
    const s = createScrollTo({
      respectReducedMotion: false, duration: 0, scrollDirection: 'horizontal',
    });
    s.init();
    s.toPosition(400);
    await new Promise((r) => setTimeout(r, 40));

    expect(calls.length).toBeGreaterThan(0);
    for (const [x, y] of calls) {
      expect(x).toBe(400);
      expect(y, 'vertical position must be preserved').toBe(175);
    }
    s.destroy();
  });
});
