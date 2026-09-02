/**
 * Every listener this module adds, it takes away again.
 *
 * CLAUDE.md counts a listener as something needing a matching teardown, and
 * `destroy()` pushes each removal onto a `teardown` list as it wires. That is
 * the right shape, and nothing checked the arithmetic: a listener added outside
 * the pattern, or a `teardown` entry that closes over the wrong reference,
 * leaves the page holding a handler for an instance that is gone. Counting the
 * calls is the only way to see it — a leaked listener does nothing observable
 * until the thing it points at matters.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

const place = (node, top) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 600, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

/** Counts add/remove on one target and restores it afterwards. */
const tally = (target) => {
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  const counts = { added: 0, removed: 0 };
  target.addEventListener = (...args) => { counts.added++; return add(...args); };
  target.removeEventListener = (...args) => { counts.removed++; return remove(...args); };
  return {
    counts,
    restore: () => { target.addEventListener = add; target.removeEventListener = remove; },
  };
};

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  document.body.innerHTML = '<nav><a href="#one">one</a></nav><section id="one"></section>';
  place(document.getElementById('one'), 1000);
});
afterEach(() => vi.unstubAllGlobals());

describe('destroy', () => {
  it('removes exactly what init added, on document and on window', () => {
    const doc = tally(document);
    const win = tally(window);

    const s = createScrollTo();
    s.init();
    s.destroy();

    doc.restore();
    win.restore();

    expect(doc.counts.removed, 'document').toBe(doc.counts.added);
    expect(win.counts.removed, 'window').toBe(win.counts.added);
    expect(doc.counts.added).toBeGreaterThan(0);
    expect(win.counts.added).toBeGreaterThan(0);
  });

  it('stays balanced across repeated cycles', () => {
    const doc = tally(document);
    const win = tally(window);

    for (let i = 0; i < 3; i++) {
      const s = createScrollTo();
      s.init();
      s.destroy();
    }

    doc.restore();
    win.restore();
    expect(doc.counts.removed).toBe(doc.counts.added);
    expect(win.counts.removed).toBe(win.counts.added);
  });

  /** `init()` guards against doubling, so a second one must add nothing. */
  it('is not confused by an init that was already started', () => {
    const win = tally(window);
    const s = createScrollTo();
    s.init();
    const afterFirst = win.counts.added;
    s.init();
    expect(win.counts.added, 'a second init adds nothing').toBe(afterFirst);
    s.destroy();
    win.restore();
    expect(win.counts.removed).toBe(win.counts.added);
  });
});

describe('an instance scoped entirely to a shadow root', () => {
  const build = () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<nav><a id="sa" href="#sone">s</a></nav><section id="sone"></section>';
    place(shadow.getElementById('sone'), 900);
    return shadow;
  };

  it('finds its own links and targets', () => {
    const shadow = build();
    const s = createScrollTo({ root: shadow });
    s.init();
    expect(s.rejected).toEqual([]);
    s.destroy();
  });

  it('marks its own active link', () => {
    const shadow = build();
    const s = createScrollTo({ root: shadow, activeClass: 'here', activeThreshold: 0.5 });
    s.init();
    Object.defineProperty(window, 'scrollY', { value: 950, configurable: true });
    s.update();
    expect(shadow.getElementById('sa').classList.contains('here')).toBe(true);
    s.destroy();
  });

  /** The click listener is on `document`, and a composed event reaches it. */
  it('handles a click that crossed the shadow boundary', () => {
    const shadow = build();
    const writes = [];
    const native = window.scrollTo;
    window.scrollTo = (x, y) => writes.push(y);

    const s = createScrollTo({ root: shadow, duration: 0 });
    s.init();
    shadow.getElementById('sa')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));

    window.scrollTo = native;
    expect(writes).toEqual([900]);
    s.destroy();
  });
});
