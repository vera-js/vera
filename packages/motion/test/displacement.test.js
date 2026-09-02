import { describe, it, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { displacementOf } from '../src/modules/dom.ts';
import { createMotion } from '../src/index.ts';

/**
 * happy-dom reports an all-zero rect, so every reading here is stubbed. The
 * behaviour that needs a browser is in `spikes/transformed-ancestor.mjs`; what
 * these pin is the arithmetic and, more importantly, the three cases where the
 * answer is deliberately **zero**.
 */
const withRect = (node, rect) => {
  node.getBoundingClientRect = () => ({ width: 100, height: 100, top: 0, left: 0, ...rect });
  return node;
};

const element = (rect) => withRect(document.createElement('div'), rect);

afterEach(() => vi.restoreAllMocks());

describe('how far something other than this library has moved an element', () => {
  it('is zero when the element is drawn where it is laid out', () => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    expect(displacementOf(element({ top: 900 }), 'vertical', 900)).toBe(0);
  });

  it('is the ancestor transform when one is displacing it', () => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    /** Laid out at 1,500, drawn at 1,800: a wrapper translated 300px down. */
    expect(displacementOf(element({ top: 1800 }), 'vertical', 1500)).toBe(300);
  });

  it('counts the scroll position, since the layout reading is absolute', () => {
    Object.defineProperty(window, 'scrollY', { value: 1000, configurable: true });
    expect(displacementOf(element({ top: 800 }), 'vertical', 1800)).toBe(0);
  });

  /**
   * `offsetTop` is an integer and a rect is not. Unrounded, every ordinary
   * element picked up the difference and its timeline shifted by a fraction —
   * 44 cells of the acceptance baseline moved by thousandths of a pixel, for
   * elements with no transform anywhere near them.
   */
  it('is silent about the sub-pixel difference between a rect and an offset', () => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    expect(displacementOf(element({ top: 900.4 }), 'vertical', 900)).toBe(0);
  });

  /**
   * An element with no box measures all zeros, and so does everything in a
   * host without layout. Subtracting a real layout position from zero would
   * report it as displaced by its whole offset.
   */
  it('is zero for an element with no box at all', () => {
    const node = element({ width: 0, height: 0, top: 0 });
    expect(displacementOf(node, 'vertical', 1500)).toBe(0);
  });

  /** Measured against the container, so a transform on it moves nothing inside. */
  it('is container-relative when there is a container', () => {
    const pane = withRect(document.createElement('div'), { top: 20 });
    Object.defineProperty(pane, 'scrollTop', { value: 100, configurable: true });
    /** Drawn 600 below the pane's own top, scrolled 100: 700 into its content. */
    expect(displacementOf(element({ top: 620 }), 'vertical', 700, pane)).toBe(0);
  });

  /**
   * Declined where `getElementSize` has already mirrored the axis and this
   * reading has not. Applied anyway it undoes the mirroring outright.
   */
  it('declines in a right-to-left container on the horizontal axis', () => {
    const pane = withRect(document.createElement('div'), { left: 0 });
    Object.defineProperty(pane, 'scrollLeft', { value: 0, configurable: true });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'rtl' });
    expect(displacementOf(element({ left: 1800 }), 'horizontal', 1500, pane)).toBe(0);
  });

  it('but still corrects the horizontal axis when the container reads left to right', () => {
    const pane = withRect(document.createElement('div'), { left: 0 });
    Object.defineProperty(pane, 'scrollLeft', { value: 0, configurable: true });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'ltr' });
    expect(displacementOf(element({ left: 1800 }), 'horizontal', 1500, pane)).toBe(300);
  });
});

/**
 * That the reading is *used*. happy-dom reports an all-zero rect, so every
 * element in this suite has a displacement of zero and removing the correction
 * changes nothing it can see — a planted defect only `spikes/transformed-ancestor.mjs`
 * would catch is one `npm run mutate` reports as surviving.
 *
 * Stubbing one element's rect makes the whole path observable here.
 */
describe('the correction reaches the element', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('adds the displacement to the measured position', () => {
    vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    document.body.innerHTML =
      '<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>';
    const node = document.body.firstElementChild;
    Object.defineProperty(node, 'offsetTop', { value: 1500, configurable: true });
    Object.defineProperty(node, 'offsetHeight', { value: 200, configurable: true });
    Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
    /** Laid out at 1,500, drawn at 1,800: an ancestor translated 300px down. */
    node.getBoundingClientRect = () => ({ width: 100, height: 200, top: 1800, left: 0 });

    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(m.elements[0].displaced).toBe(300);
    expect(m.elements[0].start).toBe(1800);
    expect(m.elements[0].end).toBe(2000);
    m.destroy();
  });

  it('and keeps it across a re-measure', () => {
    vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    document.body.innerHTML =
      '<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>';
    const node = document.body.firstElementChild;
    Object.defineProperty(node, 'offsetTop', { value: 1500, configurable: true });
    Object.defineProperty(node, 'offsetHeight', { value: 200, configurable: true });
    Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
    node.getBoundingClientRect = () => ({ width: 100, height: 200, top: 1800, left: 0 });

    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    m.refresh();
    expect(m.elements[0].start).toBe(1800);
    m.destroy();
  });
});
