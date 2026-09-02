import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * A `scrollElement` that has left the document.
 *
 * `scrollElement: '#pane'` is resolved once at `init()` and the scroll listener
 * is bound to whatever it found. Replace that pane — which is what a component
 * framework does on a route change: same selector, new node — and the instance
 * goes on listening to a node that is no longer in the document.
 *
 * The symptom is worth stating precisely, because the obvious check does not
 * show it. `elements` is *correct* afterwards: `collect()` drops the old child
 * and adopts the new one. What is wrong is that scrolling the new pane changes
 * nothing, and the new element is painted from the **old** pane's last
 * `scrollTop` — so it comes up half-animated at rest, from a scroll position
 * belonging to a container that no longer exists.
 *
 * Reported rather than re-resolved: re-binding the listener and re-measuring
 * mid-life is a behaviour change on a rare path, and making it self-heal is a
 * decision rather than a repair.
 */
const P = 'data-vm';

const pane = (childId, scrollTop) => {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div id="pane" style="height:400px;overflow:auto">` +
    `<div id="${childId}" ${P} ${P}-opacity="0% 0, 100% 1"></div></div>`
  );
  const box = document.getElementById('pane');
  for (const [key, value] of [['scrollHeight', 4000], ['clientHeight', 400]]) {
    Object.defineProperty(box, key, { value, configurable: true });
  }
  Object.defineProperty(box, 'scrollTop', { value: scrollTop, configurable: true });
  const child = document.getElementById(childId);
  for (const [key, value] of [['offsetTop', 900], ['offsetHeight', 200]]) {
    Object.defineProperty(child, key, { value, configurable: true });
  }
  Object.defineProperty(child, 'offsetParent', { value: null, configurable: true });
  return box;
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  document.body.innerHTML = '';
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const said = (m) => m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ');

describe('a scroll container replaced under a running instance', () => {
  it('is reported on the next collect', () => {
    const first = pane('a', 0);
    const m = createMotion({ respectReducedMotion: false, inertia: 0, scrollElement: '#pane' });
    m.init();
    expect(said(m), 'nothing wrong yet').toBe('');

    first.remove();
    pane('b', 0);
    m.collect();
    expect(said(m)).toContain('scrollElement this instance was given has left the document');
    m.destroy();
  });

  /**
   * The measurement that shows it is real rather than pedantic: scrolling the
   * old pane moves the element, and scrolling the new one does not.
   */
  it('and the new container genuinely drives nothing', () => {
    const first = pane('a', 0);
    const m = createMotion({ respectReducedMotion: false, inertia: 0, scrollElement: '#pane' });
    m.init();
    expect(document.getElementById('a').style.filter).toBe('opacity(0)');
    Object.defineProperty(first, 'scrollTop', { value: 800, configurable: true });
    first.dispatchEvent(new Event('scroll'));
    expect(document.getElementById('a').style.filter, 'the original drives it').toBe('opacity(0.5)');

    first.remove();
    const second = pane('b', 0);
    m.collect();
    Object.defineProperty(second, 'scrollTop', { value: 0, configurable: true });
    const before = document.getElementById('b').style.filter;
    Object.defineProperty(second, 'scrollTop', { value: 800, configurable: true });
    second.dispatchEvent(new Event('scroll'));
    expect(document.getElementById('b').style.filter, 'the replacement drives nothing').toBe(before);
    m.destroy();
  });

  it('and says nothing while the container is still there', () => {
    pane('a', 0);
    const m = createMotion({ respectReducedMotion: false, inertia: 0, scrollElement: '#pane' });
    m.init();
    m.collect();
    expect(said(m)).toBe('');
    m.destroy();
  });

  /** The window is never disconnected, and the default must stay quiet. */
  it('and says nothing for a window-scrolled instance', () => {
    document.body.innerHTML = `<div ${P} ${P}-opacity="0% 0, 100% 1"></div>`;
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    m.collect();
    expect(said(m)).toBe('');
    m.destroy();
  });
});
