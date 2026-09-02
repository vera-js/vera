/**
 * What the runtime watches for a size change.
 *
 * Geometry is measured once and cached, and two things invalidated it: a
 * `resize` event on the window, and a `ResizeObserver` on
 * `document.documentElement`. Neither sees a **scroll container** changing size
 * while the document's box does not — a splitter drag, a flex reflow, a panel
 * collapsing, and if the pane is out of flow the document never moves at all.
 * Measured in three engines: halving a pane left every element's timeline
 * position at 0.4 when the correct value was 0.
 *
 * `spikes/pane-resize.mjs` measures the *behaviour*; happy-dom cannot, having
 * no layout, so a pane there has no size to change. This asserts the
 * **mechanism** instead — which of them are handed to the observer — because a
 * planted defect that only a browser harness can catch is one `npm run mutate`
 * reports as surviving.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';

let observed;
beforeEach(() => {
  observed = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class {
    observe(target) { observed.push(target); }
    disconnect() {}
  });
  document.body.innerHTML =
    '<div id="pane" style="overflow:auto">' +
    '<div id="a" data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>' +
    '</div>';
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the size observer', () => {
  it('watches the document element', () => {
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    expect(observed).toContain(document.documentElement);
    m.destroy();
  });

  it('and the scroll container as well, when there is one', () => {
    const pane = document.getElementById('pane');
    const m = createMotion({ respectReducedMotion: false, scrollElement: pane, root: pane });
    m.init();
    expect(observed).toContain(pane);
    expect(observed).toContain(document.documentElement);
    m.destroy();
  });

  /**
   * The window is not an element and cannot be observed; the resize event
   * covers it. Asserted as an absence rather than an exact list, because the
   * animated elements are watched too now — an element's own box changing
   * after load is the third thing neither of the two above sees.
   */
  it('does not try to observe the window itself', () => {
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    expect(observed).toContain(document.documentElement);
    expect(observed).not.toContain(window);
    m.destroy();
  });

  /** And each animated element, which is what `spikes/box-change.mjs` measures. */
  it('watches every animated element', () => {
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    expect(observed).toContain(document.getElementById('a'));
    m.destroy();
  });
});
