/**
 * The page's CSS discarding what the runtime writes.
 *
 * The runtime never reads back — that skip is what keeps a frame cheap — so a
 * stylesheet `transform: none !important`, or a CSS `animation` on the same
 * property, silently throws every write away: the attribute parses, validates,
 * animates internally and does nothing, with `rejected` empty. `cascadeTrouble`
 * asks the one unambiguous question (we wrote a string, the computed value is
 * `none`) once per start.
 *
 * happy-dom does not implement the cascade, so the override is simulated at
 * the only place that matters — what `getComputedStyle` answers — which is
 * exactly the input the function reads. The engines' real behaviour is
 * recorded in `spikes/cascade-override.mjs`, which fails if it ever changes.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/** Answers `none` for the named properties, the engine's own values otherwise. */
const overrideComputed = (target, properties) => {
  const real = window.getComputedStyle.bind(window);
  vi.stubGlobal('getComputedStyle', (node, pseudo) => {
    const answer = real(node, pseudo);
    if (node !== target) return answer;
    return new Proxy(answer, {
      get: (source, key) =>
        properties.includes(key) ? 'none' : Reflect.get(source, key),
    });
  });
};

const place = (node, { width = 300, height = 200 } = {}) => {
  Object.defineProperty(node, 'offsetTop', { value: 400, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
  Object.defineProperty(node, 'offsetWidth', { value: width, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

const build = (attributes = 'data-vera-motion-translate-y="0% 0px, 100% 100px"') => {
  document.body.innerHTML = `<div id="a" data-vera-motion ${attributes}></div>`;
  const node = document.getElementById('a');
  place(node);
  return node;
};

const reasons = (m) => m.rejected.flatMap((entry) => entry.rejected);

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(16); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('CSS that outranks the runtime is reported', () => {
  /** The control: an ordinary element must say nothing, or every result below is meaningless. */
  it('says nothing when the write lands', () => {
    const node = build();
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(node.style.transform).toMatch(/translateY\(/);
    expect(reasons(m).some((r) => /discarding/.test(r))).toBe(false);
    expect(m.elements[0].cascadeBlocked).toBeNull();
    m.destroy();
  });

  it('reports a transform the cascade discarded', () => {
    const node = build();
    overrideComputed(node, ['transform']);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    /** The inline write still happened — that is what makes this invisible. */
    expect(node.style.transform).toMatch(/translateY\(/);
    expect(reasons(m).some((r) => /discarding the transform/.test(r))).toBe(true);
    m.destroy();
  });

  it('reports a filter the cascade discarded', () => {
    const node = build('data-vera-motion-blur="0% 0px, 100% 6px"');
    overrideComputed(node, ['filter']);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(reasons(m).some((r) => /discarding the filter/.test(r))).toBe(true);
    m.destroy();
  });

  /**
   * The false positive this check would otherwise have shipped with.
   *
   * A `display: none` element reports computed `transform: none` in Chromium
   * and WebKit — measured, `spikes/cascade-override.mjs`'s sibling probe — so
   * without the no-box guard every element inside a closed accordion, an
   * inactive tab or a collapsed `<details>` would be accused of a stylesheet
   * override it does not have, in two engines out of three. A false accusation
   * costs more than a missed one: it lands in the same `rejected` list a GUI
   * renders beside the real refusals.
   */
  it('says nothing about an element that is not rendered', () => {
    const node = build();
    Object.defineProperty(node, 'offsetWidth', { value: 0, configurable: true });
    Object.defineProperty(node, 'offsetHeight', { value: 0, configurable: true });
    overrideComputed(node, ['transform', 'filter']);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(reasons(m).some((r) => /discarding/.test(r))).toBe(false);
    m.destroy();
  });

  /** An engine that does not report the property answers nothing about it. */
  it('says nothing when the engine reports no computed value', () => {
    const node = build();
    const real = window.getComputedStyle.bind(window);
    vi.stubGlobal('getComputedStyle', (n, p) =>
      n === node ? new Proxy(real(n, p), { get: () => undefined }) : real(n, p));
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(reasons(m).some((r) => /discarding/.test(r))).toBe(false);
    m.destroy();
  });
});
