import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const place = (n, top = 500) => {
  Object.defineProperty(n, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 120, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

describe('overlapping roots', () => {
  it('does not register the same element twice', () => {
    document.body.innerHTML =
      '<div id="host"><div id="a" data-vm data-vm-translate-y="0% 0px, 100% 40px"></div></div>';
    place(document.getElementById('a'));
    const host = document.getElementById('host');

    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();                       // default root is `document`, which contains #host
    const afterInit = m.elements.length;
    m.observe(host);                // a root nested inside the one already covered
    const afterObserve = m.elements.length;
    const unique = new Set(m.elements.map((e) => e.node)).size;
    expect(afterObserve).toBe(afterInit);
    /** Computed and never asserted before the 2026-09-01 lint pass; the set size is the point. */
    expect(unique).toBe(afterObserve);
    m.destroy();
  });

  it('does not double-register across destroy + init', () => {
    document.body.innerHTML =
      '<div id="host"><div id="a" data-vm data-vm-translate-y="0% 0px, 100% 40px"></div></div>';
    place(document.getElementById('a'));
    const host = document.getElementById('host');

    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    m.observe(host);
    m.destroy();
    m.init();
    const unique = new Set(m.elements.map((e) => e.node)).size;
    expect(m.elements.length).toBe(unique);
    m.destroy();
  });
});
