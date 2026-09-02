import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

const P = 'data-vm';

const place = (n, top = 1200) => {
  Object.defineProperty(n, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 300, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

/**
 * `scroll-to` and the animation runtime are separate entry points with no
 * shared code, and the same lifecycle surface: `init`, `destroy`, `enable`,
 * `disable`, a diagnostics list. Recurring mistake 9 is fixing one and not the
 * other, and it has now happened three times between exactly this pair —
 * `getElementSize` losing its container offset, `destroy()` keeping stale
 * diagnostics, and `destroy()` leaving the instance disabled.
 *
 * Stating the shared rules once, over both, is the only version of this check
 * that cannot drift.
 */
const KINDS = [
  {
    name: 'createMotion',
    page: () => {
      document.body.innerHTML =
        `<div ${P} ${P}-translate-y="0% 0px, 100% 40px"></div>` +
        `<div ${P} ${P}-opacity="broken"></div>`;
      for (const node of document.querySelectorAll('div')) place(node);
    },
    make: () => createMotion({ respectReducedMotion: false, inertia: 0 }),
    /** Something observable that only happens while the instance is working. */
    working: () => document.body.firstElementChild.style.transform !== '',
  },
  {
    name: 'createScrollTo',
    page: () => {
      document.body.innerHTML =
        '<a id="l" href="#t">go</a><a id="bad" href="#missing">no</a><div id="t"></div>';
      place(document.getElementById('t'));
      Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
      Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
    },
    make: () => createScrollTo({ respectReducedMotion: false, duration: 0 }),
    working: () => {
      const before = scrolls.length;
      document.getElementById('l').click();
      return scrolls.length > before;
    },
  },
];

let scrolls = [];

beforeEach(() => {
  scrolls = [];
  document.body.innerHTML = '';
  vi.spyOn(window, 'scrollTo').mockImplementation((...args) => scrolls.push(args));
});
afterEach(() => { vi.restoreAllMocks(); });

describe.each(KINDS)('$name obeys the shared lifecycle contract', (kind) => {
  it('works after init', () => {
    kind.page();
    const instance = kind.make();
    instance.init();
    expect(kind.working()).toBe(true);
    instance.destroy();
  });

  it('is enabled after init', () => {
    kind.page();
    const instance = kind.make();
    instance.init();
    expect(instance.enabled).toBe(true);
    instance.destroy();
  });

  it('a second init is a no-op rather than a second wiring', () => {
    kind.page();
    const instance = kind.make();
    instance.init();
    instance.init();
    expect(instance.enabled).toBe(true);
    expect(kind.working()).toBe(true);
    instance.destroy();
  });

  it('works again after destroy and re-init', () => {
    kind.page();
    const instance = kind.make();
    instance.init();
    instance.destroy();
    instance.init();
    expect(kind.working()).toBe(true);
    instance.destroy();
  });

  it('works again after disable, destroy and re-init', () => {
    kind.page();
    const instance = kind.make();
    instance.init();
    instance.disable();
    instance.destroy();
    instance.init();
    expect(instance.enabled, 'destroy must not leave it disabled').toBe(true);
    expect(kind.working()).toBe(true);
    instance.destroy();
  });

  it('reports diagnostics while running', () => {
    kind.page();
    const instance = kind.make();
    instance.init();
    expect(instance.rejected.length).toBeGreaterThan(0);
    instance.destroy();
  });

  it('drops diagnostics for a page it no longer looks at', () => {
    kind.page();
    const instance = kind.make();
    instance.init();
    expect(instance.rejected.length).toBeGreaterThan(0);
    instance.destroy();
    expect(instance.rejected).toEqual([]);
  });

  it('does not report the same problem twice after a re-init', () => {
    kind.page();
    const instance = kind.make();
    instance.init();
    const first = instance.rejected.length;
    instance.destroy();
    instance.init();
    expect(instance.rejected).toHaveLength(first);
    instance.destroy();
  });

  it('enable() on a never-started instance does not half-start it', () => {
    kind.page();
    const instance = kind.make();
    instance.enable();
    expect(kind.working()).toBe(false);
    instance.destroy();
  });

  it('a disable/enable round trip leaves it working', () => {
    kind.page();
    const instance = kind.make();
    instance.init();
    instance.disable();
    instance.enable();
    expect(instance.enabled).toBe(true);
    expect(kind.working()).toBe(true);
    instance.destroy();
  });
});
