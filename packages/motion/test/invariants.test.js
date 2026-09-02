import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const settle = () => new Promise((r) => setTimeout(r, 0));
const ITEM = (id) => `<div id="${id}" data-vm data-vm-opacity="0% 0, 100% 1"></div>`;

/**
 * The instance keeps three views of the same set: the `elements` array, a
 * node→element Map, and the visibility tracker's observed set. Every add and
 * remove path has to update all three, and there are six such paths — init,
 * adopt, drop, observe, unobserve and the two mutation handlers.
 */
const check = (a, label) => {
  const elements = a.elements;
  const ids = elements.map((e) => e.node.id);
  expect(new Set(ids).size, `${label}: duplicate elements`).toBe(ids.length);
  for (const e of elements) {
    expect(e.node.isConnected, `${label}: ${e.node.id} registered but detached`).toBe(true);
    expect(e.plan, `${label}: ${e.node.id} has no plan`).toBeTruthy();
  }
  const inDom = [...document.querySelectorAll('[data-vm]')].filter((n) => n.hasAttribute('data-vm-opacity'));
  expect(elements.length, `${label}: registered ${elements.length}, DOM has ${inDom.length}`).toBe(inDom.length);
};

describe('bookkeeping invariants', () => {
  it('holds across add, move, remove, re-add', async () => {
    document.body.innerHTML = ITEM('a') + ITEM('b') + '<div id="box"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    check(a, 'after init');

    document.body.insertAdjacentHTML('beforeend', ITEM('c'));
    await settle();
    check(a, 'after add');

    document.getElementById('box').appendChild(document.getElementById('c'));
    await settle();
    check(a, 'after move');

    document.getElementById('b').remove();
    await settle();
    check(a, 'after remove');

    document.body.insertAdjacentHTML('beforeend', ITEM('d'));
    await settle();
    check(a, 'after re-add');

    a.destroy();
    expect(a.elements).toHaveLength(0);
  });

  it('holds across attribute rewrites', async () => {
    document.body.innerHTML = ITEM('a') + ITEM('b');
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    const node = document.getElementById('a');
    for (const value of ['0% 0, 50% 1', '0% 0.2, 100% 1', '0% 0, 100% 1']) {
      node.setAttribute('data-vm-opacity', value);
      await settle();
      check(a, `after rewriting to ${value}`);
    }
    a.destroy();
  });

  it('holds across observe and unobserve of a shadow root', async () => {
    document.body.innerHTML = ITEM('a') + '<div id="host"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    const root = document.getElementById('host').attachShadow({ mode: 'open' });
    root.innerHTML = ITEM('s');
    a.observe(root);
    await settle();
    expect(a.elements).toHaveLength(2);
    a.unobserve(root);
    await settle();
    expect(a.elements).toHaveLength(1);
    check(a, 'after unobserve');
    a.destroy();
  });
});
