import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion, EVENTS } from '../src/index.ts';

const P = 'data-vm';
const place = (node, top = 0) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 300, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};
const scrollTo = (y) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
const settle = async () => {
  await new Promise((r) => setTimeout(r, 30));
  await new Promise((r) => setTimeout(r, 30));
};

beforeEach(() => { document.body.innerHTML = ''; scrollTo(0); });

/**
 * Latched means the end value holds. `disable()` strips every animated style
 * and `start()` puts them back with `force`, so a latched element is repainted
 * rather than skipped — but repainted at what it latched at, not recomputed
 * from whatever the page looks like now.
 */
describe('a latched run-once element survives a disable/enable toggle', () => {
  it('keeps its end value even after the page has scrolled back', () => {
    document.body.innerHTML =
      `<div ${P} ${P}-run-once ${P}-translate-y="0% 0px, 100% 120px"></div>`;
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();

    scrollTo(5000);
    m.refresh();
    expect(node.style.transform).toBe('translateY(120px)');

    /** Latched, so scrolling back does not move it. */
    scrollTo(0);
    m.refresh();
    expect(node.style.transform).toBe('translateY(120px)');

    m.disable();
    expect(node.style.transform).toBe('');
    m.enable();
    /** Recomputing from the current scroll would put it back near the start. */
    expect(node.style.transform).toBe('translateY(120px)');
    m.destroy();
  });

  it('keeps a state-driven element’s end value across a toggle', async () => {
    document.body.innerHTML =
      `<div ${P} ${P}-when=".on" ${P}-run-once ${P}-translate-y="0% 0px, 100% 40px"></div>`;
    const node = document.body.firstElementChild;
    place(node, 500);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    await settle();

    node.setAttribute('class', 'on');
    await settle();
    const latched = node.style.transform;
    expect(latched).toBe('translateY(40px)');

    m.disable();
    await settle();
    expect(node.style.transform).toBe('');

    m.enable();
    await settle();
    expect(node.style.transform).toBe(latched);
    m.destroy();
  });

  it('keeps it even when the selector has stopped matching', async () => {
    document.body.innerHTML =
      `<div ${P} ${P}-when=".on" ${P}-run-once ${P}-translate-y="0% 0px, 100% 40px"></div>`;
    const node = document.body.firstElementChild;
    place(node, 500);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    await settle();

    node.setAttribute('class', 'on');
    await settle();
    node.removeAttribute('class');
    await settle();
    /** Latched: the class going away does not rewind it. */
    expect(node.style.transform).toBe('translateY(40px)');

    m.disable();
    m.enable();
    await settle();
    expect(node.style.transform).toBe('translateY(40px)');
    m.destroy();
  });

  it('announces no second completion for either kind', async () => {
    document.body.innerHTML =
      `<div id="s" ${P} ${P}-run-once ${P}-translate-y="0% 0px, 100% 120px"></div>` +
      `<div id="w" ${P} ${P}-when=".on" ${P}-run-once ${P}-opacity="0% 0, 100% 1"></div>`;
    for (const node of document.querySelectorAll('div')) place(node, 500);
    let completes = 0;
    const count = () => completes++;
    document.addEventListener(EVENTS.complete, count);

    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    scrollTo(5000);
    m.refresh();
    document.getElementById('w').setAttribute('class', 'on');
    await settle();
    expect(completes).toBe(2);

    m.disable();
    m.enable();
    await settle();
    expect(completes, 'a forced repaint is not a completion').toBe(2);

    document.removeEventListener(EVENTS.complete, count);
    m.destroy();
  });
});
