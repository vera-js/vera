import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const P = 'data-vera-motion';
const place = (n) => {
  Object.defineProperty(n, 'offsetTop', { value: 500, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

/**
 * Transitions are applied a frame after the first values land, deliberately —
 * setting both in one frame animates the element in from wherever the browser
 * happened to have it. So every read here has to wait.
 */
const settle = async () => {
  await new Promise((r) => setTimeout(r, 30));
  await new Promise((r) => setTimeout(r, 30));
};

const transitionFor = async (attrs, options) => {
  document.body.innerHTML = `<div ${P} ${attrs} ${P}-translate-y="0% 0px, 100% 40px"></div>`;
  const node = document.body.firstElementChild;
  place(node);
  const m = createMotion({ respectReducedMotion: false, ...options });
  m.init();
  await settle();
  const transition = node.style.transition;
  m.destroy();
  return transition;
};

beforeEach(() => { document.body.innerHTML = ''; });

/**
 * `delay` was removed on 2026-08-30, and this is what it left behind.
 *
 * It wrote `transition-delay` on the transition `inertia` creates. Measured in
 * all three engines: because every frame sets a new target, each new target
 * restarted the delay, so an element with any delay at all **stood still for
 * the whole of a continuous scroll** and only caught up once scrolling
 * stopped — at 0.6s it never moved. The name promised "start later", which is
 * the one thing it could not do.
 *
 * What is pinned now is that the transition carries no delay component at all,
 * from any route: there is no attribute, no option, and nothing appended to
 * the string.
 */
describe('the transition carries no delay', () => {
  it('is the speed and the easing, and nothing after them', async () => {
    expect(await transitionFor(`${P}-inertia="0.2"`, { inertia: 0.2 }))
      .toBe('transform 0.2s cubic-bezier(0.33, 1, 0.68, 1)');
  });

  /** The attribute is gone, so writing it is an unknown attribute like any other. */
  it('and `delay` is not an attribute the schema knows', async () => {
    document.body.innerHTML =
      `<div ${P} ${P}-delay="0.3" ${P}-translate-y="0% 0px, 100% 40px"></div>`;
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0.2 });
    m.init();
    await settle();
    expect(node.style.transition).toBe('transform 0.2s cubic-bezier(0.33, 1, 0.68, 1)');
    expect(m.rejected.flatMap((entry) => entry.rejected).join(' | '))
      .toContain(`${P}-delay: no such attribute`);
    m.destroy();
  });

  /** Per category still works; it was only the delay that rode along. */
  it('still gives each category its own speed', async () => {
    document.body.innerHTML =
      `<div ${P} ${P}-transform-inertia="0" ${P}-filter-inertia="0.5" ` +
      `${P}-translate-y="0% 0px, 100% 40px" ${P}-blur="0% 0px, 100% 4px"></div>`;
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0.2 });
    m.init();
    await settle();
    expect(node.style.transition).toBe('filter 0.5s cubic-bezier(0.33, 1, 0.68, 1)');
    m.destroy();
  });
});
