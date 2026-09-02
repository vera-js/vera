import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import * as dom from '../src/modules/dom.ts';

/**
 * calcOffsetStart only walks .offsetTop/.offsetLeft/.offsetParent, so plain
 * objects exercise it exactly as real nodes would — and without the layout
 * engine, which happy-dom does not fully implement.
 */
const chain = (...offsets) =>
  offsets.reduceRight((parent, o) => ({ offsetTop: o.top, offsetLeft: o.left, offsetParent: parent }), null);

describe('calcOffsetStart', () => {
  it('sums offsetTop up the offsetParent chain (vertical)', () => {
    const node = chain({ top: 100, left: 5 }, { top: 250, left: 10 }, { top: 50, left: 20 });
    expect(dom.calcOffsetStart(node, 'vertical')).toBe(400);
  });

  it('sums offsetLeft when horizontal', () => {
    const node = chain({ top: 100, left: 5 }, { top: 250, left: 10 }, { top: 50, left: 20 });
    expect(dom.calcOffsetStart(node, 'horizontal')).toBe(35);
  });

  it('is 0 for a node with no offsets', () => {
    expect(dom.calcOffsetStart({ offsetTop: 0, offsetLeft: 0, offsetParent: null }, 'vertical')).toBe(0);
  });

  it('handles a single unparented node', () => {
    expect(dom.calcOffsetStart({ offsetTop: 42, offsetLeft: 7, offsetParent: null }, 'vertical')).toBe(42);
  });
});

describe('getElementSize', () => {
  /**
   * offsetWidth/offsetHeight rather than a rect, so the reading is immune to
   * the transform the animation itself applies — and so re-measuring is a pure
   * read with no style writes to thrash layout.
   */
  const stub = (over) => ({
    offsetTop: 0, offsetLeft: 0, offsetParent: null, offsetWidth: 0, offsetHeight: 0, ...over,
  });

  it('returns start, size and end for vertical', () => {
    expect(dom.getElementSize(stub({ offsetTop: 500, offsetHeight: 200 }), 'vertical'))
      .toEqual({ start: 500, size: 200, end: 700 });
  });

  it('uses width when horizontal', () => {
    expect(dom.getElementSize(stub({ offsetLeft: 300, offsetWidth: 400 }), 'horizontal'))
      .toEqual({ start: 300, size: 400, end: 700 });
  });

  it('ignores any transform on the element', () => {
    /**
     * getBoundingClientRect would report the scaled box here; offsetHeight
     * reports the layout box, which is what the timeline must be built from.
     */
    const scaled = stub({
      offsetTop: 500, offsetHeight: 200,
      getBoundingClientRect: () => ({ top: 500, height: 400, width: 800 }),
    });
    expect(dom.getElementSize(scaled, 'vertical').size).toBe(200);
  });
});

describe('readScrollPosition', () => {
  it('reads the window on both axes', () => {
    Object.defineProperty(window, 'scrollY', { value: 120, configurable: true });
    Object.defineProperty(window, 'scrollX', { value: 45, configurable: true });
    expect(dom.readScrollPosition(window, 'vertical')).toBe(120);
    expect(dom.readScrollPosition(window, 'horizontal')).toBe(45);
  });

  /**
   * The bug this replaced: the vertical branch read window.scrollY
   * unconditionally, so a custom scroll container animated against the
   * window's position instead of its own.
   */
  it('reads a scrolling container, not the window', () => {
    Object.defineProperty(window, 'scrollY', { value: 999, configurable: true });
    const node = { scrollTop: 300, scrollLeft: 80 };
    expect(dom.readScrollPosition(node, 'vertical')).toBe(300);
    expect(dom.readScrollPosition(node, 'horizontal')).toBe(80);
  });

  it('getWindowSize uses it, so a container drives the timeline', () => {
    Object.defineProperty(window, 'scrollY', { value: 999, configurable: true });
    const win = dom.getWindowSize('vertical', { scrollTop: 250, scrollLeft: 0 });
    expect(win.start).toBe(250);
    expect(win.end).toBe(250 + win.size);
  });
});

describe('getWindowSize', () => {
  it('reports the viewport and derives end from start + size', () => {
    const win = dom.getWindowSize('vertical', window);
    expect(win.size).toBe(win.height);
    expect(win.end).toBe(win.start + win.size);
    expect(Number.isFinite(win.width)).toBe(true);
  });
});

describe('geometry relative to a custom scroll container', () => {
  /**
   * `scrollElement` is a documented option and was measured broken in
   * Chromium: a subject 900px into a 400px-tall pane inside an 800px viewport
   * reported `start` 1200 (document coordinates) against a scroll position
   * read from the pane, and a scroll window sized from the viewport. Its whole
   * timeline was shifted and stretched. `scrollTo.ts` had subtracted the
   * container offset since it was written; the runtime never had it.
   */
  const pane = { offsetTop: 300, offsetLeft: 40, offsetParent: null, clientHeight: 400, clientWidth: 500 };
  const subject = { offsetTop: 900, offsetLeft: 60, offsetParent: pane, offsetHeight: 200, offsetWidth: 120 };

  it('measures the element from the container, not the document', () => {
    expect(dom.getElementSize(subject, 'vertical', pane).start).toBe(900);
    expect(dom.getElementSize(subject, 'horizontal', pane).start).toBe(60);
  });

  it('still measures from the document when the scroller is the window', () => {
    expect(dom.getElementSize(subject, 'vertical', window).start).toBe(1200);
    expect(dom.getElementSize(subject, 'vertical').start).toBe(1200);
  });

  it("sizes the scroll window from the container's scrollport", () => {
    const scroller = { ...pane, scrollTop: 500, scrollLeft: 0 };
    const win = dom.getWindowSize('vertical', scroller);
    expect(win.size).toBe(400);
    expect(win.start).toBe(500);
    expect(win.end).toBe(900);
  });

  it('keeps width and height as the viewport, since vh and vw mean that', () => {
    const scroller = { ...pane, scrollTop: 0, scrollLeft: 0 };
    const win = dom.getWindowSize('vertical', scroller);
    expect(win.height).toBe(window.innerHeight);
    expect(win.width).toBe(window.innerWidth);
    expect(win.size).not.toBe(win.height);
  });
});

