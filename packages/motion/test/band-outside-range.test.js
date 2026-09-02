import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * A `-name`-suffixed attribute names a range, and its value may carry bands of
 * its own. Those are intersected — narrowest wins — and an intersection can be
 * empty: `opacity-mobile="[800-1200]: …"` with `mobile` registered as 0-640
 * built `{min: 800, max: 640}`, kept it, and matched no viewport that has ever
 * existed. The element animated nothing, at any width, and `rejected` was
 * empty.
 */
const P = 'data-vm';

const place = (n) => {
  Object.defineProperty(n, 'offsetTop', { value: 500, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};
const width = (w) => {
  Object.defineProperty(document.documentElement, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
};

const start = (markup, options = {}) => {
  document.body.innerHTML = markup;
  for (const node of document.body.children) place(node);
  const m = createMotion({ respectReducedMotion: false, inertia: 0, ...options });
  m.init();
  Object.defineProperty(window, 'scrollY', { value: 5000, configurable: true });
  return m;
};
const reasons = (m) => m.rejected.flatMap((entry) => entry.rejected);

beforeEach(() => { document.body.innerHTML = ''; width(1200); });

describe('a band outside the range its attribute names', () => {
  it('is reported rather than kept as an impossible range', () => {
    const m = start(`<div ${P} ${P}-opacity-mobile="[800-1200]: 0% 0, 100% 1" ` +
      `${P}-translate-y="0% 0px, 100% 4px"></div>`);
    expect(reasons(m)).toEqual([
      'opacity: [800-1200] is outside [0-640], the range this attribute names; it can never apply.',
    ]);
    /**
     * Dropped, not merely reported. Reporting and keeping it looks identical
     * from the outside — a band of `{min: 800, max: 640}` matches no viewport,
     * so nothing renders differently — and the difference is visible only
     * here: the property builds no animation at all rather than one whose
     * single band can never apply.
     */
    const built = m.elements[0].parsed.animations.map((a) => a.property.attribute);
    expect(built).toEqual(['translate-y']);
    m.destroy();
  });

  /** Partial overlap is the ordinary case, and narrows rather than refusing. */
  it('still intersects a band that overlaps', () => {
    const m = start(`<div ${P} ${P}-translate-y="0% 0px, 100% 9px; [0-500]: 100% 1px" ` +
      `${P}-translate-y-mobile="[400-900]: 100% 2px"></div>`);
    expect(reasons(m)).toEqual([]);
    const node = document.body.firstElementChild;
    /** 400-900 intersected with mobile's 0-640 is 400-640. */
    width(500); m.refresh();
    expect(node.style.transform).toBe('translateY(2px)');
    width(700); m.refresh();
    expect(node.style.transform).toBe('translateY(9px)');
    m.destroy();
  });

  /** An open-ended named range reads as `640+` in the message, not `640-Infinity`. */
  it('names an open-ended range readably', () => {
    const m = start(
      `<div ${P} ${P}-opacity-wide="[100-200]: 0% 0, 100% 1"></div>`,
      { breakpoints: { wide: [1000, null] } }
    );
    expect(reasons(m)).toEqual([
      'opacity: [100-200] is outside [1000-+], the range this attribute names; it can never apply.',
    ]);
    m.destroy();
  });

  /** Dropping it must not take the rest of the element with it. */
  it('leaves the other properties on the element working', () => {
    const m = start(`<div ${P} ${P}-opacity-mobile="[800-1200]: 0% 0, 100% 1" ` +
      `${P}-translate-y="0% 0px, 100% 40px"></div>`);
    const node = document.body.firstElementChild;
    expect(reasons(m)).toHaveLength(1);
    expect(node.style.transform).toBe('translateY(40px)');
    m.destroy();
  });

  /** And a band that touches at exactly one width is not empty. */
  it('keeps a single-width intersection', () => {
    const m = start(`<div ${P} ${P}-translate-y="0% 0px, 100% 9px" ` +
      `${P}-translate-y-mobile="[640-900]: 100% 3px"></div>`);
    expect(reasons(m)).toEqual([]);
    const node = document.body.firstElementChild;
    width(640); m.refresh();
    expect(node.style.transform).toBe('translateY(3px)');
    m.destroy();
  });
});
