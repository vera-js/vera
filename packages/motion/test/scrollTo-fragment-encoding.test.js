/**
 * A percent-encoded anchor resolves the element the browser would resolve.
 *
 * `collect()` took the fragment straight off the href and handed it to
 * `getElementById`, so `#caf%C3%A9` never found `id="café"`: the link was
 * reported as pointing at nothing and left to navigate natively. Any heading
 * that is not plain ASCII is written percent-encoded by the CMS this library
 * exists to serve, which makes accented and CJK anchors the common case.
 *
 * Order is raw-then-decoded, measured in all three engines by
 * `spikes/anchor-encoding.mjs` rather than read off the spec.
 */
import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

const place = (node, top) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 600, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

const page = (html) => { document.body.innerHTML = html; };
const start = () => {
  const s = createScrollTo({ respectReducedMotion: false });
  s.init();
  return s;
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('fragment decoding', () => {
  it('resolves a percent-encoded fragment to the decoded id', () => {
    page('<a id="l" href="#caf%C3%A9">go</a><h2 id="café">café</h2>');
    const s = start();
    expect(s.rejected).toEqual([]);
    s.destroy();
  });

  it('resolves a percent-encoded CJK fragment', () => {
    page('<a id="l" href="#%E6%97%A5%E6%9C%AC">go</a><h2 id="日本">jp</h2>');
    const s = start();
    expect(s.rejected).toEqual([]);
    s.destroy();
  });

  /**
   * Raw wins. Both spellings exist, and every engine matches the fragment as
   * written before it tries decoding it — so decoding first would send this
   * link to the wrong element rather than merely failing to find one.
   */
  it('prefers the id spelled exactly as the fragment is', () => {
    page('<a id="l" href="#both%41">go</a><h2 id="both%41">raw</h2><h2 id="bothA">decoded</h2>');
    const s = start();
    expect(s.rejected).toEqual([]);
    expect(document.querySelector('[data-vm-scroll-target]')?.id).toBe('both%41');
    s.destroy();
  });

  /**
   * `decodeURIComponent('100%')` throws, and `id="100%"` is legal — so the
   * decode has to fall back rather than take the link out.
   */
  it('does not throw on a fragment that will not decode', () => {
    page('<a id="l" href="#100%">go</a><h2 id="100%">pc</h2>');
    const s = start();
    expect(s.rejected).toEqual([]);
    s.destroy();
  });

  /**
   * Two links, one anchor, two spellings — which is what a hand-written nav
   * beside a generated in-body link produces the moment a heading is not
   * ASCII. Storing the href's spelling rather than the element's makes them two
   * separate targets for one node, so only one of the pair is ever marked
   * current. Nothing else in the suite can see the difference: with one link
   * per anchor both spellings behave identically.
   */
  it('treats two spellings of one anchor as the same target', () => {
    Object.defineProperty(window, 'scrollY', { value: 1050, configurable: true });
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
    page(
      '<a id="raw" href="#caf%C3%A9">a</a><a id="lit" href="#café">b</a>' +
        '<h2 id="café">café</h2>'
    );
    place(document.getElementById('café'), 1000);
    const s = createScrollTo({ respectReducedMotion: false, activeClass: 'here', activeThreshold: 0.1 });
    s.init();
    s.update();
    expect(document.getElementById('raw').classList.contains('here')).toBe(true);
    expect(document.getElementById('lit').classList.contains('here')).toBe(true);
    s.destroy();
  });

  it('still reports a fragment that matches nothing either way', () => {
    page('<a id="l" href="#caf%C3%A9">go</a><h2 id="other">other</h2>');
    const s = start();
    expect(s.rejected.map((r) => r.reason)).toEqual(['no element with id "caf%C3%A9"']);
    s.destroy();
  });
});

/**
 * A fragment is not enough: the link must point at **this** document.
 *
 * The collector's whole test was a `#` in the href, so any link carrying a
 * fragment was adopted — `href="/pricing#faq"` on a page with `id="faq"`, or a
 * link to another site whose fragment happened to match a local id, were
 * intercepted and **never navigated**. The colliding ids are the common ones
 * (`contact`, `about`, `faq`, `pricing`), so this is ordinary markup rather
 * than a contrived case. The platform's rule for a same-document navigation is
 * the URL matching but for the fragment, and that is the comparison used.
 */
describe('only same-document anchors are intercepted', () => {
  const clickResult = (html, id) => {
    document.body.innerHTML = html;
    for (const node of document.querySelectorAll('div')) {
      for (const [key, value] of [
        ['offsetTop', 500], ['offsetHeight', 100], ['offsetWidth', 200], ['offsetParent', null],
      ]) Object.defineProperty(node, key, { value, configurable: true });
    }
    const s = createScrollTo();
    s.init();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById(id).dispatchEvent(event);
    s.destroy();
    return event.defaultPrevented;
  };

  const MARKUP =
    '<a id="here" href="#one">here</a>' +
    '<a id="other-origin" href="https://elsewhere.test/#one">other site</a>' +
    '<a id="other-path" href="/somewhere-else#one">other page</a>' +
    '<a id="other-query" href="?page=2#one">other query</a>' +
    '<div id="one"></div>';

  /** The control: the same-page anchor must still be taken, or nothing below means anything. */
  it('takes a same-page anchor', () => {
    expect(clickResult(MARKUP, 'here')).toBe(true);
  });

  it('leaves a link to another origin, path or query to the browser', () => {
    expect(clickResult(MARKUP, 'other-origin')).toBe(false);
    expect(clickResult(MARKUP, 'other-path')).toBe(false);
    expect(clickResult(MARKUP, 'other-query')).toBe(false);
  });
});
