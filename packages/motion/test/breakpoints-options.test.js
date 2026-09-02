import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { split } from '../src/split.ts';
import { wireMotion } from '../src/index.ts';
import { createMotion } from '../src/index.ts';

wireMotion([split]);

const MARKUP = '<div data-vm data-vm-opacity="0% 0, 100% 1" data-vm-opacity-mobile="0% 0.5, 100% 1"></div>';

describe('breakpoints edge values', () => {
  it('an empty object registers no names, and a suffix then reports as unknown', () => {
    document.body.innerHTML = MARKUP;
    const m = createMotion({ respectReducedMotion: false, breakpoints: {} });
    m.init();
    const why = m.rejected.flatMap((r) => r.rejected);
    expect(why.some((r) => r.includes('opacity-mobile'))).toBe(true);
    m.destroy();
  });

  it('null is tolerated rather than throwing a V8 message', () => {
    document.body.innerHTML = MARKUP;
    let threw = null;
    try {
      const m = createMotion({ respectReducedMotion: false, breakpoints: null });
      m.init();
      m.destroy();
    } catch (e) { threw = e.message; }
    expect(threw).toBeNull();
  });

  it('the defaults still register mobile and tablet', () => {
    document.body.innerHTML = MARKUP;
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    expect(m.rejected.flatMap((r) => r.rejected)).toEqual([]);
    m.destroy();
  });
});

describe('stagger in the wrong place', () => {
  const place = (n) => {
    Object.defineProperty(n, 'offsetTop', { value: 500, configurable: true });
    Object.defineProperty(n, 'offsetHeight', { value: 100, configurable: true });
    Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
  };

  /**
   * `stagger` is the only attribute that belongs on the parent, so putting it
   * on the element you want staggered is the obvious mistake. It did nothing
   * there and said nothing.
   */
  it('reports a stagger on an element with no animated descendants', () => {
    document.body.innerHTML =
      '<div data-vm data-vm-stagger="10%" data-vm-opacity="0% 0, 100% 1"></div>';
    place(document.body.firstElementChild);
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    expect(m.rejected.flatMap((r) => r.rejected).some((r) => r.includes('goes on the parent'))).toBe(true);
    m.destroy();
  });

  it('says nothing when it is on the parent, where it belongs', () => {
    document.body.innerHTML =
      '<div data-vm-stagger="10%">' +
      '<div data-vm data-vm-opacity="0% 0, 100% 1"></div>' +
      '<div data-vm data-vm-opacity="0% 0, 100% 1"></div></div>';
    document.querySelectorAll('[data-vm]').forEach(place);
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    expect(m.rejected.flatMap((r) => r.rejected)).toEqual([]);
    m.destroy();
  });

  /**
   * The documented pairing: a split heading staggering its own pieces. Those
   * descendants do not exist at parse time, so the check must not flag it.
   */
  it('exempts an element that is also being split', async () => {
    document.body.innerHTML =
      '<h1 data-vm data-vm-split="chars" data-vm-stagger="3"' +
      ' data-vm-opacity="0% 0, 100% 1">Hello there</h1>';
    place(document.body.firstElementChild);
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    await new Promise((r) => setTimeout(r, 40));
    expect(m.rejected.flatMap((r) => r.rejected)).toEqual([]);
    m.destroy();
  });
});
