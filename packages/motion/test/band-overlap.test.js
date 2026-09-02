import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { parseBandedList, getProperty } from '../src/modules/schema.ts';
import { createMotion } from '../src/index.ts';

const P = 'data-vera-motion';
const ty = getProperty('translate-y');
const place = (n) => {
  Object.defineProperty(n, 'offsetTop', { value: 500, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};
const width = (w) => {
  Object.defineProperty(document.documentElement, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
};

beforeEach(() => { document.body.innerHTML = ''; width(1200); });

/**
 * Bands are inclusive at both ends, which the reference says — so `[0-700]`
 * and `[700+]`, the obvious way to write a partition, both match at exactly
 * 700. Something has to win, and which one was not written down anywhere.
 */
describe('bands that overlap', () => {
  it('lets the later declaration win at a shared edge', () => {
    document.body.innerHTML =
      `<div ${P} ${P}-translate-y="0% 0px, 100% 10px; [0-700]: 100% 1px; [700+]: 100% 2px"></div>`;
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    Object.defineProperty(window, 'scrollY', { value: 5000, configurable: true });

    width(699); m.refresh();
    expect(node.style.transform).toBe('translateY(1px)');
    width(701); m.refresh();
    expect(node.style.transform).toBe('translateY(2px)');
    /** Both bands match here. The one written last is the one that applies. */
    width(700); m.refresh();
    expect(node.style.transform).toBe('translateY(2px)');

    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    m.destroy();
  });

  it('keeps both overlapping bands rather than merging or refusing them', () => {
    const r = parseBandedList('0% 0px, 100% 10px; [0-700]: 100% 1px; [500-900]: 100% 2px', ty);
    expect(r.bands.map((b) => [b.min, b.max])).toEqual([[0, 700], [500, 900]]);
    expect(r.rejected).toEqual([]);
  });

  it('refuses a range whose minimum is above its maximum', () => {
    const r = parseBandedList('0% 0px, 100% 10px; [900-500]: 100% 1px', ty);
    expect(r.bands).toEqual([]);
    expect(r.rejected).toEqual(['[900-500]: 100% 1px']);
  });

  it('accepts a single-width band', () => {
    const r = parseBandedList('0% 0px, 100% 10px; [700-700]: 100% 1px', ty);
    expect(r.bands.map((b) => [b.min, b.max])).toEqual([[700, 700]]);
  });

  it('gives an open band no ceiling', () => {
    const r = parseBandedList('0% 0px, 100% 10px; [700+]: 100% 1px', ty);
    expect(r.bands[0].max).toBe(Infinity);
  });
});
