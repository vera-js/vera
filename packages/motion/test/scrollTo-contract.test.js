import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

let queue, handle, now, scrolled;
const flush = (frames = 400) => {
  for (let i = 0; i < frames && queue.length; i++) {
    const batch = queue; queue = []; now += 16.7;
    batch.forEach(([, fn]) => fn(now));
  }
};
const place = (n, top) => {
  Object.defineProperty(n, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 600, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => {
  queue = []; handle = 0; now = 0; scrolled = [];
  vi.stubGlobal('requestAnimationFrame', (fn) => { const h = ++handle; queue.push([h, fn]); return h; });
  vi.stubGlobal('cancelAnimationFrame', (h) => { queue = queue.filter(([q]) => q !== h); });
  vi.stubGlobal('scrollTo', vi.fn((x, y) => {
    scrolled.push(y);
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  }));
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  /**
   * happy-dom reports 0 for both, so `maxScroll` is 0 and `destinationFor`
   * clamps every destination to 0 — which makes `change === 0` and short-
   * circuits the tween. Without this the whole file passes or fails for
   * reasons that have nothing to do with the options being tested.
   */
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  document.body.innerHTML =
    '<nav><a id="l1" href="#s1">one</a><a id="l2" href="#s2">two</a></nav>' +
    '<section id="s1"></section><section id="s2"></section>';
  place(document.getElementById('s1'), 1000);
  place(document.getElementById('s2'), 2000);
});
afterEach(() => vi.unstubAllGlobals());

const click = (id) => document.getElementById(id)
  .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('scroll-to option and method contract', () => {
  it('selector — only matching links become triggers', () => {
    const s = createScrollTo({ selector: '#l2' });
    s.init();
    click('l1');
    flush();
    expect(scrolled).toHaveLength(0);
    click('l2');
    flush();
    expect(scrolled.length).toBeGreaterThan(0);
    s.destroy();
  });

  it('offset — stops that many pixels short', () => {
    const s = createScrollTo({ offset: 120, duration: 10 });
    s.init();
    click('l1');
    flush();
    expect(scrolled.at(-1)).toBe(1000 - 120);
    s.destroy();
  });

  it('duration — 0 jumps immediately', () => {
    const s = createScrollTo({ duration: 0 });
    s.init();
    click('l1');
    expect(scrolled.at(-1)).toBe(1000);
    s.destroy();
  });

  it('easing — an unknown name falls back rather than throwing', () => {
    const s = createScrollTo({ easing: 'nonsense', duration: 10 });
    s.init();
    click('l1');
    flush();
    expect(scrolled.at(-1)).toBe(1000);
    s.destroy();
  });

  it('activeClass and activeThreshold — mark the section in view', () => {
    const s = createScrollTo({ activeClass: 'here', activeThreshold: 0.1 });
    s.init();
    Object.defineProperty(window, 'scrollY', { value: 1050, configurable: true });
    s.update();
    expect(document.getElementById('l1').classList.contains('here')).toBe(true);
    expect(document.getElementById('l2').classList.contains('here')).toBe(false);
    s.destroy();
  });

  it('updateHash — off by default, replaces the hash when on', () => {
    const replace = vi.spyOn(history, 'replaceState').mockImplementation(() => {});
    const off = createScrollTo({ duration: 0 });
    off.init();
    click('l1');
    expect(replace).not.toHaveBeenCalled();
    off.destroy();

    const on = createScrollTo({ duration: 0, updateHash: true });
    on.init();
    click('l1');
    expect(replace).toHaveBeenCalledWith(null, '', '#s1');
    on.destroy();
    replace.mockRestore();
  });

  /**
   * `replaceState` and never `pushState`, which is the documented contract and
   * the obvious "fix" for the thing it trades away: Back does not return to
   * the previous section, because the click is intercepted and the native
   * history entry an anchor would have made never happens. A nav with eight
   * links making eight history entries is the worse of the two, and turning
   * this into `pushState` is a one-word edit nothing else would notice.
   */
  it('and never pushes, so a nav cannot fill the back stack', () => {
    const replace = vi.spyOn(history, 'replaceState').mockImplementation(() => {});
    const push = vi.spyOn(history, 'pushState').mockImplementation(() => {});
    const s = createScrollTo({ duration: 0, updateHash: true });
    s.init();
    click('l1');
    click('l2');
    click('l1');
    expect(replace).toHaveBeenCalledTimes(3);
    expect(push).not.toHaveBeenCalled();
    s.destroy();
    replace.mockRestore();
    push.mockRestore();
  });

  it('cancelOnUserInput — a wheel event aborts an in-flight tween', () => {
    const s = createScrollTo({ duration: 1000 });
    s.init();
    click('l1');
    flush(2);
    const midway = scrolled.length;
    window.dispatchEvent(new Event('wheel'));
    flush();
    expect(scrolled.length).toBe(midway);
    s.destroy();
  });

  /**
   * And given as `undefined`, which is *not given* rather than off.
   *
   * A spread would let an explicit `undefined` win, and this option defaults to
   * `true`, so it came out off — no cancel listeners at all, and a tween that
   * ran to completion through a visitor's wheel. `{ cancelOnUserInput:
   * config.cancel }` with the key absent is how generated code is written.
   *
   * Asserted through the **behaviour**, not through `rejected`. The first
   * version of this test checked that nothing was reported, which is true
   * whether the option survives or not — so it passed against the defect and
   * the mutation runner said so (`scrollto: an option given as undefined
   * overrides its default`, SURVIVED).
   */
  it('and still cancels when the option is given as undefined', () => {
    const s = createScrollTo({ duration: 1000, cancelOnUserInput: undefined });
    s.init();
    click('l1');
    flush(2);
    const midway = scrolled.length;
    expect(midway, 'the tween has to be in flight for this to mean anything').toBeGreaterThan(0);
    window.dispatchEvent(new Event('wheel'));
    flush();
    expect(scrolled.length).toBe(midway);
    s.destroy();
  });

  /**
   * What an interrupted tween leaves behind, pinned because it was never a
   * decision anyone made — it is what falls out of `cancel()` being three
   * lines, and it could invert without a single test going red.
   *
   * Both the hash update and the focus move live in `onComplete`, which runs
   * only on arrival. So a cancelled tween updates neither, and the click's
   * `preventDefault` has already suppressed the browser's own versions of both.
   * That is the right answer on both counts and worth saying out loud: focus
   * stays on the link the visitor clicked rather than being thrown at a section
   * they scrolled away from, and the address bar does not claim an anchor the
   * page never reached.
   */
  it('an interrupted tween moves neither focus nor the hash', () => {
    const replace = vi.spyOn(history, 'replaceState').mockImplementation(() => {});
    const s = createScrollTo({ duration: 1000, updateHash: true });
    s.init();
    document.getElementById('l1').focus();
    click('l1');
    flush(2);
    window.dispatchEvent(new Event('wheel'));
    flush();

    expect(document.activeElement?.id, 'focus stays on the link').toBe('l1');
    expect(document.getElementById('s1').hasAttribute('tabindex')).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    s.destroy();
    replace.mockRestore();
  });

  /** The same click, allowed to finish, does both — so the test above is about the interruption. */
  it('and an uninterrupted one moves both', () => {
    const replace = vi.spyOn(history, 'replaceState').mockImplementation(() => {});
    const s = createScrollTo({ duration: 1000, updateHash: true });
    s.init();
    document.getElementById('l1').focus();
    click('l1');
    flush();

    expect(document.activeElement?.id).toBe('s1');
    expect(replace).toHaveBeenCalledWith(null, '', '#s1');
    s.destroy();
    replace.mockRestore();
  });

  /**
   * A short final section is unreachable by the threshold, which sits
   * `activeThreshold` of a viewport down: at the end of the scroll range it
   * stops that far short of the document's end. Measured in a browser before
   * fixing — a 200px section at the foot of a 3,960px page in a 700px viewport
   * left the *third* link marked at every position including the very bottom,
   * so the fourth never lit up once (`spikes/active-link.mjs`).
   */
  it('marks the last section once the page is scrolled to the end', () => {
    /**
     * The geometry has to make the section genuinely **unreachable**, which the
     * first version of this test did not: it put the start exactly on the
     * threshold, so the ordinary rule matched and the test passed with the fix
     * removed. Content 6000, viewport 800, so the furthest scroll is 5200 and
     * the threshold tops out at 5200 + 400 = 5600. A section starting at 5700
     * can never contain it.
     */
    place(document.getElementById('s2'), 5700);
    Object.defineProperty(document.getElementById('s2'), 'offsetHeight', { value: 200, configurable: true });
    const s = createScrollTo({ activeClass: 'here', activeThreshold: 0.5 });
    s.init();

    Object.defineProperty(window, 'scrollY', { value: 5200, configurable: true });
    s.update();

    expect(document.getElementById('l2').classList.contains('here')).toBe(true);
    expect(document.getElementById('l1').classList.contains('here')).toBe(false);
    s.destroy();
  });

  /**
   * Nav order is not document order, and the last section means the last one
   * down the page. With the two agreeing, picking either gives the same answer
   * and the choice is untested — so here the nav lists them backwards.
   */
  it('picks the last section by position, not by where the nav lists it', () => {
    document.body.innerHTML =
      '<nav><a id="l2" href="#s2">two</a><a id="l1" href="#s1">one</a></nav>' +
      '<section id="s1"></section><section id="s2"></section>';
    place(document.getElementById('s1'), 1000);
    place(document.getElementById('s2'), 5700);
    Object.defineProperty(document.getElementById('s2'), 'offsetHeight', { value: 200, configurable: true });

    const s = createScrollTo({ activeClass: 'here', activeThreshold: 0.5 });
    s.init();
    Object.defineProperty(window, 'scrollY', { value: 5200, configurable: true });
    s.update();

    expect(document.getElementById('l2').classList.contains('here')).toBe(true);
    expect(document.getElementById('l1').classList.contains('here')).toBe(false);
    s.destroy();
  });

  /** And the override applies only at the end — mid-page the threshold still decides. */
  it('does not mark the last section before the end', () => {
    const s = createScrollTo({ activeClass: 'here', activeThreshold: 0.5 });
    s.init();
    Object.defineProperty(window, 'scrollY', { value: 1050, configurable: true });
    s.update();
    expect(document.getElementById('l1').classList.contains('here')).toBe(true);
    expect(document.getElementById('l2').classList.contains('here')).toBe(false);
    s.destroy();
  });

  it('manageFocus — off means the target is never focused', () => {
    const target = document.getElementById('s1');
    target.focus = vi.fn();
    const s = createScrollTo({ duration: 0, manageFocus: false });
    s.init();
    click('l1');
    expect(target.focus).not.toHaveBeenCalled();
    expect(target.hasAttribute('tabindex')).toBe(false);
    s.destroy();
  });

  it('toPosition / toElement / cancel — the imperative surface', () => {
    const s = createScrollTo({ duration: 10 });
    s.init();
    s.toPosition(750);
    flush();
    expect(scrolled.at(-1)).toBe(750);

    s.toElement(document.getElementById('s2'));
    flush();
    expect(scrolled.at(-1)).toBe(2000);

    s.toPosition(0, { duration: 1000 });
    flush(2);
    const before = scrolled.length;
    s.cancel();
    flush();
    expect(scrolled.length).toBe(before);
    s.destroy();
  });

  it('onComplete — fires once the tween arrives', () => {
    const done = vi.fn();
    const s = createScrollTo({ duration: 10 });
    s.init();
    s.toPosition(500, { onComplete: done });
    flush();
    expect(done).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it('setEnabled / disable — a disabled instance ignores clicks', () => {
    const s = createScrollTo({ duration: 0 });
    s.init();
    s.setEnabled(false);
    click('l1');
    expect(scrolled).toHaveLength(0);
    s.setEnabled(true);
    click('l1');
    expect(scrolled.at(-1)).toBe(1000);
    s.destroy();
  });

  /**
   * The runtime has always accepted a selector here; scroll-to accepted only a
   * node, so the same option meant different things in one package.
   */
  it('scrollElement — accepts a CSS selector, like the runtime does', () => {
    document.body.innerHTML =
      '<div id="pane"><nav><a id="l1" href="#s1">one</a></nav><section id="s1"></section></div>';
    const pane = document.getElementById('pane');
    Object.defineProperty(pane, 'offsetTop', { value: 0, configurable: true });
    Object.defineProperty(pane, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(pane, 'scrollHeight', { value: 4000, configurable: true });
    place(document.getElementById('s1'), 900);
    pane.scrollTop = 0;

    const s = createScrollTo({ scrollElement: '#pane', duration: 0 });
    s.init();
    click('l1');
    expect(pane.scrollTop).toBe(900);
    s.destroy();
  });

  it('scrollElement — a selector matching nothing warns and falls back to the window', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = createScrollTo({ scrollElement: '#nope', duration: 0 });
    s.init();
    click('l1');
    expect(warn).toHaveBeenCalled();
    expect(scrolled.at(-1)).toBe(1000);
    s.destroy();
    warn.mockRestore();
  });

  /**
   * The runtime has had `rejected` since the attribute audit; scroll-to had
   * nothing, so a nav pointing at an id that does not exist was silently inert
   * and the only clue was a link that did not scroll.
   */
  it('rejected — reports a link whose target does not exist', () => {
    document.body.innerHTML =
      '<nav><a id="l1" href="#s1">ok</a><a id="l3" href="#nope">broken</a></nav><section id="s1"></section>';
    place(document.getElementById('s1'), 1000);
    const s = createScrollTo();
    s.init();
    expect(s.rejected).toHaveLength(1);
    expect(s.rejected[0].node).toBe(document.getElementById('l3'));
    expect(s.rejected[0].reason).toContain('nope');
    s.destroy();
  });

  it('rejected — reports an invalid selector, with no node', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = createScrollTo({ selector: 'a[href=' });
    s.init();
    expect(s.rejected).toHaveLength(1);
    expect(s.rejected[0].node).toBeNull();
    expect(s.rejected[0].reason).toContain('not valid CSS');
    s.destroy();
    warn.mockRestore();
  });

  it('rejected — empty when every link resolves', () => {
    const s = createScrollTo();
    s.init();
    expect(s.rejected).toEqual([]);
    s.destroy();
  });

  it('destroy — removes the target markers it injected', () => {
    const s = createScrollTo();
    s.init();
    expect(document.querySelectorAll('[data-vm-scroll-target]').length).toBe(2);
    s.destroy();
    expect(document.querySelectorAll('[data-vm-scroll-target]').length).toBe(0);
  });
});
