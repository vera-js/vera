import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

let queue, nextHandle, now;
beforeEach(() => {
  queue = []; nextHandle = 0; now = 0;
  vi.stubGlobal('requestAnimationFrame', (fn) => { const h = ++nextHandle; queue.push([h, fn]); return h; });
  vi.stubGlobal('cancelAnimationFrame', (h) => { queue = queue.filter(([q]) => q !== h); });
  document.body.innerHTML = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('active class inside a custom scrollElement', () => {
  it('measures targets in the container coordinates it compares against', () => {
    document.body.innerHTML = `
      <nav><a href="#one">one</a><a href="#two">two</a></nav>
      <div id="pane"><section id="one"></section><section id="two"></section></div>`;

    const pane = document.getElementById('pane');
    /** The pane itself sits 500px down the document. */
    Object.defineProperty(pane, 'offsetTop', { value: 500, configurable: true });
    Object.defineProperty(pane, 'offsetHeight', { value: 900, configurable: true });
    Object.defineProperty(pane, 'offsetParent', { value: null, configurable: true });
    Object.defineProperty(pane, 'clientHeight', { value: 900, configurable: true });
    Object.defineProperty(pane, 'scrollHeight', { value: 3000, configurable: true });
    pane.scrollTop = 0;

    /** Sections are 500 and 1500 *inside* the pane, i.e. 1000 / 2000 in the document. */
    [['one', 1000], ['two', 2000]].forEach(([id, top]) => {
      const el = document.getElementById(id);
      Object.defineProperty(el, 'offsetTop', { value: top, configurable: true });
      Object.defineProperty(el, 'offsetHeight', { value: 900, configurable: true });
      Object.defineProperty(el, 'offsetParent', { value: null, configurable: true });
    });

    const s = createScrollTo({ scrollElement: pane, activeThreshold: 0.1 });
    s.init();

    /** Scroll the pane so section "one" (500 inside it) is at the top. */
    pane.scrollTop = 520;
    pane.dispatchEvent(new Event('scroll'));
    queue.splice(0).forEach(([, fn]) => fn(now += 16));

    const active = [...document.querySelectorAll('nav a')]
      .filter((a) => a.classList.contains('active')).map((a) => a.getAttribute('href'));
    expect(active).toEqual(['#one']);
    s.destroy();
  });
});
