import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { calcOffsetStart, displacementOf, forgetSticky, standingDownAll } from '../src/modules/dom.ts';

/**
 * `offsetTop` follows sticky positioning, which is the one way the
 * offsetParent walk is not a layout measurement.
 *
 * A stuck ancestor reports the pinned offset rather than the slot the element
 * occupies in the flow, and that number is a function of the scroll position.
 * Measured in all three engines (`spikes/sticky-ancestor.mjs`): an element
 * 850px down inside a sticky wrapper measured **2,200** if the page happened
 * to be scrolled there when the measurement was taken — which is what a reload
 * part-way down a sticky section does, and what any re-measure while it is
 * stuck does to a running page.
 *
 * happy-dom has no layout and no sticky behaviour, so what is testable here is
 * the *decision*: that the ancestors are stood down for the reading and put
 * back exactly as they were. The number they produce is the spike's job.
 */
const build = (position, inline = '') => {
  document.body.innerHTML =
    `<div id="wrap"${inline ? ` style="${inline}"` : ''}><div id="box"></div></div>`;
  const wrap = document.getElementById('wrap');
  const box = document.getElementById('box');
  wrap.style.position = position;
  /** The wrapper is the offsetParent, and reports the *stuck* offset. */
  Object.defineProperty(box, 'offsetTop', { value: 50, configurable: true });
  Object.defineProperty(box, 'offsetParent', { get: () => wrap, configurable: true });
  Object.defineProperty(wrap, 'offsetParent', { value: null, configurable: true });
  let stuck = 1350;
  Object.defineProperty(wrap, 'offsetTop', {
    get: () => (wrap.style.position === 'sticky' ? 800 + stuck : 800),
    configurable: true,
  });
  return { wrap, box };
};

beforeEach(() => forgetSticky());
afterEach(() => vi.restoreAllMocks());

describe('measuring under a sticky ancestor', () => {
  it('stands it down, so the reading is the slot rather than the stick', () => {
    const { box } = build('sticky');
    expect(calcOffsetStart(box, 'vertical')).toBe(850);
  });

  it('leaves an ordinary ancestor alone', () => {
    const { box } = build('relative');
    expect(calcOffsetStart(box, 'vertical')).toBe(850);
  });

  it('puts the inline position back exactly as it was', () => {
    const { wrap, box } = build('sticky');
    calcOffsetStart(box, 'vertical');
    expect(wrap.style.position).toBe('sticky');
  });

  /**
   * The one the library writes itself: `pin` sets `position: sticky` inline,
   * and a measurement that restored `''` would silently unpin the element.
   */
  it('including one the library wrote for a pin', () => {
    document.body.innerHTML = '<div id="p" style="position: sticky; top: 20px"></div>';
    const node = document.getElementById('p');
    Object.defineProperty(node, 'offsetTop', { value: 500, configurable: true });
    Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
    calcOffsetStart(node, 'vertical');
    expect(node.style.position).toBe('sticky');
    expect(node.style.top).toBe('20px');
  });

  /**
   * A wrapper can be sticky at one width and not at another, so what was
   * learned is dropped before each fresh measure. Without the stamp the cache
   * would answer for the previous breakpoint for the life of the page.
   */
  it('forgets what it learned when the page is re-measured', () => {
    const { wrap, box } = build('relative');
    expect(calcOffsetStart(box, 'vertical')).toBe(850);

    /** A breakpoint the wrapper is sticky at. Nothing has told the cache yet. */
    wrap.style.position = 'sticky';
    expect(calcOffsetStart(box, 'vertical')).toBe(2200);

    forgetSticky();
    expect(calcOffsetStart(box, 'vertical')).toBe(850);
  });

  /**
   * The other half: the displacement correction reads its side the same way.
   *
   * A rect follows sticky positioning too, so both readings are taken with the
   * ancestors stood down. Declining outright was the first fix and cost the
   * correction the thing it exists for — the inertia lab's tracks sit inside a
   * sticky stage *and* carry a per-row transform.
   *
   * The rect is faked, and faked to respond to the stand-down the way a real
   * one does. happy-dom has no layout, so `displacementOf` returns 0 from its
   * no-box guard before reaching anything worth testing.
   */
  const fakeRect = (node, wrap, { stuck, slot }) => {
    Object.defineProperty(node, 'getBoundingClientRect', {
      value: () => ({
        top: wrap.style.position === 'sticky' ? stuck : slot,
        left: 0, width: 300, height: 200,
      }),
      configurable: true,
    });
  };

  it('reads no displacement from the stick itself', () => {
    const { wrap, box } = build('sticky');
    fakeRect(box, wrap, { stuck: 2200, slot: 850 });
    expect(displacementOf(box, 'vertical', 850)).toBe(0);
  });

  /**
   * And still corrects for a transform under that same sticky ancestor, which
   * is the combination the lab is made of and the one declining broke.
   */
  it('still corrects a transform under a sticky ancestor', () => {
    const { wrap, box } = build('sticky');
    fakeRect(box, wrap, { stuck: 2500, slot: 1150 });
    expect(displacementOf(box, 'vertical', 850)).toBe(300);
  });

  /** And under an ancestor that is not sticky at all. */
  it('still corrects under an ordinary ancestor', () => {
    const { wrap, box } = build('relative');
    fakeRect(box, wrap, { stuck: 1150, slot: 1150 });
    expect(displacementOf(box, 'vertical', 850)).toBe(300);
  });

  /**
   * And restored even when the reading throws.
   *
   * This stands the page's own layout down for the length of a measurement.
   * Anything thrown in between — a hostile host, a rect on something that is
   * not an element — would otherwise leave every sticky wrapper on the page
   * set to `static` for good: a page that would merely have failed to animate
   * instead has its layout permanently altered, by the library, on the way
   * out.
   */
  it('puts them back even when the reading throws', () => {
    const { wrap, box } = build('sticky');
    /**
     * `offsetTop`, not `offsetParent`: the detection walk reads the parent
     * chain *before* anything is stood down, so a throw there would leave
     * nothing to restore and the test would pass against any implementation.
     * The summing walk is what runs while the page is static.
     */
    Object.defineProperty(box, 'offsetTop', {
      get() { throw new Error('hostile host'); },
      configurable: true,
    });
    expect(() => calcOffsetStart(box, 'vertical')).toThrow('hostile host');
    expect(wrap.style.position).toBe('sticky');
  });

  /** Whatever the page hands it: a walk of plain objects has no computed style. */
  it('survives a chain that is not made of elements', () => {
    const fake = { offsetTop: 40, offsetLeft: 0, offsetParent: { offsetTop: 60, offsetLeft: 0, offsetParent: null } };
    expect(calcOffsetStart(fake, 'vertical')).toBe(100);
  });
});

/**
 * And the batch form, which is how the runtime actually measures.
 *
 * Standing the ancestors down per element wrote style and forced a layout
 * every time round: 5,000 elements inside a sticky stage took **57 seconds**
 * to `init()`, against 64ms for the same page without one, and the shape was
 * quadratic (2.3 s at 1,000, 9.3 s at 2,000). `spikes/sticky-cost.mjs` holds
 * the numbers. `standingDownAll` takes the union first, stands it down once,
 * and every reading inside the pass then finds the page already static and
 * writes nothing.
 *
 * happy-dom has no layout, so what is testable here is again the decision, not
 * the timing: that the batch really does stand the page down, that a reading
 * inside it gets the slot, and that everything is put back.
 */
describe('measuring a whole batch under a sticky ancestor', () => {
  it('stands the page down once, and every reading inside gets the slot', () => {
    const { box } = build('sticky');
    const inside = standingDownAll([box], () => calcOffsetStart(box, 'vertical'));
    expect(inside).toBe(850);
  });

  it('and puts it back afterwards', () => {
    const { wrap, box } = build('sticky');
    standingDownAll([box], () => calcOffsetStart(box, 'vertical'));
    expect(wrap.style.position).toBe('sticky');
  });

  /**
   * The element's own position counts, which is what `pin` writes. Walking
   * from the parent instead leaves a pinned element stuck for its own
   * measurement — the reading `calcOffsetStart` would have neutralised on its
   * own, lost precisely because the batch said it had been handled.
   */
  it('including the element own sticky position', () => {
    /**
     * Inside a sticky wrapper as well as being sticky itself, which is what
     * `pin` on an element in a pinned section is. The wrapper matters: with
     * only the element sticky, a union built from its *parent* comes back
     * empty, the batch stands nothing down and does not claim to, and the
     * per-element path neutralises it after all. The bug hides behind its own
     * fallback unless something else puts the pass in force.
     */
    document.body.innerHTML =
      '<div id="wrap" style="position: sticky"><div id="p" style="position: sticky; top: 0"></div></div>';
    const wrap = document.getElementById('wrap');
    const node = document.getElementById('p');
    Object.defineProperty(wrap, 'offsetParent', { value: null, configurable: true });
    Object.defineProperty(wrap, 'offsetTop', { value: 100, configurable: true });
    Object.defineProperty(node, 'offsetParent', { get: () => wrap, configurable: true });
    Object.defineProperty(node, 'offsetTop', {
      get: () => (node.style.position === 'sticky' ? 1850 : 500),
      configurable: true,
    });

    const inside = standingDownAll([node], () => calcOffsetStart(node, 'vertical'));

    expect(inside).toBe(600);
    expect(node.style.position).toBe('sticky');
    expect(wrap.style.position).toBe('sticky');
  });

  /** A page with nothing sticky in it is not written to at all. */
  it('and writes nothing when there is nothing sticky', () => {
    const { wrap, box } = build('relative');
    expect(standingDownAll([box], () => calcOffsetStart(box, 'vertical'))).toBe(850);
    expect(wrap.style.position).toBe('relative');
  });
});
