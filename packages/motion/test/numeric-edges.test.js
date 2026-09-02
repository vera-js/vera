import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const setup = (html, geom = {}) => {
  document.body.innerHTML = html;
  const node = document.body.firstElementChild;
  Object.defineProperty(node, 'offsetTop', { value: geom.top ?? 500, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: geom.height ?? 200, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return { node, m };
};

const finite = (style) => {
  const numbers = String(style).match(/-?\d+(\.\d+)?(e[+-]?\d+)?/gi) ?? [];
  return numbers.every((n) => Number.isFinite(Number(n)));
};

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

describe('numeric edges never reach the DOM as NaN', () => {
  const CASES = [
    ['zero-height element',   '<div data-vm data-vm-translate-y="0% 0px, 100% 40px"></div>', { height: 0 }],
    ['keyframes outside 0-100', '<div data-vm data-vm-translate-y="-200% 0px, 300% 40px"></div>', {}],
    ['identical positions',   '<div data-vm data-vm-translate-y="50% 0px, 50% 40px"></div>', {}],
    ['single keyframe',       '<div data-vm data-vm-opacity="0.5"></div>', {}],
    ['huge value',            '<div data-vm data-vm-translate-y="0% 0px, 100% 99999px"></div>', {}],
    ['negative value',        '<div data-vm data-vm-translate-y="0% -5000px, 100% 5000px"></div>', {}],
    ['element above viewport','<div data-vm data-vm-translate-y="0% 0px, 100% 40px"></div>', { top: 0 }],
    ['tiny range',            '<div data-vm data-vm-translate-y="49.999% 0px, 50.001% 40px"></div>', {}],
    ['many keyframes',        `<div data-vm data-vm-opacity="${Array.from({length:60},(_,i)=>`${i*1.6}% ${(i%2)}`).join(', ')}"></div>`, {}],
  ];

  it('never produces a non-finite value at any scroll position', () => {
    const bad = [];
    for (const [name, html, geom] of CASES) {
      const { node, m } = setup(html, geom);
      let sawSomething = false;
      for (const y of [0, 1, 250, 700, 1500, 5000, 99999]) {
        Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
        m.refresh();
        const styles = `${node.style.transform}|${node.style.filter}|${node.style.borderTopLeftRadius}`;
        if (styles.replace(/\|/g, '')) sawSomething = true;
        if (!finite(styles) || /NaN|Infinity/i.test(styles)) {
          bad.push(`${name} @${y}: ${styles}`);
        }
      }
      if (!sawSomething) bad.push(`${name}: applied nothing at any position (control)`);
      m.destroy();
    }
    expect(bad).toEqual([]);
  });
});

/**
 * The float64 cliff. Every value below is past `MAX_MEASURE` (1e9) or outside
 * the grammar, and each has a specific catastrophe waiting if the bound slips:
 * a finite ±1.666e308 pair overflows the *slope* to Infinity (and an eased
 * segment multiplies that by zero — NaN); 1e309 in digits parses to Infinity
 * on its own. The engines would take the strings — re-measured 2026-09-01,
 * all three accept `translateY(1e+21px)` — so the refusal is this library's
 * own arithmetic bound, and it must be a *reported* refusal, not a silence.
 */
describe('the float64 cliff is refused at parse, with a reason', () => {
  const HUGE = '1' + '6'.repeat(3) + '0'.repeat(305);
  const CLIFF = [
    ['a finite pair whose slope overflows', `0% -${HUGE}px, 100% ${HUGE}px`],
    ['a value that parses to Infinity', `0% 0px, 100% 1${'0'.repeat(309)}px`],
    ['e-notation, which the grammar does not speak', '0% 1e2px, 100% 2e2px'],
  ];

  for (const [name, keyframes] of CLIFF) {
    it(`refuses ${name}`, () => {
      const { node, m } = setup(
        `<div data-vm data-vm-translate-y="${keyframes}"></div>`);
      expect(m.rejected.flatMap((r) => r.rejected).length > 0).toBe(true);
      for (const y of [0, 250, 700]) {
        Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
        m.refresh();
      }
      expect(/NaN|Infinity/i.test(node.style.transform)).toBe(false);
      m.destroy();
    });
  }
});
