/**
 * The production build against the source, **differentially** — the same
 * scenario through both module graphs, expecting byte-identical style output.
 *
 * The suite runs `src`; `dist-surface.test.js` reads the published names off
 * the artifact. Neither can see a *behavioural* divergence: a mangle landing
 * on something load-bearing, a `__DEV__` fold taking a branch with it, an
 * inlined workspace dependency resolving differently. The way to see those is
 * the way the SSR shim is audited — run the same operation against both and
 * compare answers, because each side's code is individually reasonable and
 * only a difference is evidence.
 *
 * The scenario deliberately crosses the surfaces production changes most:
 * multi-keyframe curves in the element arena, an eased curve through the
 * wired easings module, paint slots (hold + the shared value table), a plain
 * CSS property, per-category inertia in the transition, a width band merging
 * onto its base, and teardown restoring the page's own inline style.
 *
 * Skips visibly when dist is not built, like every dist test here.
 */
import { existsSync } from 'node:fs';
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';

const DIST = new URL('../dist/vera-motion.min.js', import.meta.url);
const DIST_PAINT = new URL('../dist/vera-motion-paint.min.js', import.meta.url);
const DIST_EASINGS = new URL('../dist/vera-motion-easings.min.js', import.meta.url);
const built = existsSync(DIST);

const MARKUP =
  '<div data-vera-motion data-vera-motion-inertia="0.25" data-vera-motion-ease="ease-in-out"' +
  ' data-vera-motion-translate-y="0% 0, 50% 60px, 100% 40px"' +
  ' data-vera-motion-scale="0% 1, 100% 1.5"' +
  ' data-vera-motion-blur="0% 0, 100% 6px"' +
  ' data-vera-motion-opacity="0% 0.2, 100% 1"' +
  ' data-vera-motion-radius-top-left="0% 0, 100% 12px"' +
  ' data-vera-motion-background="0% #16161b, 55% #1c3a2c, 100% #1b2a4a"' +
  ' data-vera-motion-opacity-small="30% 0.5"' +
  /** Refused on both sides — the diagnostics channel must flow in production too. */
  ' data-vera-motion-bogus="1"' +
  ' style="transform: translateX(-50%)"></div>';

/** What one frame's DOM answer looks like, for comparing across builds. */
const snapshot = (node) => [
  node.style.transform, node.style.filter, node.style.opacity,
  node.style.background, node.style.getPropertyValue('border-top-left-radius'),
  node.style.transition, node.style.willChange,
];

/**
 * Runs the scenario through one build's exports and returns every snapshot.
 * Fresh DOM per run; the two builds share nothing but the document.
 */
const run = ({ createMotion, wireMotion }, paint, easings) => {
  wireMotion([paint, easings]);
  document.body.innerHTML = MARKUP;
  const node = document.body.firstElementChild;
  Object.defineProperty(node, 'offsetTop', { value: 2000, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 300, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });

  const m = createMotion({ respectReducedMotion: false, breakpoints: { small: [0, 500] } });
  m.init();

  const frames = [];
  for (const y of [0, 400, 900, 1300, 1700, 2300, 5000]) {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
    m.refresh();
    frames.push(snapshot(node));
  }

  /**
   * Count, not text: `__DEV__` folds to short messages in production, so the
   * strings legitimately differ — how *many* refusals reached the channel is
   * the part both builds must agree on.
   */
  frames.push(['rejected', m.rejected.flatMap((r) => r.rejected).length]);
  m.destroy();
  /** Teardown must give the page back its own inline transform. */
  frames.push(['after-destroy', node.getAttribute('style')]);
  return frames;
};

describe('production build parity, differentially', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('the same scenario answers identically from src and from the min bundles', async (t) => {
    if (!built) return t.skip('dist not built — run npm run build first');

    const src = await import('../src/index.ts');
    const { paint: srcPaint } = await import('../src/paint.ts');
    const { easings: srcEasings } = await import('../src/easings.ts');
    const dist = await import(DIST.href);
    const { paint: distPaint } = await import(DIST_PAINT.href);
    const { easings: distEasings } = await import(DIST_EASINGS.href);

    const fromSrc = run(src, srcPaint, srcEasings);
    const fromDist = run(dist, distPaint, distEasings);

    /** The control: the scenario actually animated — a blank parity is no parity. */
    expect(fromSrc.some((frame) => /translateY\(/.test(frame[0]))).toBe(true);
    expect(fromSrc.some((frame) => /blur\(/.test(frame[1]))).toBe(true);
    expect(fromSrc.at(-2)).toEqual(['rejected', 1]);

    expect(fromDist).toEqual(fromSrc);
  });
});
