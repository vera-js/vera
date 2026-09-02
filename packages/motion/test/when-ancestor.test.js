import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const P = 'data-vm';
const place = (n) => {
  Object.defineProperty(n, 'offsetTop', { value: 500, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};
const settle = async () => {
  await new Promise((r) => setTimeout(r, 30));
  await new Promise((r) => setTimeout(r, 30));
};

beforeEach(() => { document.body.innerHTML = ''; });

/**
 * `when` takes an ordinary CSS selector, and `Element.matches` is happy with a
 * descendant combinator — so `.is-open .panel` is both legal and the way anyone
 * would write "while my section is open". The observer only reported attribute
 * changes that happened *on an animated element*, so that selector could never
 * be re-evaluated: the thing that changed was the ancestor.
 */
describe('a when selector that names an ancestor', () => {
  const build = (selector, html) => {
    document.body.innerHTML = html;
    const node = document.getElementById('t');
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    return { node, m };
  };

  it('re-evaluates when the ancestor’s class changes', async () => {
    const { node, m } = build('.open #t',
      `<section id="host"><div id="t" ${P} ${P}-when=".open #t"
        ${P}-translate-y="0% 0px, 100% 40px"></div></section>`);
    await settle();
    const resting = node.style.transform;

    document.getElementById('host').classList.add('open');
    await settle();
    expect(node.style.transform).not.toBe(resting);

    document.getElementById('host').classList.remove('open');
    await settle();
    expect(node.style.transform).toBe(resting);
    m.destroy();
  });

  it('re-evaluates on an attribute, not only a class', async () => {
    const { node, m } = build('[aria-expanded="true"] #t',
      `<section id="host" aria-expanded="false"><div id="t" ${P}
        ${P}-when='[aria-expanded="true"] #t'
        ${P}-translate-y="0% 0px, 100% 40px"></div></section>`);
    await settle();
    const resting = node.style.transform;

    document.getElementById('host').setAttribute('aria-expanded', 'true');
    await settle();
    expect(node.style.transform).not.toBe(resting);
    m.destroy();
  });

  it('still works when the element itself is the one that changes', async () => {
    const { node, m } = build('.on',
      `<div id="t" ${P} ${P}-when=".on" ${P}-translate-y="0% 0px, 100% 40px"></div>`);
    await settle();
    const resting = node.style.transform;

    node.classList.add('on');
    await settle();
    expect(node.style.transform).not.toBe(resting);
    m.destroy();
  });

  it('leaves a scroll-driven element alone when a foreign attribute changes', async () => {
    document.body.innerHTML =
      `<section id="host"><div id="t" ${P} ${P}-translate-y="0% 0px, 100% 40px"></div></section>`;
    const node = document.getElementById('t');
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    await settle();
    const before = node.style.transform;

    /** No `when`, so a class toggle anywhere must not move it. */
    document.getElementById('host').classList.add('open');
    await settle();
    expect(node.style.transform).toBe(before);
    m.destroy();
  });
});

/**
 * `stagger` is the one attribute that belongs on the parent, and that parent
 * is usually not animated itself — so its changes hit the same guard.
 */
describe('a container attribute on a parent that is not itself animated', () => {
  it('re-parses the group when the stagger step is edited', async () => {
    document.body.innerHTML =
      `<div id="host" ${P}-stagger="10%">
        <div id="a" ${P} ${P}-translate-y="0% 0px, 100% 40px"></div>
        <div id="b" ${P} ${P}-translate-y="0% 0px, 100% 40px"></div>
      </div>`;
    for (const id of ['a', 'b']) place(document.getElementById(id));
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    await settle();

    const steps = () => m.elements.map((e) => e.parsed.stagger?.position ?? 0);
    expect(steps()).toEqual([0, 10]);

    document.getElementById('host').setAttribute(`${P}-stagger`, '30%');
    await settle();
    expect(steps()).toEqual([0, 30]);
    m.destroy();
  });

  it('drops the offsets when the stagger attribute is removed', async () => {
    document.body.innerHTML =
      `<div id="host" ${P}-stagger="10%">
        <div id="a" ${P} ${P}-translate-y="0% 0px, 100% 40px"></div>
        <div id="b" ${P} ${P}-translate-y="0% 0px, 100% 40px"></div>
      </div>`;
    for (const id of ['a', 'b']) place(document.getElementById(id));
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    await settle();

    document.getElementById('host').removeAttribute(`${P}-stagger`);
    await settle();
    expect(m.elements.map((e) => e.parsed.stagger?.position ?? 0)).toEqual([0, 0]);
    m.destroy();
  });
});
