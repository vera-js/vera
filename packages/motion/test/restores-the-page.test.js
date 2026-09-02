import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { paint } from '../src/paint.ts';
import { easings } from '../src/easings.ts';
import { split } from '../src/split.ts';
import { sequence } from '../src/sequence.ts';

wireMotion([paint, easings, split, sequence()]);

let created = [];
class FakeImage {
  constructor() { created.push(this); this._src = ''; }
  set src(v) { this._src = v; }
  get src() { return this._src; }
  removeAttribute() { this._src = ''; }
}

const settle = async () => {
  await new Promise((r) => setTimeout(r, 30));
  await new Promise((r) => setTimeout(r, 30));
};

const place = (n) => {
  for (const [k, v] of [['offsetLeft', 100], ['offsetTop', 500], ['offsetWidth', 200], ['offsetHeight', 200]]) {
    Object.defineProperty(n, k, { value: v, configurable: true });
  }
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => {
  created = [];
  document.body.innerHTML = '';
  vi.stubGlobal('Image', FakeImage);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const P = 'data-vm';

/**
 * "Every listener, observer, rAF handle, and injected attribute needs a
 * matching teardown." The cheapest way to hold the whole library to that is to
 * photograph the markup before `init()` and demand it back after `destroy()` —
 * one assertion that covers every feature at once, including the ones that
 * rewrite the DOM rather than writing a style.
 */
describe('destroy() gives the page back exactly as it was', () => {
  const PAGE = `
    <div id="plain" ${P} ${P}-translate-y="0% 0px, 100% 40px" ${P}-opacity="0% 0, 100% 1"></div>
    <div id="pinned" ${P} ${P}-pin="20px" ${P}-scale="0% 0.8, 100% 1.1"></div>
    <div id="painted" ${P} ${P}-background="0% red, 100% blue" ${P}-inertia="0.3"></div>
    <div id="eased" ${P} ${P}-ease="ease-in-out" ${P}-rotate="0% 0deg, 100% 90deg"></div>
    <div id="willed" ${P} ${P}-will-change="true" ${P}-blur="0% 0px, 100% 4px"></div>
    <div id="origin" ${P} ${P}-transform-origin="top left" ${P}-skew-x="0% 0deg, 100% 10deg"></div>
    <div id="staggerhost" ${P}-stagger="10%">
      <div ${P} ${P}-translate-x="0% 0px, 100% 20px"></div>
      <div ${P} ${P}-translate-x="0% 0px, 100% 20px"></div>
    </div>
    <p id="words" ${P} ${P}-split="words" ${P}-opacity="0% 0, 100% 1">alpha beta gamma</p>
    <p id="chars" ${P} ${P}-split="chars" ${P}-stagger="2%" ${P}-opacity="0% 0, 100% 1">hey</p>
    <canvas id="frames" ${P} ${P}-frame="0% 0, 100% 9"
      ${P}-frame-url="/frames/" ${P}-frame-count="10"></canvas>
    <div id="stateful" ${P} ${P}-when=".on" ${P}-opacity="0% 0, 100% 1"></div>`;

  const build = () => {
    document.body.innerHTML = PAGE;
    for (const node of document.querySelectorAll('div, p, canvas')) place(node);
    const canvas = document.getElementById('frames');
    canvas.getContext = () => ({ drawImage: vi.fn() });
    return document.body.innerHTML;
  };

  it('restores the markup after a plain init/destroy', async () => {
    const before = build();
    const m = createMotion({ respectReducedMotion: false, inertia: 0.2 });
    m.init();
    await settle();

    /** It really did something, or the assertion below proves nothing. */
    expect(document.body.innerHTML).not.toBe(before);
    expect(document.querySelectorAll('#words span').length).toBeGreaterThan(0);

    m.destroy();
    await settle();
    expect(document.body.innerHTML).toBe(before);
  });

  it('restores the markup after scrolling, toggling and re-enabling', async () => {
    const before = build();
    const m = createMotion({ respectReducedMotion: false, inertia: 0.2 });
    m.init();
    await settle();

    /**
     * `setAttribute`/`removeAttribute` rather than `classList`, which leaves a
     * `class=""` behind and would fail this comparison for the test's own
     * reasons rather than the library's.
     */
    document.getElementById('stateful').setAttribute('class', 'on');
    await settle();
    window.dispatchEvent(new Event('scroll'));
    await settle();
    m.disable();
    await settle();
    m.enable();
    await settle();

    document.getElementById('stateful').removeAttribute('class');
    await settle();

    m.destroy();
    await settle();
    expect(document.body.innerHTML).toBe(before);
  });

  it('restores the markup after a destroy/init/destroy cycle', async () => {
    const before = build();
    const m = createMotion({ respectReducedMotion: false, inertia: 0.2 });
    m.init();
    await settle();
    m.destroy();
    await settle();
    m.init();
    await settle();
    m.destroy();
    await settle();
    expect(document.body.innerHTML).toBe(before);
  });
});
