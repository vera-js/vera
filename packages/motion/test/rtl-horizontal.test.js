import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { readScrollPosition, getElementSize, forgetDirection } from '../src/modules/dom.ts';

/**
 * `scrollLeft` in a right-to-left scroller is 0 at the **right** edge — where
 * the content begins — and goes negative as the reader moves through it.
 * `offsetLeft` stays physical, measured from the left, and already carries the
 * RTL scroll origin. Nothing reconciled the two, so every horizontal timeline
 * ran backwards: measured in all three engines, an element sat at position
 * 1.169 before anyone scrolled and walked down to -0.831.
 *
 * `spikes/rtl.mjs` measures the behaviour in a browser. happy-dom reports no
 * `direction`, so these drive the two readings directly — which is the level
 * the arithmetic actually lives at.
 */
const container = (direction, clientWidth) => {
  const node = document.createElement('div');
  document.body.appendChild(node);
  Object.defineProperty(node, 'clientWidth', { value: clientWidth, configurable: true });
  Object.defineProperty(node, 'offsetLeft', { value: 0, configurable: true });
  Object.defineProperty(node, 'offsetTop', { value: 0, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction });
  return node;
};

const child = (parent, offsetLeft, width) => {
  const node = document.createElement('div');
  parent.appendChild(node);
  Object.defineProperty(node, 'offsetLeft', { value: offsetLeft, configurable: true });
  Object.defineProperty(node, 'offsetWidth', { value: width, configurable: true });
  Object.defineProperty(node, 'offsetTop', { value: 0, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  return node;
};

/** `document.documentElement` is one shared object in the direction cache; each test re-decides. */
beforeEach(() => { document.body.innerHTML = ''; forgetDirection(); });
afterEach(() => vi.restoreAllMocks());

describe('a horizontal timeline in a right-to-left container', () => {
  it('reads the scroll position as a distance travelled, not a negative offset', () => {
    const pane = container('rtl', 1000);
    Object.defineProperty(pane, 'scrollLeft', { value: -400, configurable: true });
    expect(readScrollPosition(pane, 'horizontal')).toBe(400);
  });

  it('leaves a left-to-right container exactly as it was', () => {
    const pane = container('ltr', 1000);
    Object.defineProperty(pane, 'scrollLeft', { value: 400, configurable: true });
    expect(readScrollPosition(pane, 'horizontal')).toBe(400);
  });

  /**
   * The measured case, from `spikes/rtl.html`: a 200px element whose
   * `offsetLeft` is -402 inside a 998px pane sits 1,200px into the content.
   * That is `clientWidth - offsetLeft - size`.
   */
  it('measures an element from the edge the content starts at', () => {
    const pane = container('rtl', 998);
    const node = child(pane, -402, 200);
    expect(getElementSize(node, 'horizontal', pane).start).toBe(1200);
  });

  it('and leaves the left-to-right measurement alone', () => {
    const pane = container('ltr', 998);
    const node = child(pane, 1200, 200);
    expect(getElementSize(node, 'horizontal', pane).start).toBe(1200);
  });

  /**
   * The axis, not the document. A vertical timeline on an RTL page was never
   * affected, and the fix must not start affecting it.
   */
  it('does not touch a vertical timeline on the same page', () => {
    const pane = container('rtl', 1000);
    Object.defineProperty(pane, 'scrollTop', { value: 400, configurable: true });
    expect(readScrollPosition(pane, 'vertical')).toBe(400);

    const node = child(pane, 0, 200);
    Object.defineProperty(node, 'offsetTop', { value: 3000, configurable: true });
    Object.defineProperty(node, 'offsetHeight', { value: 200, configurable: true });
    expect(getElementSize(node, 'vertical', pane).start).toBe(3000);
  });

  /**
   * The window scrolls in the *document's* direction — an earlier version of
   * this test asserted the window was untouched, on the claim that it "has no
   * direction of its own to read". It does: `documentElement`'s. An RTL page
   * reports `scrollX` 0 at the right edge and negative through the content,
   * the same convention as a container, and skipping it ran every
   * document-level horizontal timeline backwards.
   */
  it('reads window scrolling in the document direction', () => {
    container('rtl', 1000);
    Object.defineProperty(window, 'scrollX', { value: -400, configurable: true });
    expect(readScrollPosition(window, 'horizontal')).toBe(400);
  });

  it('leaves a left-to-right document exactly as it was', () => {
    container('ltr', 1000);
    Object.defineProperty(window, 'scrollX', { value: 400, configurable: true });
    expect(readScrollPosition(window, 'horizontal')).toBe(400);
  });

  /** The measured container case, at the document level: same arithmetic, viewport width. */
  it('measures an element from the edge the document starts at', () => {
    container('rtl', 0);
    Object.defineProperty(document.documentElement, 'clientWidth', { value: 998, configurable: true });
    const node = child(document.body, -402, 200);
    expect(getElementSize(node, 'horizontal').start).toBe(998 - -402 - 200);
  });
});
