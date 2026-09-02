import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

/** Deterministic frames, so tweens can be stepped rather than waited on. */
let queue, nextHandle, now;

const flush = (frames = 200) => {
  for (let i = 0; i < frames && queue.length; i++) {
    const batch = queue;
    queue = [];
    now += 16.7;
    batch.forEach(([, fn]) => fn(now));
  }
};

beforeEach(() => {
  queue = []; nextHandle = 0; now = 0;
  vi.stubGlobal('requestAnimationFrame', (fn) => { const h = ++nextHandle; queue.push([h, fn]); return h; });
  vi.stubGlobal('cancelAnimationFrame', (h) => { queue = queue.filter(([q]) => q !== h); });
  vi.stubGlobal('scrollTo', vi.fn((x, y) => { Object.defineProperty(window, 'scrollY', { value: y, configurable: true }); }));
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  /**
   * A scrollable document, because happy-dom reports 0 for both dimensions and
   * `toPosition` clamps to what the container can reach — so without this every
   * destination in the file clamps to 0 and each test passes or fails for
   * reasons unrelated to what it is testing. `scrollTo-contract.test.js` has
   * carried the same lines, and the same comment, since `destinationFor`
   * started clamping; this file only needed it once `toPosition` did too.
   */
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  document.body.innerHTML = '';
});

afterEach(() => vi.unstubAllGlobals());

/** happy-dom has no layout, so targets get stubbed offsets. */
const page = (ids = ['one', 'two', 'three']) => {
  document.body.innerHTML = `
    <nav>${ids.map((id) => `<a href="#${id}">${id}</a>`).join('')}</nav>
    ${ids.map((id) => `<section id="${id}"></section>`).join('')}`;
  ids.forEach((id, i) => {
    const el = document.getElementById(id);
    Object.defineProperty(el, 'offsetTop', { value: 1000 * (i + 1), configurable: true });
    Object.defineProperty(el, 'offsetHeight', { value: 800, configurable: true });
    Object.defineProperty(el, 'offsetParent', { value: null, configurable: true });
  });
};

describe('collect', () => {
  it('links anchors to their targets', () => {
    page();
    const s = createScrollTo();
    s.init();
    expect(document.querySelectorAll('[data-vm-scroll-target]')).toHaveLength(3);
    s.destroy();
  });

  it('ignores anchors whose target does not exist', () => {
    document.body.innerHTML = '<nav><a href="#nope">x</a></nav>';
    const s = createScrollTo();
    s.init();
    expect(document.querySelectorAll('[data-vm-scroll-target]')).toHaveLength(0);
    s.destroy();
  });

  it.each(['#', '', 'https://example.com/page'])('ignores the href %j', (href) => {
    document.body.innerHTML = `<nav><a href="${href}">x</a></nav><section id="one"></section>`;
    const s = createScrollTo();
    s.init();
    expect(document.querySelectorAll('[data-vm-scroll-target]')).toHaveLength(0);
    s.destroy();
  });

  it('handles two links pointing at the same target', () => {
    document.body.innerHTML = '<nav><a href="#one">a</a><a href="#one">b</a></nav><section id="one"></section>';
    const s = createScrollTo();
    s.init();
    expect(document.querySelectorAll('[data-vm-scroll-target]')).toHaveLength(1);
    s.destroy();
  });
});

describe('toPosition', () => {
  it('tweens to the destination and lands exactly on it', () => {
    page();
    const s = createScrollTo();
    const done = vi.fn();
    s.toPosition(500, { onComplete: done });
    flush();
    expect(window.scrollY).toBe(500);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('completes immediately when already there, queueing no frame', () => {
    page();
    const s = createScrollTo();
    const done = vi.fn();
    s.toPosition(0, { onComplete: done });
    expect(done).toHaveBeenCalledTimes(1);
    expect(queue).toHaveLength(0);
  });

  it('jumps without tweening at zero duration', () => {
    page();
    const s = createScrollTo();
    s.toPosition(700, { duration: 0 });
    expect(window.scrollY).toBe(700);
    expect(queue).toHaveLength(0);
  });

  it('falls back to a known easing rather than throwing on an unknown one', () => {
    page();
    const s = createScrollTo();
    expect(() => { s.toPosition(400, { easing: 'notAnEasing' }); flush(); }).not.toThrow();
    expect(window.scrollY).toBe(400);
  });

  it('cancel stops the tween where it stands', () => {
    page();
    const s = createScrollTo();
    s.toPosition(1000);
    flush(3);
    const midway = window.scrollY;
    s.cancel();
    flush();
    expect(window.scrollY).toBe(midway);
    expect(midway).toBeLessThan(1000);
  });

  it('a second request replaces the first rather than fighting it', () => {
    page();
    const s = createScrollTo();
    s.toPosition(1000);
    flush(3);
    s.toPosition(200);
    flush();
    expect(window.scrollY).toBe(200);
  });

  it('jumps instantly when the visitor prefers reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
    page();
    const s = createScrollTo();
    s.toPosition(600);
    expect(window.scrollY).toBe(600);
    expect(queue).toHaveLength(0);
  });
});

describe('active link tracking', () => {
  it('marks the section across the threshold', () => {
    page();
    const s = createScrollTo();
    s.init();
    Object.defineProperty(window, 'scrollY', { value: 900, configurable: true });
    s.refresh();
    const active = [...document.querySelectorAll('nav a')].filter((a) => a.classList.contains('active'));
    expect(active).toHaveLength(1);
    s.destroy();
  });

  /** The same shape as a bug fixed in the animation runtime — checked here too. */
  it('restores the active class after a disable/enable cycle', () => {
    page();
    const s = createScrollTo();
    s.init();
    Object.defineProperty(window, 'scrollY', { value: 900, configurable: true });
    s.refresh();
    expect(document.querySelectorAll('nav a.active')).toHaveLength(1);

    s.disable();
    expect(document.querySelectorAll('nav a.active')).toHaveLength(0);
    s.enable();
    expect(document.querySelectorAll('nav a.active')).toHaveLength(1);
    s.destroy();
  });

  it('marks at most one link at a time', () => {
    page();
    const s = createScrollTo();
    s.init();
    for (const y of [0, 900, 1900, 2900]) {
      Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
      s.refresh();
      expect([...document.querySelectorAll('nav a.active')].length).toBeLessThanOrEqual(1);
    }
    s.destroy();
  });
});

describe('the enable/disable toggle', () => {
  it('starts enabled', () => {
    page();
    const s = createScrollTo();
    s.init();
    expect(s.enabled).toBe(true);
    s.destroy();
  });

  it('disable clears the active class and stops tracking', () => {
    page();
    const s = createScrollTo();
    s.init();
    Object.defineProperty(window, 'scrollY', { value: 900, configurable: true });
    s.refresh();
    expect(document.querySelectorAll('nav a.active').length).toBe(1);

    s.disable();
    expect(s.enabled).toBe(false);
    expect(document.querySelectorAll('nav a.active').length).toBe(0);
    s.destroy();
  });

  it('setEnabled drives both directions', () => {
    page();
    const s = createScrollTo();
    s.init();
    s.setEnabled(false);
    expect(s.enabled).toBe(false);
    s.setEnabled(true);
    expect(s.enabled).toBe(true);
    s.destroy();
  });
});

describe('a malformed selector option', () => {
  /**
   * A developer typo, not untrusted input — but throwing mid-init() abandons
   * the instance half-wired, which is a worse failure than a clear warning.
   */
  it('warns and finds nothing instead of throwing', () => {
    page();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = createScrollTo({ selector: 'a[href' });
    expect(() => s.init()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(document.querySelectorAll('[data-vm-scroll-target]')).toHaveLength(0);
    s.destroy();
    warn.mockRestore();
  });

  it('stays destroyable afterwards', () => {
    page();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = createScrollTo({ selector: '::::' });
    s.init();
    expect(() => s.destroy()).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe('lifecycle', () => {
  it('init twice does not double the listeners', () => {
    page();
    const spy = vi.spyOn(document, 'addEventListener');
    const s = createScrollTo();
    s.init();
    const after = spy.mock.calls.length;
    s.init();
    expect(spy.mock.calls.length).toBe(after);
    s.destroy();
    spy.mockRestore();
  });

  it('destroy removes classes, attributes and listeners', () => {
    page();
    const s = createScrollTo();
    s.init();
    Object.defineProperty(window, 'scrollY', { value: 900, configurable: true });
    s.refresh();

    s.destroy();
    expect(document.querySelectorAll('nav a.active')).toHaveLength(0);
    expect(document.querySelectorAll('[data-vm-scroll-target]')).toHaveLength(0);
  });

  it('cancels an in-flight tween on destroy', () => {
    page();
    const s = createScrollTo();
    s.init();
    s.toPosition(1000);
    flush(2);
    const midway = window.scrollY;
    s.destroy();
    flush();
    expect(window.scrollY).toBe(midway);
  });
});

/** The two shadow-DOM bugs this module had before the audit. */
describe('shadow DOM', () => {
  const shadowPage = () => {
    document.body.innerHTML = '<my-nav></my-nav>';
    const root = document.querySelector('my-nav').attachShadow({ mode: 'open' });
    root.innerHTML = `<nav><a href="#deep">deep</a></nav><section id="deep"></section>`;
    const target = root.getElementById('deep');
    Object.defineProperty(target, 'offsetTop', { value: 1200, configurable: true });
    Object.defineProperty(target, 'offsetHeight', { value: 600, configurable: true });
    Object.defineProperty(target, 'offsetParent', { value: null, configurable: true });
    return root;
  };

  it('resolves targets inside its own root, not just the document', () => {
    const root = shadowPage();
    const s = createScrollTo({ root });
    s.init();
    expect(root.querySelectorAll('[data-vm-scroll-target]')).toHaveLength(1);
    s.destroy();
  });

  it('finds nothing when scoped to the document, since ids in a shadow root are private', () => {
    shadowPage();
    const s = createScrollTo();
    s.init();
    expect(document.querySelectorAll('[data-vm-scroll-target]')).toHaveLength(0);
    s.destroy();
  });

  it('tracks the active link inside a shadow root', () => {
    const root = shadowPage();
    const s = createScrollTo({ root });
    s.init();
    Object.defineProperty(window, 'scrollY', { value: 1100, configurable: true });
    s.refresh();
    expect(root.querySelector('a').classList.contains('active')).toBe(true);
    s.destroy();
  });
});

/** Preventing default also prevents the focus move that comes with it. */
describe('focus management', () => {
  it('focuses the target after arriving', () => {
    page();
    const s = createScrollTo();
    s.init();
    document.querySelector('nav a').click();
    flush();
    expect(document.activeElement?.id).toBe('one');
    s.destroy();
  });

  it('does not leave a tabindex behind on the page', () => {
    page();
    const s = createScrollTo();
    s.init();
    const target = document.getElementById('one');
    document.querySelector('nav a').click();
    flush();
    target.dispatchEvent(new Event('blur'));
    expect(target.hasAttribute('tabindex')).toBe(false);
    s.destroy();
  });

  /**
   * `tabIndex` is 0 on anything natively focusable and -1 on a section, in
   * happy-dom and in all three engines (`spikes/anchor-focus.mjs`). The
   * attribute used to go on regardless, so scrolling to a `<button>` rewrote
   * an element that was already focusable and then took it off again.
   */
  it('injects no tabindex on a target that is already focusable', () => {
    page();
    const target = document.getElementById('one');
    const button = document.createElement('button');
    button.id = 'btn';
    target.replaceWith(button);
    Object.defineProperty(button, 'offsetTop', { value: 1000, configurable: true });
    Object.defineProperty(button, 'offsetHeight', { value: 600, configurable: true });
    Object.defineProperty(button, 'offsetParent', { value: null, configurable: true });
    document.querySelector('nav a').setAttribute('href', '#btn');

    const s = createScrollTo();
    s.init();
    document.querySelector('nav a').click();
    flush();

    expect(document.activeElement?.id).toBe('btn');
    expect(button.hasAttribute('tabindex')).toBe(false);
    s.destroy();
  });

  it('leaves an author-supplied tabindex alone', () => {
    page();
    const target = document.getElementById('one');
    target.setAttribute('tabindex', '0');
    const s = createScrollTo();
    s.init();
    document.querySelector('nav a').click();
    flush();
    target.dispatchEvent(new Event('blur'));
    expect(target.getAttribute('tabindex')).toBe('0');
    s.destroy();
  });

  it('can be turned off', () => {
    page();
    const s = createScrollTo({ manageFocus: false });
    s.init();
    document.querySelector('nav a').click();
    flush();
    expect(document.activeElement?.id).not.toBe('one');
    s.destroy();
  });
});


describe('scroll-to teardown', () => {
  /**
   * `focusTarget` injects `tabindex="-1"` on a section that has none, and used
   * to rely on a `blur` to take it off again. An element focused and never
   * blurred kept the attribute *and* the listener for good, so `destroy()`
   * left the page modified — CLAUDE.md counts an injected attribute as
   * something that needs a matching teardown.
   */
  it('destroy() removes a tabindex it injected', () => {
    page(['one']);
    const s = createScrollTo({ respectReducedMotion: false, duration: 0 });
    s.init();
    document.querySelector('a[href="#one"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    flush();
    flush();

    const target = document.getElementById('one');
    expect(target.getAttribute('tabindex'), 'focus should inject one').toBe('-1');
    s.destroy();
    expect(target.hasAttribute('tabindex'), 'destroy should take it back off').toBe(false);
  });
});
