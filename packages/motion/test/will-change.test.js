import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { paint } from '../src/paint.ts';

wireMotion(paint);

const P = 'data-vera-motion';
const place = (n) => {
  for (const [k, v] of [['offsetTop', 500], ['offsetHeight', 200]]) {
    Object.defineProperty(n, k, { value: v, configurable: true });
  }
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => { document.body.innerHTML = ''; });

const hintFor = (attributes) => {
  document.body.innerHTML = `<div ${P} ${P}-will-change="true" ${attributes}></div>`;
  const node = document.body.firstElementChild;
  place(node);
  const m = createMotion({ respectReducedMotion: false });
  m.init();
  const hint = node.style.willChange;
  m.destroy();
  return hint.split(',').map((s) => s.trim()).filter(Boolean).sort();
};

/**
 * `will-change` is a request to the compositor with real memory behind it.
 * Naming properties an element does not animate buys a layer promotion for
 * nothing; omitting the one it does animate misses the point entirely.
 */
describe('will-change names what the element animates', () => {
  /**
   * `opacity` is a *filter* function here — `filter: opacity()` — so that it
   * composes into the one filter string rather than needing a write of its
   * own. `filter` is the right hint for it, and checking that was what caught
   * my own wrong expectation.
   */
  it('names filter for a fade, because opacity is a filter function', () => {
    expect(hintFor(`${P}-opacity="0% 0, 100% 1"`)).toEqual(['filter']);
  });

  it('names a plain CSS property for one that is neither', () => {
    expect(hintFor(`${P}-radius="0% 0px, 100% 20px"`)).toEqual(['border-radius']);
  });

  it('names transform for a transform', () => {
    expect(hintFor(`${P}-translate-y="0% 0px, 100% 40px"`)).toEqual(['transform']);
  });

  it('names filter for a filter', () => {
    expect(hintFor(`${P}-blur="0% 0px, 100% 4px"`)).toEqual(['filter']);
  });

  it('names a module’s property', () => {
    expect(hintFor(`${P}-background="0% red, 100% blue"`)).toEqual(['background']);
  });

  it('names each of them once for a combination', () => {
    expect(hintFor(
      `${P}-translate-y="0% 0px, 100% 40px" ${P}-rotate="0% 0deg, 100% 90deg" ` +
      `${P}-blur="0% 0px, 100% 4px" ${P}-opacity="0% 0, 100% 1"`
    )).toEqual(['filter', 'transform']);
  });

  it('writes nothing when the setting is off', () => {
    document.body.innerHTML = `<div ${P} ${P}-opacity="0% 0, 100% 1"></div>`;
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, willChange: false });
    m.init();
    expect(node.style.willChange).toBe('');
    m.destroy();
  });

  it('takes the hint back off on destroy', () => {
    document.body.innerHTML = `<div ${P} ${P}-will-change="true" ${P}-opacity="0% 0, 100% 1"></div>`;
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    expect(node.style.willChange).not.toBe('');
    m.destroy();
    expect(node.style.willChange).toBe('');
  });
});
