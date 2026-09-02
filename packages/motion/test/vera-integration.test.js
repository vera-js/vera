import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { motion } from '../src/vera.ts';

/**
 * Stands in for Vera's `wire()` and its `'init'` insert, without importing Vera.
 *
 * `packages/inserts/src/inserts.ts` calls `item.connect?.(registry)` and then
 * registers `item.fn` under `item.on` at `item.priority`; a module is allowed to
 * be a **function and a descriptor** at once, which is how `@verajs/autoloader`
 * makes configuring and registering one call. `packages/core/src/modules/init.ts`
 * sets `element._root` — kept precisely because `element.shadowRoot` is null for
 * a **closed** root — creates `element._cleanups`, and calls every `'init'`
 * insert with the element. `disconnectedCallback` drains the cleanups.
 *
 * Those four facts are the whole contract this module is built on, so the fake
 * reproduces exactly them and nothing else.
 */
const P = 'data-vera-motion';
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const wire = (modules) => {
  const chain = [];
  for (const item of [].concat(modules)) {
    /** A function whose `on` is set is a descriptor, not a connector. */
    item.connect?.();
    chain.push({ on: item.on, fn: item.fn, priority: item.priority });
  }
  chain.sort((a, b) => a.priority - b.priority);
  return (element) => {
    for (const entry of chain) if (entry.on === 'init') entry.fn(element);
  };
};

const component = (init, { closed = true, light = false } = {}) => {
  const host = document.createElement(`my-c${Math.random().toString(36).slice(2)}`);
  document.body.appendChild(host);
  host._cleanups = new Set();
  if (!light) {
    host._root = host.attachShadow({ mode: closed ? 'closed' : 'open' });
    host._root.innerHTML = `<div ${P} ${P}-opacity="0% 0, 100% 1"></div>`;
    const node = host._root.firstElementChild;
    for (const [key, value] of [['offsetTop', 500], ['offsetHeight', 200], ['offsetWidth', 200]]) {
      Object.defineProperty(node, key, { value, configurable: true });
    }
    Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  }
  init(host);
  /** What `disconnectedCallback` does. */
  host.disconnect = () => {
    for (const cleanup of host._cleanups) cleanup();
    host._cleanups.clear();
    host.remove();
  };
  return host;
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  document.body.innerHTML = '';
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('`motion` is a module you wire, like the rest of the Vera API', () => {
  it('is the shape wire() reads, with no call needed', () => {
    expect(motion.on).toBe('init');
    expect(typeof motion.fn).toBe('function');
    expect(motion.priority).toBe(60);
    expect(motion.name).toBe('@verajs/motion');
    expect(typeof motion.connect).toBe('function');
  });

  /** After the renderer, which registers at 50. */
  it('and is also a factory, which is Vera\'s own allowance', () => {
    const configured = motion({ inertia: 0.4 });
    expect(configured).not.toBe(motion);
    expect(configured.on).toBe('init');
    expect(configured.priority).toBe(60);
    expect(motion({}, 90).priority).toBe(90);
  });

  it('starts its own instance when wired, so nothing else is said', () => {
    const fresh = motion();
    expect(fresh.instance, 'nothing exists before wire()').toBeNull();

    wire([fresh]);

    expect(fresh.instance, 'and the page is animating').toBeTruthy();
    fresh.instance.destroy();
  });

  /** An app whose entry points share a wiring module calls `wire` from each. */
  it('and wiring it twice starts one instance, not two', () => {
    const fresh = motion();
    wire([fresh]);
    const first = fresh.instance;
    wire([fresh]);

    expect(fresh.instance).toBe(first);
    fresh.instance.destroy();
  });

  it('takes options through the call', () => {
    document.body.innerHTML = `<div ${P} ${P}-translate-y="0% 0px, 100% 40px"></div>`;
    const node = document.body.firstElementChild;
    for (const [key, value] of [['offsetTop', 500], ['offsetHeight', 200]]) {
      Object.defineProperty(node, key, { value, configurable: true });
    }
    Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });

    const fresh = motion({ respectReducedMotion: false, inertia: 0.4 });
    wire([fresh]);

    expect(node.style.transition).toContain('0.4s');
    fresh.instance.destroy();
  });
});

describe('a Vera component with a closed shadow root', () => {
  it('animates, which nothing outside could have discovered', async () => {
    const fresh = motion({ respectReducedMotion: false, inertia: 0 });
    const init = wire([fresh]);

    const host = component(init);
    await settled();

    expect(host.shadowRoot, 'closed: unreachable from outside').toBeNull();
    expect(fresh.instance.elements, 'but registered, because Vera handed it over').toHaveLength(1);
    fresh.instance.destroy();
  });

  it('and gives the root back when the component disconnects', async () => {
    const fresh = motion({ respectReducedMotion: false, inertia: 0 });
    const init = wire([fresh]);
    const host = component(init);
    await settled();
    expect(fresh.instance.elements).toHaveLength(1);

    host.disconnect();
    await settled();

    expect(fresh.instance.elements).toEqual([]);
    fresh.instance.destroy();
  });

  /** Nesting is not recursive, and the insert is what makes that not matter. */
  it('including one nested inside another, because the insert fires for both', async () => {
    const fresh = motion({ respectReducedMotion: false, inertia: 0 });
    const init = wire([fresh]);

    const outer = component(init);
    const inner = document.createElement('my-inner');
    outer._root.appendChild(inner);
    inner._cleanups = new Set();
    inner._root = inner.attachShadow({ mode: 'closed' });
    inner._root.innerHTML = `<div ${P} ${P}-opacity="0% 0, 100% 1"></div>`;
    const node = inner._root.firstElementChild;
    for (const [key, value] of [['offsetTop', 900], ['offsetHeight', 200], ['offsetWidth', 200]]) {
      Object.defineProperty(node, key, { value, configurable: true });
    }
    Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
    init(inner);
    await settled();

    expect(fresh.instance.elements, 'both levels').toHaveLength(2);
    fresh.instance.destroy();
  });

  /** Many of them, in one turn, which is what a page load is. */
  it('and a page of them in one batch', async () => {
    const fresh = motion({ respectReducedMotion: false, inertia: 0 });
    const init = wire([fresh]);

    const hosts = Array.from({ length: 30 }, () => component(init));
    await settled();
    expect(fresh.instance.elements).toHaveLength(30);

    for (const host of hosts) host.disconnect();
    await settled();

    expect(fresh.instance.elements).toEqual([]);
    fresh.instance.destroy();
  });
});

describe('a light-DOM Vera component', () => {
  /**
   * `_root` is absent, and the element is already inside a tree the instance
   * scans. Registering `undefined` would be refused and reported, which would
   * put a diagnostic on every light-DOM component on the page.
   */
  it('is left alone, and reports nothing', async () => {
    const fresh = motion({ respectReducedMotion: false, inertia: 0 });
    const init = wire([fresh]);

    component(init, { light: true });
    await settled();

    expect(fresh.instance.rejected).toEqual([]);
    fresh.instance.destroy();
  });
});
