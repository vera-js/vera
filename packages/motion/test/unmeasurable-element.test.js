import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * An element this library cannot measure.
 *
 * Every geometry reading in the runtime is `offsetTop` / `offsetHeight` /
 * `offsetParent`, which are `HTMLElement` properties. An **SVG** element has
 * none of them — not in any engine, they are not an SVG interface — so a marked
 * `<rect>` was adopted, measured to `start: null`, and written
 * `transform: translateY(NaNpx)` every frame. The CSSOM drops that declaration,
 * so nothing moved, nothing was reported, and the attributes looked perfectly
 * right in devtools.
 *
 * Marking a shape inside an `<svg>` is an ordinary thing to try, and
 * `data-vera-motion-path-selector` already takes an SVG path as its input, so
 * the namespace is plainly in an author's mind when they reach for this.
 *
 * Refused rather than supported: measuring these means `getBoundingClientRect`
 * on a separate code path, and adding a feature is not what a refusal is for.
 */
const P = 'data-vera-motion';

const place = (node) => {
  for (const [key, value] of [['offsetTop', 500], ['offsetHeight', 200]]) {
    Object.defineProperty(node, key, { value, configurable: true });
  }
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

const build = (html) => {
  document.body.innerHTML = html;
  for (const node of document.querySelectorAll('div, p')) place(node);
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return m;
};

const said = (m) => m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ');

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 9000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('an SVG element carrying animation attributes', () => {
  const SVG = `<svg viewBox="0 0 100 100"><rect id="r" ${P} ` +
    `${P}-translate-y="0% 0px, 100% 40px" width="10" height="10"/></svg>`;

  it('is refused, and names the tag it was on', () => {
    const m = build(SVG);
    expect(said(m)).toContain('is on a <rect>');
    m.destroy();
  });

  it('and says why, and what to do instead', () => {
    const m = build(SVG);
    expect(said(m)).toContain('offsetTop and offsetHeight, which only HTML elements have');
    expect(said(m)).toContain('Animate a wrapper around it instead');
    m.destroy();
  });

  /** The half that was the actual symptom: an invalid declaration, written every frame. */
  it('and writes no style at all, rather than translateY(NaNpx)', () => {
    const m = build(SVG);
    expect(m.elements).toHaveLength(0);
    expect(document.getElementById('r').style.transform).toBe('');
    m.destroy();
  });

  /** And the element beside it is unaffected — one refusal, not a dead instance. */
  it('and leaves the HTML elements on the page animating', () => {
    const m = build(`${SVG}<div id="d" ${P} ${P}-opacity="0% 0, 100% 1"></div>`);
    expect(m.elements.map((element) => element.node.id)).toEqual(['d']);
    m.destroy();
  });
});
