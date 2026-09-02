import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const settle = () => new Promise((r) => setTimeout(r, 30));
const place = (n, top = 500) => {
  Object.defineProperty(n, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('live attribute edits', () => {
  it('re-animates when a keyframe value is changed', async () => {
    document.body.innerHTML = '<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>';
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const before = node.style.transform;

    node.setAttribute('data-vera-motion-translate-y', '0% 0px, 100% 400px');
    await settle();
    const after = node.style.transform;
    expect(after).not.toBe(before);
    m.destroy();
  });

  it('drops the animation when the attribute is removed', async () => {
    document.body.innerHTML = '<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>';
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(node.style.transform).not.toBe('');

    node.removeAttribute('data-vera-motion-translate-y');
    await settle();
    expect(node.style.transform).toBe('');
    m.destroy();
  });

  it('picks up a setting added live', async () => {
    document.body.innerHTML = '<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>';
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(node.style.willChange).toBe('');

    node.setAttribute('data-vera-motion-will-change', '');
    await settle();
    /** `opacity` is a filter function here, so `filter` is the whole hint. */
    expect(node.style.willChange).toBe('filter');
    m.destroy();
  });

  it('un-marks an element when the marker attribute is removed', async () => {
    document.body.innerHTML = '<div data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>';
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(m.elements).toHaveLength(1);

    node.removeAttribute('data-vera-motion');
    await settle();
    expect(m.elements).toHaveLength(0);
    expect(node.style.transform).toBe('');
    m.destroy();
  });

  it('starts animating when the marker attribute is added', async () => {
    document.body.innerHTML = '<div data-vera-motion-translate-y="0% 0px, 100% 40px"></div>';
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(m.elements).toHaveLength(0);

    node.setAttribute('data-vera-motion', '');
    await settle();
    expect(m.elements).toHaveLength(1);
    expect(node.style.transform).not.toBe('');
    m.destroy();
  });
});

/**
 * The other order the attributes can arrive in.
 *
 * "starts animating when the marker attribute is added" above covers a bare
 * element that already carries its animation attribute and then gains the
 * marker. This is the reverse: the marker lands first, on an element with
 * nothing to animate yet, and the values follow in a later batch. A GUI can
 * write them either way round, and the first batch adopts an element whose
 * animation list is empty.
 *
 * I added two tests here and one of them already existed — I had read the file
 * through a `grep` that stopped at eight matches and did not check. The
 * duplicate is gone; this is the half that was genuinely missing.
 *
 * **It is a specification, not a regression net.** Breaking the marker path in
 * the observer fails the two tests above and leaves this one green, because
 * here the marker lands on an element with nothing to animate and the adoption
 * happens when the *values* arrive — a different branch. I could not construct
 * a plant that fails this and not those, so read it as pinning a supported
 * ordering rather than as guarding a mechanism. The `<template>` tests below
 * do guard one: teaching `animatedWithin` to walk `template.content` fails
 * them.
 */
describe('an element that becomes animated', () => {
  it('is adopted when the marker arrives before its animation attributes', async () => {
    document.body.innerHTML = '<div id="plain"></div>';
    const node = document.getElementById('plain');
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();

    node.setAttribute('data-vera-motion', '');
    await settle();
    node.setAttribute('data-vera-motion-opacity', '0% 0, 100% 1');
    await settle();

    expect(m.elements).toHaveLength(1);
    expect(m.elements[0].node).toBe(node);
    m.destroy();
  });
});

/**
 * `<template>` content is inert — it lives in a separate document fragment and
 * is never rendered until it is cloned. Animating it would write styles onto
 * elements nobody can see, and worse, it would adopt them: the runtime would
 * hold references into a fragment the page may clone many times.
 */
describe('inert content', () => {
  it('does not adopt elements inside a <template>', async () => {
    document.body.innerHTML =
      '<template><div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div></template>';
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(m.elements).toHaveLength(0);
    m.destroy();
  });

  it('nor when the template is added after init', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();

    document.getElementById('host').innerHTML =
      '<template><div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div></template>';
    await settle();

    expect(m.elements).toHaveLength(0);
    m.destroy();
  });

  /** But it animates once the page clones it into the document, which is the point. */
  it('but does adopt the clone once it is in the document', async () => {
    document.body.innerHTML =
      '<div id="host"></div>' +
      '<template id="t"><div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div></template>';
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();

    const clone = document.getElementById('t').content.cloneNode(true);
    place(clone.firstElementChild);
    document.getElementById('host').appendChild(clone);
    await settle();

    expect(m.elements).toHaveLength(1);
    m.destroy();
  });
});
