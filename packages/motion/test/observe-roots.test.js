import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { split } from '../src/split.ts';

wireMotion(split);

const P = 'data-vera-motion';
const place = (n) => {
  Object.defineProperty(n, 'offsetTop', { value: 500, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};
const settle = async () => {
  await new Promise((r) => setTimeout(r, 30));
  await new Promise((r) => setTimeout(r, 30));
};

const shadow = () => {
  document.body.innerHTML = '<div id="host"></div>';
  const root = document.getElementById('host').attachShadow({ mode: 'open' });
  root.innerHTML =
    `<div id="inner" ${P} ${P}-translate-y="0% 0px, 100% 40px"></div>` +
    `<p id="words" ${P} ${P}-split="words" ${P}-opacity="0% 0, 100% 1">one two three</p>`;
  for (const node of root.querySelectorAll('div,p')) place(node);
  return root;
};

beforeEach(() => { document.body.innerHTML = ''; });

/**
 * `querySelectorAll` does not pierce shadow DOM, so a component registers its
 * own root. That root has to get the same treatment as the default one —
 * including the modules, which is the half that was missing.
 */
describe('observe() and unobserve() give a root the full lifecycle', () => {
  it('runs DOM-rewriting modules over a newly observed root', async () => {
    const root = shadow();
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(m.elements).toHaveLength(0);

    m.observe(root);
    await settle();

    /** Without `prepare`, the paragraph was adopted whole: one block, no cascade. */
    expect(root.querySelectorAll('span[aria-hidden]')).toHaveLength(3);
    expect(root.getElementById('words').querySelector(':scope > span:not([aria-hidden])').textContent).toBe('one two three');
    m.destroy();
  });

  it('animates elements inside the observed root', async () => {
    const root = shadow();
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    m.observe(root);
    await settle();

    Object.defineProperty(window, 'scrollY', { value: 5000, configurable: true });
    m.refresh();
    expect(root.getElementById('inner').style.transform).toBe('translateY(40px)');
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    m.destroy();
  });

  it('gives the root back on unobserve, modules included', async () => {
    const root = shadow();
    const before = root.innerHTML;
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    m.observe(root);
    await settle();
    expect(root.querySelectorAll('span[aria-hidden]').length).toBeGreaterThan(0);

    m.unobserve(root);
    await settle();

    /** The pieces went back, not just the styles. */
    expect(root.querySelectorAll('span[aria-hidden]')).toHaveLength(0);
    expect(root.innerHTML).toBe(before);
    expect(m.elements).toHaveLength(0);

    /** And it stays given up: a change in there is no longer this instance's. */
    root.getElementById('inner').setAttribute(`${P}-opacity`, '0% 0, 100% 1');
    await settle();
    expect(m.elements).toHaveLength(0);
    expect(root.getElementById('inner').style.filter).toBe('');
    m.destroy();
  });

  it('can observe the same root again after unobserving it', async () => {
    const root = shadow();
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    m.observe(root);
    await settle();
    m.unobserve(root);
    await settle();

    m.observe(root);
    await settle();
    expect(root.querySelectorAll('span[aria-hidden]')).toHaveLength(3);
    expect(m.elements.length).toBeGreaterThan(0);
    m.destroy();
  });

  it('leaves the default root alone when a second root is unobserved', async () => {
    document.body.innerHTML =
      `<p id="main" ${P} ${P}-split="words" ${P}-opacity="0% 0, 100% 1">alpha beta</p>` +
      '<div id="host"></div>';
    place(document.getElementById('main'));
    const root = document.getElementById('host').attachShadow({ mode: 'open' });
    root.innerHTML = `<div ${P} ${P}-opacity="0% 0, 100% 1"></div>`;
    place(root.firstElementChild);

    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    m.observe(root);
    await settle();
    expect(document.querySelectorAll('#main span[aria-hidden]')).toHaveLength(2);

    m.unobserve(root);
    await settle();
    /** The document's own split is untouched. */
    expect(document.querySelectorAll('#main span[aria-hidden]')).toHaveLength(2);
    m.destroy();
  });
});
