import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { path } from '../src/path.ts';

wireMotion(path);

const P = 'data-vera-motion';
const place = (n) => {
  Object.defineProperty(n, 'offsetTop', { value: 500, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

let warn;
beforeEach(() => {
  document.body.innerHTML = '';
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

const build = (html) => {
  document.body.innerHTML = '<svg><path id="p" d="M0 0 L100 100"/></svg>' + html;
  for (const node of document.querySelectorAll('div')) place(node);
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return m;
};

/**
 * `path` drives `offset-distance`, which travels along an `offset-path` that
 * only `path-selector` can supply. Three ways to get it wrong, and one of them
 * used to be completely silent.
 */
describe('path following says when it cannot work', () => {
  it('reports a path with no selector at all', () => {
    const m = build(`<div ${P} ${P}-path="0% 0, 100% 100"></div>`);
    expect(m.rejected).toHaveLength(1);
    expect(m.rejected[0].rejected).toEqual([`${P}-path needs ${P}-path-selector`]);
    m.destroy();
  });

  /**
   * In `rejected`, not only the console. This asserted the console line alone
   * for as long as it existed, which is the shape of the bug rather than a
   * test of it: `offset-distance` with no `offset-path` moves the element
   * along nothing, and the GUI that renders `rejected` saw an element doing
   * nothing with no reason given.
   */
  it('reports a selector that resolves to nothing', () => {
    const m = build(`<div ${P} ${P}-path="0% 0, 100% 100" ${P}-path-selector="#missing"></div>`);
    expect(m.rejected[0].rejected[0]).toContain('matched no element');
    expect(warn.mock.calls.map((c) => String(c[0]))).toContainEqual(
      expect.stringContaining('no usable path found')
    );
    m.destroy();
  });

  /** The wrong element rather than no element — a different fix, so a different reason. */
  it('reports an element that carries no d', () => {
    const m = build(
      `<span id="no-d"></span>` +
      `<div ${P} ${P}-path="0% 0, 100% 100" ${P}-path-selector="#no-d"></div>`
    );
    expect(m.rejected[0].rejected[0]).toContain('no d attribute');
    m.destroy();
  });

  /** A `d` the sanitiser will not pass through, which is neither of the above. */
  it('reports a d attribute it will not use', () => {
    document.body.innerHTML =
      '<svg><path id="p" d="M0 0 url(evil)"/></svg>' +
      `<div ${P} ${P}-path="0% 0, 100% 100" ${P}-path-selector="#p"></div>`;
    for (const node of document.querySelectorAll('div')) place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(m.rejected[0].rejected[0]).toContain('not usable');
    m.destroy();
  });

  it('says nothing when the path resolves', () => {
    const m = build(`<div ${P} ${P}-path="0% 0, 100% 100" ${P}-path-selector="#p"></div>`);
    expect(m.rejected).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(document.querySelector('div').style.offsetPath).toBe('path("M0 0 L100 100")');
    m.destroy();
  });

  it('does not complain about an element that follows no path', () => {
    const m = build(`<div ${P} ${P}-translate-y="0% 0px, 100% 40px"></div>`);
    expect(m.rejected).toEqual([]);
    m.destroy();
  });

  it('does not complain when only path-rotate is missing', () => {
    const m = build(`<div ${P} ${P}-path="0% 0, 100% 100" ${P}-path-selector="#p"></div>`);
    expect(m.rejected).toEqual([]);
    m.destroy();
  });
});

/**
 * A list, which `path-selector` refuses and `when` allows.
 *
 * This one is handed to `querySelector`, which returns the first match of *any*
 * branch rather than requiring all of them — not what anyone writing `a, b`
 * means — so it is refused here and allowed for `when`, which is handed to
 * `matches()`. The reason has to say that: the generic selector refusal pointed
 * at `:has()`, which was not the problem and would not have fixed it.
 */
describe('a path-selector written as a list', () => {
  const PRE = 'data-vera-motion';
  it('is refused for being a list, not for `:has()`', () => {
    document.body.innerHTML =
      '<svg><path id="p" d="M0 0 L10 10"/></svg>' +
      `<div ${PRE} ${PRE}-path="0% 0, 100% 100" ${PRE}-path-selector="#p, #q"></div>`;
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const said = m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ');
    expect(said).toContain('is one selector, not a list');
    expect(said).toContain('whichever matched first');
    expect(said, 'the thing that is not wrong with it').not.toContain(':has()');
    m.destroy();
  });
});

/**
 * A path the engine will not take.
 *
 * `parsePathData` restricts the **alphabet** and deliberately does not parse
 * the grammar — the threat it exists for is a quote or a parenthesis breaking
 * out of the `path("…")` string. So `MMM`, a lone `M` and `M0 0 L` passed it,
 * were written as an `offset-path`, and were dropped by every engine: `path`
 * animated `offset-distance` along nothing.
 *
 * The runtime asks `CSS.supports` now, exactly as `@verajs/motion/paint` lets
 * the engine decide what a colour is.
 *
 * **`CSS` is stubbed here, because happy-dom always answers true.** That is not
 * a convenience: without the stub this behaviour is invisible to the whole unit
 * suite, and the mutation for it survived until this test existed.
 * `spikes/path-validity.mjs` is what checks the real answers in three engines;
 * this is what checks the runtime does something with them.
 */
describe('a path the engine refuses', () => {
  const PRE = 'data-vera-motion';

  it('is reported rather than written', () => {
    vi.stubGlobal('CSS', { supports: () => false });
    document.body.innerHTML =
      '<svg><path id="p" d="M0 0 L10 10"/></svg>' +
      `<div id="s" ${PRE} ${PRE}-path="0% 0, 100% 100" ${PRE}-path-selector="#p"></div>`;
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const said = m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ');
    expect(said, 'the existing refusal, reached by the new route').toContain('path-selector');
    expect(document.getElementById('s').style.offsetPath, 'nothing written').toBeFalsy();
    m.destroy();
    vi.unstubAllGlobals();
  });

  /**
   * Editing the selector *away* takes the offset-path with it. The runtime
   * used to strip it in clearElement on every re-parse; the module owns it
   * now, and its prepare sweep is what keeps an edited-away path from
   * leaving a stale offset-path on the element for good.
   */
  it('removes the offset-path when the selector attribute is edited away', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    document.body.innerHTML =
      '<svg><path id="p" d="M0 0 L10 10"/></svg>' +
      `<div id="s" ${PRE} ${PRE}-path="0% 0, 100% 100" ${PRE}-path-selector="#p"></div>`;
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const node = document.getElementById('s');
    expect(node.style.offsetPath, 'the control: it was written').toContain('path(');
    node.removeAttribute(`${PRE}-path-selector`);
    node.removeAttribute(`${PRE}-path`);
    m.collect();
    expect(node.style.offsetPath, 'gone with the attribute').toBe('');
    expect(node.style.offsetRotate).toBe('');
    m.destroy();
    vi.unstubAllGlobals();
  });

  /** And with an engine that takes it, the path is used as before. */
  it('and is written when the engine takes it', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    document.body.innerHTML =
      '<svg><path id="p" d="M0 0 L10 10"/></svg>' +
      `<div id="s" ${PRE} ${PRE}-path="0% 0, 100% 100" ${PRE}-path-selector="#p"></div>`;
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(document.getElementById('s').style.offsetPath).toContain('path(');
    m.destroy();
    vi.unstubAllGlobals();
  });
});
