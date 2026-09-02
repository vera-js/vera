import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const P = 'data-vm';
const place = (n) => {
  for (const [k, v] of [['offsetLeft', 500], ['offsetTop', 500], ['offsetWidth', 200], ['offsetHeight', 200]]) {
    Object.defineProperty(n, k, { value: v, configurable: true });
  }
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => { document.body.innerHTML = ''; });

/**
 * `pin` is `position: sticky` plus an offset, and sticky needs the offset on
 * the edge the content moves past. It was always `top`, so a horizontal
 * instance held its vertical position — which nothing was moving — while the
 * content it was meant to hold against slid past it sideways.
 */
describe('pin holds against the edge the instance scrolls along', () => {
  const pin = (direction) => {
    document.body.innerHTML =
      `<div ${P} ${P}-pin="120px" ${P}-opacity="0% 0, 100% 1"></div>`;
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, scrollDirection: direction });
    m.init();
    const style = { position: node.style.position, top: node.style.top, start: node.style.getPropertyValue('inset-inline-start') };
    return { node, m, style };
  };

  /**
   * The logical property, so the engine itself picks the leading edge — in an
   * RTL scroller that is the right one, where a physical `left` held against
   * the only edge nothing scrolls past.
   */
  it('uses inset-inline-start when scrolling horizontally', () => {
    const { m, style } = pin('horizontal');
    expect(style.position).toBe('sticky');
    expect(style.start).toBe('120px');
    expect(style.top).toBe('');
    m.destroy();
  });

  it('uses top when scrolling vertically', () => {
    const { m, style } = pin('vertical');
    expect(style.position).toBe('sticky');
    expect(style.top).toBe('120px');
    expect(style.start).toBe('');
    m.destroy();
  });

  it('takes the offset back off the axis it was written on', () => {
    const { node, m } = pin('horizontal');
    expect(node.style.getPropertyValue('inset-inline-start')).toBe('120px');
    m.destroy();
    expect(node.style.getPropertyValue('inset-inline-start')).toBe('');
    expect(node.style.position).toBe('');
  });
});
