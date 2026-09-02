/**
 * More than one instance on a page.
 *
 * A main nav and a sidebar nav pointing at the same sections is an ordinary
 * shape, and the two instances know nothing about each other: they share the
 * `document` click listener and the target marker attribute.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

const ATTR = 'data-vm-scroll-target';

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

const twoNavs = () => {
  document.body.innerHTML =
    '<nav id="navA"><a id="la" href="#one">a</a></nav>' +
    '<nav id="navB"><a id="lb" href="#one">b</a></nav>' +
    '<section id="one"></section>';
  place(document.getElementById('one'), 1000);
};

describe('two instances sharing one target', () => {
  /**
   * The marker is a single attribute and the instances cannot see each other,
   * so the *last* one to let go has to be the one that removes it. Without a
   * count it went the moment either instance was destroyed, while the other was
   * still live and still tracking the element.
   */
  it('keeps the marker while either still tracks it', () => {
    twoNavs();
    const a = createScrollTo({ selector: '#navA a' });
    const b = createScrollTo({ selector: '#navB a' });
    a.init();
    b.init();
    expect(document.getElementById('one').hasAttribute(ATTR)).toBe(true);

    a.destroy();
    expect(document.getElementById('one').hasAttribute(ATTR)).toBe(true);

    b.destroy();
    expect(document.getElementById('one').hasAttribute(ATTR)).toBe(false);
  });

  /** Re-collecting is the frequent case; destroy is the rare one. */
  it('survives one instance re-collecting', () => {
    twoNavs();
    const a = createScrollTo({ selector: '#navA a' });
    const b = createScrollTo({ selector: '#navB a' });
    a.init();
    b.init();

    document.getElementById('la').remove();
    a.collect();

    expect(document.getElementById('one').hasAttribute(ATTR)).toBe(true);
    a.destroy();
    b.destroy();
    expect(document.getElementById('one').hasAttribute(ATTR)).toBe(false);
  });
});

describe('two instances with separate links', () => {
  it('a click is handled once, by the instance that owns the link', () => {
    document.body.innerHTML =
      '<nav id="navA"><a id="la" href="#one">a</a></nav>' +
      '<nav id="navB"><a id="lb" href="#two">b</a></nav>' +
      '<section id="one"></section><section id="two"></section>';
    place(document.getElementById('one'), 1000);
    place(document.getElementById('two'), 2000);

    const writes = [];
    const native = window.scrollTo;
    window.scrollTo = (x, y) => writes.push(y);

    const a = createScrollTo({ selector: '#navA a', duration: 0 });
    const b = createScrollTo({ selector: '#navB a', duration: 0 });
    a.init();
    b.init();
    document.getElementById('la')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    window.scrollTo = native;
    expect(writes).toHaveLength(1);
    a.destroy();
    b.destroy();
  });

  it('destroying one leaves the other working', () => {
    document.body.innerHTML =
      '<nav id="navA"><a id="la" href="#one">a</a></nav>' +
      '<nav id="navB"><a id="lb" href="#two">b</a></nav>' +
      '<section id="one"></section><section id="two"></section>';
    place(document.getElementById('one'), 1000);
    place(document.getElementById('two'), 2000);

    const writes = [];
    const native = window.scrollTo;
    window.scrollTo = (x, y) => writes.push(y);

    const a = createScrollTo({ selector: '#navA a', duration: 0 });
    const b = createScrollTo({ selector: '#navB a', duration: 0 });
    a.init();
    b.init();
    a.destroy();

    document.getElementById('lb')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    window.scrollTo = native;

    expect(writes).toHaveLength(1);
    b.destroy();
  });
});

/**
 * And one instance whose own links point at the same target twice.
 *
 * The count is per instance-that-tracks-it, and `collect()`'s undo walks
 * `targets`, which is deduped by id. `mark` was called per *link*, so a second
 * link to one section left the count one higher than anything would ever take
 * off — and climbed by one more on every re-collect. A top nav and a footer
 * nav inside one instance, or a repeated "back to top", is the ordinary case.
 */
describe('one instance with two links to one target', () => {
  const twoLinks = () => {
    document.body.innerHTML =
      '<nav><a id="la" href="#one">a</a><a id="lb" href="#one">b</a></nav>' +
      '<section id="one"></section>';
    place(document.getElementById('one'), 1000);
  };

  it('takes the marker off when it is destroyed', () => {
    twoLinks();
    const s = createScrollTo();
    s.init();
    expect(document.getElementById('one').hasAttribute(ATTR)).toBe(true);

    s.destroy();

    expect(document.getElementById('one').hasAttribute(ATTR)).toBe(false);
  });

  /** And when the link stops pointing at it, however many times it did. */
  it('and when re-collected without those links', () => {
    twoLinks();
    const s = createScrollTo();
    s.init();

    document.querySelector('nav').innerHTML = '';
    s.collect();

    expect(document.getElementById('one').hasAttribute(ATTR)).toBe(false);
    s.destroy();
  });

  /** Both links still work — the dedupe is about the marker, not the list. */
  it('while both links still resolve to it', () => {
    twoLinks();
    const s = createScrollTo();
    s.init();

    expect(s.rejected).toEqual([]);
    expect(document.getElementById('one').hasAttribute(ATTR)).toBe(true);
    s.destroy();
  });
});
