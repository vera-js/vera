import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const settle = () => new Promise((r) => setTimeout(r, 30));
const place = (node, top) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 100, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

/**
 * Read in document order, not in whatever order `elements` happens to hold —
 * the offsets can all be distinct and still be on the wrong elements.
 */
const cascade = (host, m) =>
  [...host.querySelectorAll('[data-vera-motion]')].map((node) => {
    const element = m.elements.find((e) => e.node === node);
    return element ? Number(element.plan.all[0].curve.positions[0].toFixed(4)) : null;
  });

const item = () => {
  const node = document.createElement('div');
  node.setAttribute('data-vera-motion', '');
  node.setAttribute('data-vera-motion-opacity', '0% 0, 100% 1');
  return node;
};

beforeEach(() => { document.body.innerHTML = ''; });

/**
 * A stagger offset is index x step in document order, and the index is decided
 * at parse time. Inserting or removing one element changes the index of every
 * element after it — and those elements did not mutate, so nothing else would
 * re-parse them.
 */
describe('stagger re-resolves when the group changes', () => {
  const build = (count) => {
    document.body.innerHTML = '<div id="host" data-vera-motion-stagger="10%"></div>';
    const host = document.getElementById('host');
    for (let i = 0; i < count; i++) {
      const node = item();
      node.id = `i${i}`;
      host.append(node);
      place(node, 500 + i * 100);
    }
    return host;
  };

  it('gives a prepended element index 0 and pushes the rest along', async () => {
    const host = build(2);
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    expect(cascade(host, m)).toEqual([0, 0.1]);

    const fresh = item();
    host.insertBefore(fresh, host.firstElementChild);
    place(fresh, 400);
    await settle();

    expect(cascade(host, m)).toEqual([0, 0.1, 0.2]);
    m.destroy();
  });

  it('closes the gap when a middle element is removed', async () => {
    const host = build(3);
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    expect(cascade(host, m)).toEqual([0, 0.1, 0.2]);

    document.getElementById('i1').remove();
    await settle();

    expect(cascade(host, m)).toEqual([0, 0.1]);
    m.destroy();
  });
});
