import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { forgetDirection } from '../src/modules/dom.ts';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

/**
 * Scroll-to in a right-to-left horizontal container — the coordinates that never met.
 *
 * Until 2026-09-01 this module read raw `scrollLeft` (negative in RTL, 0 at the right edge)
 * while `getElementSize` handed it mirrored target geometry, so no link could ever test
 * active and the tween's `Math.max(0, …)` clamp pinned every journey to the start edge.
 * Both halves now share `dom.ts`'s travelled-distance convention; these pin it. Driven at
 * the arithmetic level, exactly as `rtl-horizontal.test.js` drives the runtime's readings —
 * happy-dom reports no `direction`, so it is stubbed.
 */
const pane = (direction, clientWidth, scrollWidth) => {
  const node = document.createElement('div');
  document.body.appendChild(node);
  Object.defineProperty(node, 'clientWidth', { value: clientWidth, configurable: true });
  Object.defineProperty(node, 'clientHeight', { value: 300, configurable: true });
  Object.defineProperty(node, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(node, 'scrollHeight', { value: 300, configurable: true });
  Object.defineProperty(node, 'offsetLeft', { value: 0, configurable: true });
  Object.defineProperty(node, 'offsetTop', { value: 0, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  let scrollLeft = 0;
  Object.defineProperty(node, 'scrollLeft', {
    get: () => scrollLeft,
    set: (v) => { scrollLeft = v; },
    configurable: true,
  });
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction, position: 'static', fontSize: '16px' });
  return node;
};

const section = (parent, id, offsetLeft, width) => {
  const node = document.createElement('div');
  node.id = id;
  parent.appendChild(node);
  Object.defineProperty(node, 'offsetLeft', { value: offsetLeft, configurable: true });
  Object.defineProperty(node, 'offsetWidth', { value: width, configurable: true });
  Object.defineProperty(node, 'offsetTop', { value: 0, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 300, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  return node;
};

beforeEach(() => {
  document.body.innerHTML = '';
  forgetDirection();
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('scroll-to in an RTL horizontal container', () => {
  it('toPosition writes the raw negative scrollLeft the container speaks', () => {
    const container = pane('rtl', 400, 2000);
    const s = createScrollTo({ scrollDirection: 'horizontal', scrollElement: container, duration: 0 });
    s.toPosition(500);
    expect(container.scrollLeft).toBe(-500);
    s.destroy();
  });

  it('toElement reaches a target measured from the edge the content starts at', () => {
    const container = pane('rtl', 400, 2000);
    /**
     * Engines anchor RTL `offsetLeft` to the viewport, so it goes negative for deep content —
     * the browser-measured shape in `rtl-horizontal.test.js` (`offsetLeft: -402`). A target
     * 400px into the reading order here is `offsetLeft: -300`: 400 - (-300) - 300 = 400.
     */
    const target = section(container, 'seq-target', -300, 300);
    const s = createScrollTo({ scrollDirection: 'horizontal', scrollElement: container, duration: 0 });
    s.toElement(target);
    expect(container.scrollLeft).toBe(-400);
    s.destroy();
  });

  it('marks the active link from travelled distance, not raw offset', () => {
    document.body.innerHTML = '<nav><a id="l" href="#sec">go</a></nav>';
    const container = pane('rtl', 400, 2000);
    const target = section(container, 'sec', -300, 300);
    void target;
    const s = createScrollTo({
      scrollDirection: 'horizontal', scrollElement: container,
      activeThreshold: 0.5, duration: 0,
    });
    s.init();
    /** Travelled 350 puts the threshold at 350 + 200 = 550, inside [400, 700). */
    container.scrollLeft = -350;
    s.update();
    expect(document.getElementById('l').classList.contains('active')).toBe(true);
    s.destroy();
  });

  /**
   * The document scrolls in its own direction too — `writePosition`'s window
   * branch speaks raw `scrollX`, which is negative through an RTL page, the
   * same convention the container branch has always spoken.
   */
  it('toPosition writes the raw negative scrollX an RTL document speaks', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'rtl', position: 'static', fontSize: '16px' });
    for (const [key, value] of [['scrollWidth', 2000], ['clientWidth', 400], ['clientHeight', 300]]) {
      Object.defineProperty(document.documentElement, key, { value, configurable: true });
    }
    Object.defineProperty(window, 'scrollX', { value: 0, configurable: true });
    const writes = [];
    vi.spyOn(window, 'scrollTo').mockImplementation((x, y) => writes.push([x, y]));
    const s = createScrollTo({ scrollDirection: 'horizontal', duration: 0 });
    s.toPosition(500);
    expect(writes.at(-1)[0]).toBe(-500);
    s.destroy();
  });

  it('leaves a left-to-right container exactly as it was', () => {
    const container = pane('ltr', 400, 2000);
    const s = createScrollTo({ scrollDirection: 'horizontal', scrollElement: container, duration: 0 });
    s.toPosition(500);
    expect(container.scrollLeft).toBe(500);
    s.destroy();
  });
});
