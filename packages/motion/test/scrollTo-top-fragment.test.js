/**
 * HTML's fragment fallback: `#top` with no element carrying the id scrolls to
 * the top of the document — the classic back-to-top link, valid in every
 * browser. The library used to report it as a broken link and leave it
 * un-intercepted: the one anchor that jumped while every other one glided.
 * It is a target whose position is 0.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

const place = (node, top) => {
  Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 300, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('a back-to-top link', () => {
  const page = () => {
    document.body.innerHTML =
      '<nav><a id="up" href="#top">back to top</a><a id="go" href="#real">real</a></nav>' +
      '<div id="real"></div>';
    place(document.getElementById('real'), 2000);
    const s = createScrollTo({ duration: 0 });
    s.init();
    return s;
  };

  it('is not reported as a broken link', () => {
    const s = page();
    expect(s.rejected.map((p) => p.reason).join(' ')).not.toContain('top');
    s.destroy();
  });

  it('glides to 0 like every other link, instead of jumping natively', () => {
    const s = page();
    const writes = [];
    vi.spyOn(window, 'scrollTo').mockImplementation((x, y) => writes.push(y));
    Object.defineProperty(window, 'scrollY', { value: 3000, configurable: true });

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('up').dispatchEvent(event);
    expect(event.defaultPrevented, 'intercepted, not left to the native jump').toBe(true);
    expect(writes.at(-1)).toBe(0);
    s.destroy();
  });

  it('an element genuinely carrying id="top" wins over the fallback', () => {
    document.body.innerHTML =
      '<nav><a id="up" href="#top">t</a></nav><div id="top"></div>';
    place(document.getElementById('top'), 1500);
    const s = createScrollTo({ duration: 0 });
    s.init();
    expect(s.rejected).toHaveLength(0);
    const writes = [];
    vi.spyOn(window, 'scrollTo').mockImplementation((x, y) => writes.push(y));
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('up').dispatchEvent(event);
    expect(writes.at(-1), 'scrolled to the element, not to 0').toBe(1500);
    s.destroy();
  });

  it('never inherits the active class when no section is current', () => {
    const s = page();
    /**
     * The coincidence needs a transition: `update()` returns early while the
     * answer is unchanged, and a fresh instance starts at "nothing active".
     * Activate the real section first, then leave it — the pass that clears
     * it is the one where `current` is null and so is the top link's id.
     */
    /** Threshold = scrollY + viewport/2 = 1800 + 400, inside [2000, 2300). */
    Object.defineProperty(window, 'scrollY', { value: 1800, configurable: true });
    s.update();
    expect(document.getElementById('go').classList.contains('active')).toBe(true);

    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    s.update();
    expect(document.getElementById('go').classList.contains('active')).toBe(false);
    expect(document.getElementById('up').classList.contains('active'),
      'null current must not match the null id').toBe(false);
    s.destroy();
  });
});

/**
 * `href="#"` is a top link too — the commonest spelling of one.
 *
 * HTML says an empty fragment indicates the top of the document, and all three
 * engines do exactly that: measured 2000px → 0, the same destination `#top`
 * reaches. It was skipped here, so a back-to-top link written the popular way
 * jumped natively while `#top` glided — the inconsistency the `top` fallback
 * was added to remove, left in place for the more common form.
 *
 * The other thing `<a href="#">` is used for — a placeholder for a JavaScript
 * hook — is unaffected, because a handler on the link runs in the target phase
 * before this module's document listener, and `onClick` yields to
 * `defaultPrevented` first. Both halves are asserted.
 */
describe('an empty fragment is a top link', () => {
  const build = () => {
    document.body.innerHTML =
      '<a id="bare" href="#">top</a><a id="hooked" href="#">hook</a><div id="one"></div>';
    for (const node of document.querySelectorAll('div')) {
      for (const [key, value] of [
        ['offsetTop', 500], ['offsetHeight', 100], ['offsetWidth', 200], ['offsetParent', null],
      ]) Object.defineProperty(node, key, { value, configurable: true });
    }
  };

  it('is taken, like #top', () => {
    build();
    const s = createScrollTo();
    s.init();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('bare').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    s.destroy();
  });

  it('and reports no broken link for it', () => {
    build();
    const s = createScrollTo();
    s.init();
    expect(s.rejected.flatMap((entry) => entry.rejected ?? [entry.reason]))
      .not.toContain('no element with id ""');
    s.destroy();
  });

  /**
   * The placeholder pattern: a page that prevents the default keeps its click.
   *
   * Asserted by whether the page **moved**, not by `defaultPrevented` — which
   * is true either way and would pass whether the module yielded or scrolled.
   * The control below is the same click without a handler, which must move it.
   */
  it('leaves a link whose own handler prevented the default alone', () => {
    build();
    const s = createScrollTo();
    s.init();
    const moved = [];
    vi.stubGlobal('scrollTo', (...args) => moved.push(args));
    /**
     * Scrolled away from the top first, or there is nothing for a top link to
     * do: the tween returns early on a zero change and the control below would
     * measure that instead of the yield it is meant to prove.
     */
    Object.defineProperty(window, 'scrollY', { value: 1200, configurable: true });

    const hooked = document.getElementById('hooked');
    hooked.addEventListener('click', (event) => event.preventDefault());
    hooked.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(moved).toEqual([]);

    /** The control: an unhooked top link on the same instance does move it. */
    document.getElementById('bare').dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(moved.length > 0).toBe(true);

    vi.unstubAllGlobals();
    s.destroy();
  });
});
