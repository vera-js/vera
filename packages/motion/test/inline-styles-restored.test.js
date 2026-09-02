import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const place = (node) => {
  Object.defineProperty(node, 'offsetTop', { value: 3000, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

const build = (markup) => {
  document.body.innerHTML = markup;
  for (const node of document.querySelectorAll('[data-vera-motion]')) place(node);
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return m;
};

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => vi.unstubAllGlobals());

/**
 * The runtime owns an animated element's `transform`, `filter` and radii while
 * it animates — the README says so, and that part is deliberate. What it did
 * not do is give them back. `destroy()` promises to release every style it
 * *injected*, and it was removing the author's along with them.
 *
 * A page builder that emits `transform: translateX(-50%)` to centre something —
 * which is most of them — lost the centring for good the first time an instance
 * tore down.
 */
describe('inline styles the page wrote first', () => {
  it('gives back a transform it took over', () => {
    const m = build(
      '<div style="transform: translateX(-50%)" data-vera-motion ' +
      'data-vera-motion-translate-y="0% 0px, 100% 40px"></div>'
    );
    const node = document.body.firstElementChild;
    /** Taken over while animating, which is the documented half. */
    expect(node.style.transform).toBe('translateY(0px)');
    m.destroy();
    expect(node.style.transform).toBe('translateX(-50%)');
  });

  it('gives back a filter', () => {
    const m = build(
      '<div style="filter: grayscale(1)" data-vera-motion ' +
      'data-vera-motion-opacity="0% 0.2, 100% 1"></div>'
    );
    const node = document.body.firstElementChild;
    m.destroy();
    expect(node.style.filter).toBe('grayscale(1)');
  });

  it('gives back a plain property a module or the schema names', () => {
    const m = build(
      '<div style="border-top-left-radius: 12px" data-vera-motion ' +
      'data-vera-motion-radius-top-left="0% 0px, 100% 20px"></div>'
    );
    const node = document.body.firstElementChild;
    m.destroy();
    expect(node.style.borderTopLeftRadius).toBe('12px');
  });

  /**
   * The other direction, and the reason this is not "put the style attribute
   * back": everything the instance never touched has to be left exactly as it
   * is, including changes made while it was running.
   */
  it('leaves alone what it never wrote', () => {
    const m = build(
      '<div style="background: red" data-vera-motion ' +
      'data-vera-motion-translate-y="0% 0px, 100% 40px"></div>'
    );
    const node = document.body.firstElementChild;
    node.style.setProperty('color', 'blue');
    m.destroy();
    expect(node.style.background).toBe('red');
    expect(node.style.color).toBe('blue');
  });

  /** And an element with nothing inline does not acquire an empty attribute. */
  it('adds nothing to an element that had nothing', () => {
    const m = build(
      '<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>'
    );
    const node = document.body.firstElementChild;
    m.destroy();
    expect(node.getAttribute('style')).toBeNull();
  });

  /**
   * `disable()` clears the animated styles too, and "natural state" means what
   * the page said, not nothing.
   */
  it('gives them back on disable, which is what natural state means', () => {
    const m = build(
      '<div style="transform: translateX(-50%)" data-vera-motion ' +
      'data-vera-motion-translate-y="0% 0px, 100% 40px"></div>'
    );
    const node = document.body.firstElementChild;
    m.disable();
    expect(node.style.transform).toBe('translateX(-50%)');
    m.destroy();
  });

  /**
   * Only what was actually there is recorded. Setting a property back to `''`
   * is a no-op, so a record of every managed name would behave identically and
   * be invisible — it would just carry a dozen empty strings per element on a
   * page that may have thousands. Asserted on the record itself, since nothing
   * downstream can tell the difference.
   */
  it('records only the properties that had a value', () => {
    const m = build(
      '<div style="transform: translateX(-50%)" data-vera-motion ' +
      'data-vera-motion-translate-y="0% 0px, 100% 40px"></div>'
    );
    expect([...m.elements[0].restore]).toEqual(['transform', 'translateX(-50%)']);
    m.destroy();
  });

  it('records nothing at all for an element with no inline style', () => {
    const m = build(
      '<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>'
    );
    expect([...m.elements[0].restore]).toEqual([]);
    m.destroy();
  });

  /**
   * A second instance over the same element reads the first one's current
   * frame, not the page's value. Recording it would hand that frame back on
   * teardown and leave the element frozen at whatever it was showing —
   * `translateY(110.744px)`, when this was written. Only the first instance to
   * adopt a node records anything.
   */
  it('records nothing for an element another instance is already animating', () => {
    document.body.innerHTML =
      '<div style="transform: translateX(-50%)" data-vera-motion ' +
      'data-vera-motion-translate-y="0% 0px, 100% 400px"></div>';
    const node = document.body.firstElementChild;
    place(node);
    const first = createMotion({ respectReducedMotion: false, inertia: 0 });
    const second = createMotion({ respectReducedMotion: false, inertia: 0 });
    first.init();
    second.init();

    expect([...second.elements[0].restore]).toEqual([]);
    expect([...first.elements[0].restore]).toEqual(['transform', 'translateX(-50%)']);

    /** And the element still ends up as the page had it, whatever the order. */
    second.destroy();
    first.destroy();
    expect(node.style.transform).toBe('translateX(-50%)');
  });

  /** A value from a stylesheet needs no restoring — removing the inline one uncovers it. */
  it('records the inline value only', () => {
    document.head.insertAdjacentHTML('beforeend',
      '<style id="sheet">.sheeted { transform: rotate(9deg) }</style>');
    const m = build(
      '<div class="sheeted" data-vera-motion ' +
      'data-vera-motion-translate-y="0% 0px, 100% 40px"></div>'
    );
    const node = document.body.firstElementChild;
    m.destroy();
    expect(node.style.transform).toBe('');
    document.getElementById('sheet')?.remove();
  });
});
