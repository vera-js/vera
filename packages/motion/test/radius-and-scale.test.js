import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const place = (n) => {
  Object.defineProperty(n, 'offsetTop', { value: 500, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};
const run = (html) => {
  document.body.innerHTML = html;
  const node = document.body.firstElementChild;
  place(node);
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return { node, m };
};

describe('radius shorthand and the scale axes', () => {
  it('radius writes all four corners at once', () => {
    const { node, m } = run('<div data-vm data-vm-radius="0% 40px, 100% 4px"></div>');
    expect(node.style.borderRadius).not.toBe('');
    m.destroy();
  });

  /**
   * Apply order follows the PROPERTIES table, and `radius` is declared before
   * the corners so a specific corner wins — the way round CSS itself works.
   */
  it('a specific corner overrides the shorthand', () => {
    const { node, m } = run(
      '<div data-vm data-vm-radius="0% 40px, 100% 4px"' +
      ' data-vm-radius-top-left="0% 90px, 100% 90px"></div>');
    expect(node.style.borderTopLeftRadius).toBe('90px');
    /** The other three still come from the shorthand. */
    expect(node.style.borderRadius).not.toBe('');
    m.destroy();
  });

  it('scale-x and scale-y animate independently', () => {
    const { node, m } = run(
      '<div data-vm data-vm-scale-x="0% 1, 100% 2" data-vm-scale-y="0% 1, 100% 0.5"></div>');
    expect(node.style.transform).toMatch(/scaleX\([\d.]+\)/);
    expect(node.style.transform).toMatch(/scaleY\([\d.]+\)/);
    m.destroy();
  });

  it('scale-x composes with plain scale in declaration order', () => {
    const { node, m } = run(
      '<div data-vm data-vm-scale="0% 1, 100% 2" data-vm-scale-x="0% 1, 100% 3"></div>');
    const t = node.style.transform;
    expect(t.indexOf('scale(')).toBeLessThan(t.indexOf('scaleX('));
    m.destroy();
  });
});
