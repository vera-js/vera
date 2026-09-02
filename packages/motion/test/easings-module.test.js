import { describe, it, beforeEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { easings } from '../src/easings.ts';

const place = (n) => {
  Object.defineProperty(n, 'offsetTop', { value: 500, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};
const run = (attrs) => {
  document.body.innerHTML =
    `<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 100px" ${attrs}></div>`;
  const node = document.body.firstElementChild;
  place(node);
  Object.defineProperty(window, 'scrollY', { value: 400, configurable: true });
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return { node, m };
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('the easings module', () => {
  /**
   * `linear` is the default and needs nothing, which is the whole reason the
   * solver is a separate import.
   */
  it('is not needed for a linear curve', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { node, m } = run('');
    expect(node.style.transform).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
    m.destroy();
    warn.mockRestore();
  });

  it('shapes the curve once wired', () => {
    wireMotion(easings);
    const eased = run('data-vera-motion-ease="ease-in"');
    const shaped = eased.node.style.transform;
    eased.m.destroy();

    const straight = run('');
    expect(shaped).not.toBe(straight.node.style.transform);
    straight.m.destroy();
  });
});
