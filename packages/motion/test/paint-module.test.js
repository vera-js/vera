import { describe, it, beforeEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { paint } from '../src/paint.ts';

const place = (n) => {
  Object.defineProperty(n, 'offsetTop', { value: 3000, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

const run = (html) => {
  document.body.innerHTML = html;
  const node = document.body.firstElementChild;
  place(node);
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  const m = createMotion({ respectReducedMotion: false });
  m.init();
  return { node, m };
};

beforeEach(() => { wireMotion(paint); document.body.innerHTML = ''; });

describe('the paint module', () => {
  it('steps background from one authored value to the next', () => {
    const { node, m } = run(
      '<div data-vera-motion data-vera-motion-inertia="0.4"' +
      ' data-vera-motion-background="0% linear-gradient(red, blue), 100% #0a0"></div>');
    expect(node.style.background).toContain('gradient');

    Object.defineProperty(window, 'scrollY', { value: 9000, configurable: true });
    m.refresh();
    expect(node.style.background).toContain('#0a0');

    /** CSS does the animating — that is the whole design. */
    expect(node.style.transition).toContain('background');
    m.destroy();
    vi.unstubAllGlobals();
  });

  it('covers colour, border-colour and both shadows', () => {
    const { node, m } = run(
      '<div data-vera-motion' +
      ' data-vera-motion-color="0% #111, 100% #eee"' +
      ' data-vera-motion-border-color="0% red, 100% blue"' +
      ' data-vera-motion-shadow="0% 0 0 0 rgb(0 0 0 / 0), 100% 0 2px 8px rgb(0 0 0 / 0.3)"' +
      ' data-vera-motion-text-shadow="0% none, 100% 1px 1px 2px black"></div>');
    expect(m.rejected.flatMap((r) => r.rejected)).toEqual([]);
    expect(node.style.color).toBeTruthy();
    expect(node.style.borderColor).toBeTruthy();
    m.destroy();
    vi.unstubAllGlobals();
  });

  it('refuses url(), so an attribute cannot reach past the origin policy', () => {
    const { m } = run(
      '<div data-vera-motion data-vera-motion-background="0% url(https://evil.test/x.png), 100% red"></div>');
    expect(m.rejected.flatMap((r) => r.rejected).some((r) => r.includes('url('))).toBe(true);
    m.destroy();
    vi.unstubAllGlobals();
  });

  /**
   * The whole image-sourcing family, not the one spelling. `image-set("…")`
   * takes bare string URLs, passes `CSS.supports('background', …)`, and
   * fetches in all three engines with no `url(` anywhere in the value —
   * measured, `spikes/paint-imageset.mjs`. A guard that names only `url(` is
   * a guard an attribute walks straight past.
   */
  it('refuses every image-sourcing function, not just the url() spelling', () => {
    for (const payload of [
      'image-set(&quot;https://evil.test/x.png&quot; 1x)',
      '-webkit-image-set(&quot;https://evil.test/x.png&quot; 1x)',
      'image(&quot;https://evil.test/x.png&quot;)',
      'cross-fade(red, blue, 50%)',
      'element(#other)',
    ]) {
      const { m } = run(
        `<div data-vera-motion data-vera-motion-background="0% ${payload}, 100% red"></div>`);
      const reasons = m.rejected.flatMap((r) => r.rejected);
      expect(reasons.length > 0).toBe(true);
      m.destroy();
      vi.unstubAllGlobals();
    }
  });

  it('shares one slot between elements using the same value', () => {
    const { m } = run(
      '<div data-vera-motion data-vera-motion-background="0% red, 100% blue"></div>');
    const first = [...m.elements[0].plan.all[0].curve.values];
    m.destroy();
    const again = run('<div data-vera-motion data-vera-motion-background="0% red, 100% blue"></div>');
    expect([...again.m.elements[0].plan.all[0].curve.values]).toEqual(first);
    again.m.destroy();
    vi.unstubAllGlobals();
  });
});
