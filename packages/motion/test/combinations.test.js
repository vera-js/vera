import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { split } from '../src/split.ts';
import { wireMotion } from '../src/index.ts';
import { createMotion } from '../src/index.ts';

wireMotion([split]);

const settle = () => new Promise((r) => setTimeout(r, 30));
const place = (n, top = 500) => {
  Object.defineProperty(n, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('the when state machine', () => {
  const build = (extra = '') => {
    document.body.innerHTML =
      `<div data-vm data-vm-when=".on" ${extra} data-vm-translate-y="0% 0px, 100% 40px"></div>`;
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    return { node, m };
  };

  it('rests at the start value, then moves to the end when the selector matches', async () => {
    const { node, m } = build();
    const resting = node.style.transform;
    node.classList.add('on');
    await settle();
    const on = node.style.transform;
    node.classList.remove('on');
    await settle();
    const off = node.style.transform;
    expect(on).not.toBe(resting);
    expect(off).toBe(resting);
    m.destroy();
  });

  it('does not react to scroll', () => {
    const { node, m } = build();
    const before = node.style.transform;
    Object.defineProperty(window, 'scrollY', { value: 900, configurable: true });
    m.refresh();
    expect(node.style.transform).toBe(before);
    m.destroy();
  });

  it('with run-once, latches on first match and ignores the class going away', async () => {
    const { node, m } = build('data-vm-run-once');
    node.classList.add('on');
    await settle();
    const latched = node.style.transform;
    node.classList.remove('on');
    await settle();
    expect(node.style.transform).toBe(latched);
    m.destroy();
  });

  it('survives a disable/enable toggle while matching', async () => {
    const { node, m } = build();
    node.classList.add('on');
    await settle();
    const on = node.style.transform;
    m.disable();
    m.enable();
    expect(node.style.transform).toBe(on);
    m.destroy();
  });
});

describe('feature combinations', () => {
  it('stagger applies to split pieces', async () => {
    document.body.innerHTML =
      '<p data-vm data-vm-split="words" data-vm-stagger="10%" data-vm-opacity="0% 0, 100% 1">one two three</p>';
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    await settle();
    const offsets = [...node.querySelectorAll('span[aria-hidden]')].map((s) => {
      const el = m.elements.find((e) => e.node === s);
      return el ? Number(el.plan.all[0].curve.positions[0].toFixed(4)) : null;
    });
    expect(new Set(offsets).size).toBe(offsets.length);
    m.destroy();
  });

  it('a preset and an explicit band coexist', () => {
    document.body.innerHTML =
      '<div data-vm="fade-up" data-vm-translate-y="[0-3000]: 0% 200px, 100% 0px"></div>';
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const ty = m.elements[0].plan.all.find((a) => a.property.attribute === 'translate-y');
    const values = ty ? [...ty.curve.values] : null;
    expect(m.elements).toHaveLength(1);
    /** The band declares 200px -> 0px; the fade-up preset declares something else. */
    expect(values).toEqual([200, 0]);
    m.destroy();
  });

  it('pin and a transform animation coexist', () => {
    document.body.innerHTML =
      '<div data-vm data-vm-pin="20px" data-vm-translate-y="0% 0px, 100% 40px"></div>';
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(node.style.position).toBe('sticky');
    expect(node.style.transform).not.toBe('');
    m.destroy();
  });
});
