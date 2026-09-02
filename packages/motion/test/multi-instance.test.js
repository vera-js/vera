import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const settle = () => new Promise((r) => setTimeout(r, 30));
const place = (n, top = 500) => {
  Object.defineProperty(n, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('several instances and scoped roots', () => {
  it('a root-scoped instance ignores everything outside it', () => {
    document.body.innerHTML =
      '<div id="a" data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>' +
      '<div id="scope"><div id="b" data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div></div>';
    place(document.getElementById('a'));
    place(document.getElementById('b'), 600);

    const m = createMotion({ respectReducedMotion: false, inertia: 0, root: document.getElementById('scope') });
    m.init();
    expect(m.elements).toHaveLength(1);
    expect(document.getElementById('a').style.transform).toBe('');
    m.destroy();
  });

  /**
   * Two instances over one element is outside the contract — the runtime owns
   * the inline styles it animates, and its skip-the-write cache holds what it
   * last wrote rather than what the DOM currently has. This pins the actual
   * behaviour so the boundary is a decision rather than a surprise: the
   * survivor's value returns on the next frame where it genuinely changes.
   *
   * Teardown restores an element's *own* inline styles, which raised a
   * question this case answers: a second instance adopting an element the
   * first is already animating would read that animation's current frame as
   * the page's value, and hand it back on teardown — leaving the element
   * frozen at `translateY(110.744px)` rather than clean. A module-scope
   * `WeakSet` of adopted nodes is what stops it: only the first instance to
   * take an element records anything. Outside the contract should still not
   * mean permanently disfigured.
   */
  it('a surviving instance recovers on the next changed value, not before', () => {
    document.body.innerHTML = '<div id="a" data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 400px"></div>';
    const node = document.getElementById('a');
    place(node);

    const one = createMotion({ respectReducedMotion: false, inertia: 0 });
    const two = createMotion({ respectReducedMotion: false, inertia: 0 });
    one.init();
    two.init();
    expect(node.style.transform).not.toBe('');

    one.destroy();
    expect(node.style.transform).toBe('');

    /** Same scroll position: the survivor's cache still matches, so no write. */
    two.refresh();
    expect(node.style.transform).toBe('');

    /** A position it has not written before, and it comes back. */
    Object.defineProperty(window, 'scrollY', { value: 400, configurable: true });
    two.refresh();
    expect(node.style.transform).not.toBe('');

    two.destroy();
    expect(node.style.transform).toBe('');
  });

  it('a second instance does not double-register on the first\'s mutations', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const one = createMotion({ respectReducedMotion: false, inertia: 0 });
    const two = createMotion({ respectReducedMotion: false, inertia: 0 });
    one.init(); two.init();

    document.getElementById('host').innerHTML =
      '<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>';
    place(document.querySelector('[data-vera-motion]'));
    await settle();
    expect(one.elements).toHaveLength(1);
    expect(two.elements).toHaveLength(1);
    one.destroy(); two.destroy();
  });
});
