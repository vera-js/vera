import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/scroll-to.ts';

/**
 * Sections nest. A `<section id="features">` holding an `<h3 id="pricing">`,
 * both anchor targets, is ordinary — and then more than one target contains
 * the threshold at once.
 *
 * The active link was the **last match in nav order**, so the answer depended
 * on the order the links happen to be written in: the same page at the same
 * scroll position marked `#outer` when the nav listed inner first, and
 * `#inner` when it listed outer first. The bottomed-out rule beside it already
 * refuses to depend on nav order and says why.
 */
const size = (node, top, height) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

const scrollTo = (y) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true });

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 4000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 700, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

/** `#outer` spans 500–1500 and contains `#inner`, 900–1100. */
const build = (nav) => {
  document.body.innerHTML = `<nav>${nav}</nav><section id="outer"><div id="inner"></div></section>`;
  size(document.getElementById('outer'), 500, 1000);
  size(document.getElementById('inner'), 900, 200);
  const s = createScrollTo({ duration: 0, activeThreshold: 0.5 });
  s.init();
  return s;
};
const INNER_FIRST = '<a id="li" href="#inner">inner</a><a id="lo" href="#outer">outer</a>';
const OUTER_FIRST = '<a id="lo" href="#outer">outer</a><a id="li" href="#inner">inner</a>';

const active = () =>
  [...document.querySelectorAll('a')].filter((a) => a.classList.contains('active')).map((a) => a.id);

describe('a target nested inside another', () => {
  it('marks the same link whichever order the nav lists them in', () => {
    for (const nav of [INNER_FIRST, OUTER_FIRST]) {
      const s = build(nav);
      /** Threshold 900: inside `#outer` alone. */
      scrollTo(500); s.update();
      expect(active()).toEqual(['lo']);
      /** Threshold 950: inside both, and `#inner` is the more specific. */
      scrollTo(600); s.update();
      expect(active()).toEqual(['li']);
      s.destroy();
    }
  });

  /** Nothing changes for a page whose sections do not overlap. */
  it('leaves ordinary sections alone', () => {
    document.body.innerHTML =
      '<nav><a id="l1" href="#one">1</a><a id="l2" href="#two">2</a></nav>' +
      '<div id="one"></div><div id="two"></div>';
    size(document.getElementById('one'), 0, 1000);
    size(document.getElementById('two'), 1000, 1000);
    const s = createScrollTo({ duration: 0, activeThreshold: 0.5 });
    s.init();
    scrollTo(0); s.update();
    expect(active()).toEqual(['l1']);
    scrollTo(800); s.update();
    expect(active()).toEqual(['l2']);
    s.destroy();
  });

  /** And the bottomed-out rule still wins where it applies. */
  it('still marks the last section at the very bottom', () => {
    const s = build(INNER_FIRST);
    scrollTo(3300);
    s.update();
    expect(active()).toHaveLength(1);
    s.destroy();
  });
});
