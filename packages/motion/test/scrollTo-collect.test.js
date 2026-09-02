/**
 * `collect()` — re-scanning after the page changes.
 *
 * Documented as "call after the page adds or removes some", which is the GUI's
 * normal mode: markup is rewritten constantly and this is the recovery hook.
 * Two things it did not do.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

const ATTR = 'data-vera-motion-scroll-target';

const place = (node, top) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 600, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('a target that stops being one', () => {
  const twoLinks = () => {
    document.body.innerHTML =
      '<nav><a id="l1" href="#one">one</a><a id="l2" href="#two">two</a></nav>' +
      '<section id="one"></section><section id="two"></section>';
    place(document.getElementById('one'), 0);
    place(document.getElementById('two'), 1000);
  };

  /**
   * The marker is an outward contract — a page can style
   * `[data-vera-motion-scroll-target]` — so leaving it on an element that is no
   * longer a target styles the wrong thing. CLAUDE.md counts an injected
   * attribute as something needing a matching teardown.
   */
  it('loses the marker attribute when re-collected', () => {
    twoLinks();
    const s = createScrollTo();
    s.init();
    expect(document.getElementById('two').hasAttribute(ATTR)).toBe(true);

    document.getElementById('l2').remove();
    s.collect();

    expect(document.getElementById('two').hasAttribute(ATTR)).toBe(false);
    expect(document.getElementById('one').hasAttribute(ATTR)).toBe(true);
    s.destroy();
  });

  /**
   * `destroy()` iterates the *current* target list, so a marker stranded by an
   * earlier `collect()` outlived the instance entirely — there was no call that
   * would ever remove it.
   */
  it('and destroy() leaves nothing behind either way', () => {
    twoLinks();
    const s = createScrollTo();
    s.init();
    document.getElementById('l2').remove();
    s.collect();
    s.destroy();

    expect(document.querySelectorAll(`[${ATTR}]`)).toHaveLength(0);
  });

  it('drops the active class from a link it no longer tracks', () => {
    twoLinks();
    const s = createScrollTo({ activeClass: 'here', activeThreshold: 0.5 });
    s.init();
    Object.defineProperty(window, 'scrollY', { value: 1050, configurable: true });
    s.update();
    expect(document.getElementById('l2').classList.contains('here')).toBe(true);

    /** Still in the DOM, but no longer matched by the selector. */
    document.getElementById('l2').removeAttribute('href');
    s.collect();

    expect(document.getElementById('l2').classList.contains('here')).toBe(false);
    s.destroy();
  });
});

describe('a link added after init', () => {
  /**
   * `collect` rebuilds the lists with every `start` and `end` at zero, and
   * `refresh` is what fills them in. Rebuilding alone produced a half-working
   * link: it scrolled correctly, because a destination is measured live at
   * click time, and could never become active, because tracking compares a
   * threshold against those zeros. It only started working after the next
   * resize.
   */
  it('can become active straight away', () => {
    document.body.innerHTML =
      '<nav><a id="l1" href="#one">one</a></nav><section id="one"></section>';
    place(document.getElementById('one'), 0);
    const s = createScrollTo({ activeClass: 'here', activeThreshold: 0.5 });
    s.init();

    document.querySelector('nav').insertAdjacentHTML('beforeend', '<a id="l2" href="#two">two</a>');
    document.body.insertAdjacentHTML('beforeend', '<section id="two"></section>');
    place(document.getElementById('two'), 1000);

    s.collect();
    Object.defineProperty(window, 'scrollY', { value: 1050, configurable: true });
    s.update();

    expect(document.getElementById('l2').classList.contains('here')).toBe(true);
    s.destroy();
  });
});
