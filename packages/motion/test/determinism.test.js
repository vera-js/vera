import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const place = (n, top) => {
  Object.defineProperty(n, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

const MARKUP = `
  <div id="a" data-vm data-vm-translate-y="0% 0px, 100% 90px" data-vm-rotate="0% 0deg, 100% 45deg"></div>
  <div id="b" data-vm="fade-up"></div>
  <div id="c" data-vm data-vm-opacity="0% 0, 50% 1, 100% 0.3" data-vm-blur="0% 8px, 100% 0px"></div>
  <div id="d" data-vm data-vm-translate-x="0% 0px, 100% 60px; [0-900]: 100% 20px"></div>`;

const snapshot = () => {
  document.body.innerHTML = MARKUP;
  ['a', 'b', 'c', 'd'].forEach((id, i) => place(document.getElementById(id), 400 + i * 250));
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  const out = [];
  for (const y of [0, 300, 700, 1200, 2000]) {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
    m.refresh();
    out.push(['a', 'b', 'c', 'd'].map((id) => {
      const s = document.getElementById(id).style;
      return `${s.transform}|${s.filter}`;
    }).join('~'));
  }
  m.destroy();
  return out.join('\n');
};

describe('the runtime is deterministic', () => {
  /**
   * Same markup, same geometry, same scroll positions — the same styles, every
   * time. Anything that depends on iteration order of a Map, on parse order,
   * or on state left behind by a previous instance shows up here.
   */
  it('produces identical output across ten independent runs', () => {
    const first = snapshot();
    const runs = Array.from({ length: 9 }, () => snapshot());
    const differing = runs.filter((r) => r !== first).length;
    expect(differing).toBe(0);
    /** Control: the snapshot must contain actual values, or equality is vacuous. */
    expect(first).toMatch(/translateY\([-\d.]+px\)/);
    expect(first).toMatch(/opacity\([\d.]+\)/);
  });
});
