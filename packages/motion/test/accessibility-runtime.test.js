import { describe, it, beforeEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { split } from '../src/split.ts';
import { wireMotion } from '../src/index.ts';
import { createMotion } from '../src/index.ts';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

wireMotion([split]);

const place = (n, top = 500) => {
  Object.defineProperty(n, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('accessibility beyond text splitting', () => {
  it('animating adds no aria attributes or roles to ordinary elements', () => {
    document.body.innerHTML =
      '<div data-vm data-vm-translate-y="0% 0px, 100% 40px" data-vm-pin="20px"></div>';
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0.2 });
    m.init();
    const injected = node.getAttributeNames().filter((n) => n.startsWith('aria-') || n === 'role' || n === 'tabindex');
    expect(injected).toEqual([]);
    m.destroy();
  });

  it('reduced motion turning on at runtime strips the transition too', () => {
    /**
     * `setTransitions` defers its write by a frame, so without flushing rAF
     * the transition is still '' when reduced motion arrives and the
     * assertion below passes having observed nothing.
     */
    vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    let listener = null;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: (_type, fn) => { if (query.includes('reduced-motion')) listener = fn; },
      removeEventListener: () => {},
    }));
    document.body.innerHTML =
      '<div data-vm data-vm-translate-y="0% 0px, 100% 40px"></div>';
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: true, inertia: 0.3 });
    m.init();
    expect(node.style.transform).not.toBe('');
    expect(node.style.transition, 'the transition must be present before it can be stripped').not.toBe('');

    listener?.({ matches: true });
    expect(node.style.transform).toBe('');
    expect(node.style.transition).toBe('');
    expect(m.reducedMotion).toBe(true);
    m.destroy();
    vi.unstubAllGlobals();
  });

  it('scroll-to restores the tabindex it injected, and destroy() cleans it up', () => {
    vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('scrollTo', vi.fn());
    document.body.innerHTML = '<nav><a id="l" href="#t">go</a></nav><section id="t"></section>';
    const target = document.getElementById('t');
    place(target, 1000);
    target.focus = vi.fn();

    const s = createScrollTo();
    s.init();
    document.getElementById('l').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(target.getAttribute('tabindex')).toBe('-1');
    expect(target.focus).toHaveBeenCalled();

    s.destroy();
    expect(target.hasAttribute('tabindex')).toBe(false);
    vi.unstubAllGlobals();
  });

  it('split text stays visible, and readable through the hidden copy', async () => {
    document.body.innerHTML =
      '<p data-vm data-vm-split="chars" data-vm-opacity="0% 0, 100% 1">find me</p>';
    const node = document.body.firstElementChild;
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    await new Promise((r) => setTimeout(r, 40));
    /**
     * The accepted trade (Brian, 2026-09-01): the sentence exists twice while
     * split — the visible pieces and the visually-hidden copy real screen
     * readers get — so raw textContent doubles, and find-in-page can match
     * the invisible half. The spec-safe copy outweighs that: aria-label on
     * these roles is prohibited naming that only worked by engine leniency.
     */
    const copy = node.querySelector(':scope > span:not([aria-hidden])');
    expect(copy.textContent).toBe('find me');
    const visible = [...node.childNodes].filter((n) => n !== copy).map((n) => n.textContent).join('');
    expect(visible).toBe('find me');
    m.destroy();
    expect(node.textContent, 'destroy() gives back the single copy').toBe('find me');
  });
});
