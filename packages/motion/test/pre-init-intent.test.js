import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * `disable()` before `init()` was silently ignored.
 *
 * `enabled` is false until `init()` sets it, so the call fell through to the
 * `if (!enabled) return` guard and did nothing at all. This animated the page:
 *
 *     const m = createMotion();
 *     if (!config.animate) m.disable();
 *     m.init();
 *
 * The call was silent and the intent was plain. `enable()`'s own early return
 * is about a **destroyed** instance — "it used to `start()` regardless, which
 * after a `destroy()` meant re-collecting and re-splitting the page" — so
 * recording the answer contradicts nothing that guard says.
 *
 * Both calls record it, or `disable(); enable(); init()` would come up
 * disabled, which is the opposite mistake.
 */
const P = 'data-vm';

const build = () => {
  document.body.innerHTML = `<div ${P} ${P}-translate-y="0% 0px, 100% 40px"></div>`;
  const node = document.body.firstElementChild;
  for (const [key, value] of [['offsetTop', 500], ['offsetHeight', 200]]) {
    Object.defineProperty(node, key, { value, configurable: true });
  }
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  return node;
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: 1500, configurable: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const start = (before) => {
  const node = build();
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  before(m);
  m.init();
  return { node, m };
};

describe('an answer given before init', () => {
  it('is honoured when it is disable', () => {
    const { node, m } = start((m) => m.disable());
    expect(m.enabled).toBe(false);
    expect(node.style.transform, 'nothing written').toBe('');
    m.destroy();
  });

  it('and the last answer wins', () => {
    const { node, m } = start((m) => { m.disable(); m.enable(); });
    expect(m.enabled).toBe(true);
    expect(node.style.transform).toContain('translateY(');
    m.destroy();
  });

  it('and saying nothing still means yes', () => {
    const { node, m } = start(() => {});
    expect(m.enabled).toBe(true);
    expect(node.style.transform).toContain('translateY(');
    m.destroy();
  });

  it('and it can still be turned on afterwards', () => {
    const { node, m } = start((m) => m.disable());
    m.enable();
    expect(m.enabled).toBe(true);
    expect(node.style.transform).toContain('translateY(');
    m.destroy();
  });

  /**
   * An explicit answer stops the preference being followed, exactly as it does
   * after `init()`. Otherwise a `disable()` made before starting would be
   * undone by the first reduced-motion change — the one event least likely to
   * mean "start animating".
   */
  it('and a reduced-motion change does not undo it', () => {
    let listener;
    vi.stubGlobal('matchMedia', (query) => ({
      matches: false, media: query,
      addEventListener: (_, fn) => { listener = fn; },
      removeEventListener() {},
    }));
    const node = build();
    const m = createMotion({ inertia: 0 });
    m.disable();
    m.init();
    expect(m.enabled).toBe(false);
    listener?.({ matches: false });
    expect(m.enabled, 'still off').toBe(false);
    expect(node.style.transform).toBe('');
    m.destroy();
  });
});
