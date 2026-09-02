import { describe, it, beforeEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const P = 'data-vera-motion';

/** happy-dom has no layout, so the observer is stubbed to capture its options. */
let instances = [];
class FakeIO {
  constructor(_fn, opts) { this.opts = opts; instances.push(this); }
  observe() {}
  unobserve() {}
  disconnect() {}
}

const place = (n) => {
  Object.defineProperty(n, 'offsetLeft', { value: 500, configurable: true });
  Object.defineProperty(n, 'offsetTop', { value: 500, configurable: true });
  Object.defineProperty(n, 'offsetWidth', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => {
  instances = [];
  document.body.innerHTML = '';
  vi.stubGlobal('IntersectionObserver', FakeIO);
});

/**
 * The margin is what keeps an element updating while its animation runs
 * off-screen. It was always written into the vertical pair of the
 * `top right bottom left` shorthand, so a horizontally scrolled instance had
 * none on the axis it moves along.
 */
describe('a horizontally scrolled instance tracks along its own axis', () => {
  const marginFor = (direction) => {
    document.body.innerHTML =
      `<div ${P} ${P}-translate-x="-50% 0px, 150% 40px"></div>`;
    place(document.body.firstElementChild);
    const m = createMotion({ respectReducedMotion: false, scrollDirection: direction });
    m.init();
    const margin = instances.at(-1).opts.rootMargin;
    m.destroy();
    return margin;
  };

  it('pads left and right when scrolling horizontally', () => {
    const margin = marginFor('horizontal');
    const [top, right, bottom, left] = margin.split(' ');
    expect(top).toBe('0px');
    expect(bottom).toBe('0px');
    expect(right).not.toBe('0px');
    expect(left).not.toBe('0px');
  });

  it('pads top and bottom when scrolling vertically', () => {
    const margin = marginFor('vertical');
    const [top, right, bottom, left] = margin.split(' ');
    expect(right).toBe('0px');
    expect(left).toBe('0px');
    expect(top).not.toBe('0px');
    expect(bottom).not.toBe('0px');
  });
});
