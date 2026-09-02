import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

/**
 * `pin` writes `position: sticky`, which is conditional in two ways the author
 * usually cannot see. Measured in all three engines (`spikes/pin.mjs`): with a
 * clipping ancestor, or a containing block no taller than the element, the
 * element does not hold at all — it scrolls away as if `pin` had never been
 * written, and nothing anywhere said so.
 *
 * happy-dom has no layout, so every box here is declared. What is being tested
 * is the decision, not the geometry; the geometry is the spike's job.
 */
const P = 'data-vm';

/** A box the runtime can read: happy-dom returns 0 for all of these. */
const box = (node, height, width = 800) => {
  Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
  Object.defineProperty(node, 'offsetWidth', { value: width, configurable: true });
  return node;
};

const reasons = (m) => m.rejected.flatMap((entry) => entry.rejected).join('\n');

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** A pinned element inside a wrapper, both sized, with the wrapper's overflow settable. */
const build = ({ overflow = '', wrapperHeight = 1600, options = {} } = {}) => {
  document.body.innerHTML =
    `<div id="wrap"${overflow ? ` style="overflow:${overflow}"` : ''}>` +
    `<div id="p" ${P} ${P}-pin="20px" ${P}-opacity="0% 0, 100% 1"></div></div>`;
  box(document.getElementById('wrap'), wrapperHeight);
  box(document.getElementById('p'), 150);
  const m = createMotion({ respectReducedMotion: false, inertia: 0, ...options });
  m.init();
  return m;
};

describe('a pin that cannot hold', () => {
  it('says nothing when it can', () => {
    const m = build();
    expect(reasons(m)).not.toContain('pin');
    expect(document.getElementById('p').style.position).toBe('sticky');
    m.destroy();
  });

  it('reports a clipping ancestor', () => {
    const m = build({ overflow: 'hidden' });
    expect(reasons(m)).toContain('overflow: hidden, which turns sticky off');
    m.destroy();
  });

  /** `auto` and `scroll` make the ancestor a scrollport just as `hidden` does. */
  it('and any other overflow that is not visible', () => {
    const m = build({ overflow: 'auto' });
    expect(reasons(m)).toContain('turns sticky off');
    m.destroy();
  });

  it('reports a containing block with no room to travel', () => {
    const m = build({ wrapperHeight: 150 });
    expect(reasons(m)).toContain('nothing to hold within');
    m.destroy();
  });

  /**
   * The scroll container itself has `overflow: auto` — that is what makes it
   * one. Walking through it would report against every pinned element in every
   * pane.
   */
  it('does not report the scroll container it sticks against', () => {
    document.body.innerHTML =
      '<div id="pane" style="overflow:auto"><div id="wrap">' +
      `<div id="p" ${P} ${P}-pin="20px" ${P}-opacity="0% 0, 100% 1"></div></div></div>`;
    box(document.getElementById('pane'), 400);
    box(document.getElementById('wrap'), 1600);
    box(document.getElementById('p'), 150);
    const m = createMotion({
      respectReducedMotion: false, inertia: 0, scrollElement: '#pane', root: document.getElementById('pane'),
    });
    m.init();
    expect(reasons(m)).not.toContain('pin');
    m.destroy();
  });

  /**
   * Nor the body. `overflow-x: hidden` on the body is how a large share of
   * themes kill a horizontal scrollbar, and it computes `overflow-y` to
   * `auto`; measured in all three engines, the pin still holds, because the
   * body is the scrollport rather than something between the element and it.
   */
  it('does not report the body clipping its own overflow', () => {
    document.body.style.overflow = 'hidden';
    const m = build();
    expect(reasons(m)).not.toContain('pin');
    document.body.style.overflow = '';
    m.destroy();
  });

  /** The measurement is on the scrolled axis, so a horizontal instance asks about width. */
  it('measures the room on the axis being scrolled', () => {
    const m = build({ wrapperHeight: 1600, options: { scrollDirection: 'horizontal' } });
    expect(reasons(m)).toContain('no wider than the element');
    m.destroy();
  });

  /**
   * Nothing is rendered inside a closed accordion, so every box reads zero and
   * the room check would report about a pin that is fine. It measures again
   * when the panel opens.
   */
  it('says nothing about a pin that is not rendered yet', () => {
    document.body.innerHTML =
      '<div id="wrap"><div id="p" ' + P + ' ' + P + '-pin="20px" ' +
      P + '-opacity="0% 0, 100% 1"></div></div>';
    box(document.getElementById('wrap'), 0, 0);
    box(document.getElementById('p'), 0, 0);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(reasons(m)).not.toContain('pin');
    m.destroy();
  });

  it('says nothing about an element with no pin at all', () => {
    document.body.innerHTML =
      '<div id="wrap" style="overflow:hidden">' +
      `<div id="p" ${P} ${P}-opacity="0% 0, 100% 1"></div></div>`;
    box(document.getElementById('wrap'), 1600);
    box(document.getElementById('p'), 150);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(reasons(m)).toEqual('');
    m.destroy();
  });

  /**
   * Live, like the page-too-short reason beside it: an accordion that opens,
   * or a wrapper whose clipping is a breakpoint away, changes the answer, and
   * a reason recorded once could never be taken back.
   */
  it('stops being reported once the wrapper has room', () => {
    const m = build({ wrapperHeight: 150 });
    expect(reasons(m)).toContain('nothing to hold within');
    box(document.getElementById('wrap'), 1600);
    m.refresh();
    expect(reasons(m)).not.toContain('nothing to hold within');
    m.destroy();
  });
});
