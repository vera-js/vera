import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createVisibilityTracker } from '../src/modules/visibility.ts';

/** A controllable IntersectionObserver, since happy-dom has no layout to report on. */
let instances;

class FakeIO {
  constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = new Set(); instances.push(this); }
  observe(t) { this.targets.add(t); }
  unobserve(t) { this.targets.delete(t); }
  disconnect() { this.targets.clear(); this.disconnected = true; }
  /** Simulate the observer reporting on a target. */
  report(target, isIntersecting) { this.cb([{ target, isIntersecting }]); }
}

/** The authored range lives on the runtime element, since curves are built there. */
/**
 * `size` is the element's own extent on the scrolled axis, and it is part of
 * the margin now: one timeline unit spans `element.size + rootSize`, which is
 * what `updateTimelinePosition` divides by. The margins below are therefore in
 * pixels, and the numbers are chosen so a 0..1 element with `size` 0 in a
 * root of 1,000 gives the same 50% of the root the percentages used to.
 */
const el = (id, lowestStart = 0, highestEnd = 1, size = 0) => ({
  node: Object.assign(document.createElement('div'), { id }),
  lowestStart,
  highestEnd,
  size,
});

/** The viewport these margins are measured against. */
const ROOT = 1000;

beforeEach(() => { instances = []; vi.stubGlobal('IntersectionObserver', FakeIO); });
afterEach(() => vi.unstubAllGlobals());

describe('createVisibilityTracker', () => {
  it('returns null when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    expect(createVisibilityTracker([], () => {})).toBeNull();
  });

  it('starts every observed element active', () => {
    const a = el('a'), b = el('b');
    const t = createVisibilityTracker([a, b], () => {});
    t.observe(a); t.observe(b);
    expect(t.active.size).toBe(2);
  });

  /** The rule that makes this safe: it can subtract work, never withhold it. */
  it('keeps elements active if the observer never reports', () => {
    const a = el('a');
    const t = createVisibilityTracker([a], () => {});
    t.observe(a);
    expect(t.active.has(a)).toBe(true);
  });

  it('drops an element the observer reports as gone', () => {
    const a = el('a');
    const t = createVisibilityTracker([a], () => {});
    t.observe(a);
    instances[0].report(a.node, false);
    expect(t.active.has(a)).toBe(false);
  });

  /**
   * Found in a real browser, not here: a single programmatic jump past an
   * inactive element left it showing a stale value, because the scroll that
   * brought it into range was handled by a loop that did not yet include it.
   */
  it('updates an element the observer reports as arriving', () => {
    const a = el('a');
    const update = vi.fn();
    const t = createVisibilityTracker([a], update);
    t.observe(a);
    /** It starts active, so the arrival has to be a transition to count. */
    instances[0].report(a.node, false);
    update.mockClear();

    instances[0].report(a.node, true);
    expect(t.active.has(a)).toBe(true);
    /** The flag is which edge, so the caller can tell arriving from leaving. */
    expect(update).toHaveBeenCalledWith(a, true);
  });

  /**
   * Rule 2 starts every element active, so a first report of "yes, visible"
   * used to be a no-op — which meant an element already on screen at load was
   * never announced at all. The first observation now reports whichever way it
   * goes, and repeats do not.
   */
  it('announces the first observation, then only changes', () => {
    const a = el('a');
    const update = vi.fn();
    const t = createVisibilityTracker([a], update);
    t.observe(a);

    instances[0].report(a.node, true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(a, true);

    instances[0].report(a.node, true);
    instances[0].report(a.node, true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('announces an element that is already out of range on its first report', () => {
    const a = el('a');
    const update = vi.fn();
    const t = createVisibilityTracker([a], update);
    t.observe(a);
    instances[0].report(a.node, false);
    expect(update).toHaveBeenCalledWith(a, false);
    expect(t.active.has(a)).toBe(false);
  });

  it('forgets what it reported when an element is unobserved', () => {
    const a = el('a');
    const update = vi.fn();
    const t = createVisibilityTracker([a], update);
    t.observe(a);
    instances[0].report(a.node, true);
    t.unobserve(a);
    t.observe(a);
    instances[0].report(a.node, true);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('gives a departing element one final update, so it settles clamped', () => {
    const a = el('a');
    const onExit = vi.fn();
    const t = createVisibilityTracker([a], onExit);
    t.observe(a);
    instances[0].report(a.node, false);
    expect(onExit).toHaveBeenCalledWith(a, false);
  });

  it('does not fire the exit callback twice for the same departure', () => {
    const a = el('a');
    const onExit = vi.fn();
    const t = createVisibilityTracker([a], onExit);
    t.observe(a);
    instances[0].report(a.node, false);
    instances[0].report(a.node, false);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('re-activates an element that comes back', () => {
    const a = el('a');
    const t = createVisibilityTracker([a], () => {});
    t.observe(a);
    instances[0].report(a.node, false);
    instances[0].report(a.node, true);
    expect(t.active.has(a)).toBe(true);
  });

  it('ignores reports for nodes it does not track', () => {
    const a = el('a');
    const t = createVisibilityTracker([a], () => {});
    t.observe(a);
    expect(() => instances[0].report(document.createElement('div'), false)).not.toThrow();
    expect(t.active.size).toBe(1);
  });

  it('unobserve removes it from the active set', () => {
    const a = el('a');
    const t = createVisibilityTracker([a], () => {});
    t.observe(a);
    t.unobserve(a);
    expect(t.active.has(a)).toBe(false);
    expect(instances[0].targets.size).toBe(0);
  });

  it('disconnect clears everything', () => {
    const a = el('a');
    const t = createVisibilityTracker([a], () => {});
    t.observe(a);
    t.disconnect();
    expect(t.active.size).toBe(0);
    expect(instances[0].disconnected).toBe(true);
  });
});

describe('root margin', () => {
  const marginFor = (els) => {
    createVisibilityTracker(els, () => {}, false, null, ROOT);
    return instances.at(-1).opts.rootMargin;
  };

  it('pads a plain 0..1 animation', () => {
    expect(marginFor([el('a')])).toBe('500px 0px 500px 0px');
  });

  it('extends downward for keyframes before the element enters', () => {
    /** lowestStart -1 means it animates a whole scroll window before entering. */
    expect(marginFor([el('a', -1, 1)])).toBe('500px 0px 1500px 0px');
  });

  it('extends upward for keyframes after it leaves', () => {
    expect(marginFor([el('a', 0, 2)])).toBe('1500px 0px 500px 0px');
  });

  it('takes the widest requirement across all elements', () => {
    expect(marginFor([el('a', -0.5, 1), el('b', 0, 1.5), el('c')]))
      .toBe('1000px 0px 1000px 0px');
  });

  /**
   * The defect this replaced. A timeline unit is the element plus the root, so
   * a margin in roots alone falls short by exactly the element's own size —
   * and the taller the element, the further short. Measured in three engines
   * with an element three times the viewport: it started on the wrong clamp,
   * stepped backwards, and froze at 0.804 without ever reaching the end.
   */
  it('counts the element own size, not just the root', () => {
    expect(marginFor([el('a', 0, 2, 3000)])).toBe('4500px 0px 500px 0px');
  });

  it('and takes the widest span, which need not be the widest reach', () => {
    /** `b` reaches half as far, over a scroll window four times as long. */
    expect(marginFor([el('a', 0, 2, 0), el('b', 0, 1.5, 7000)]))
      .toBe('4500px 0px 500px 0px');
  });

  /**
   * A margin is `top right bottom left`, so the axis matters. This filled the
   * vertical pair whatever `scrollDirection` said, which left a horizontally
   * scrolled instance with no margin on the axis it actually moves along — an
   * element with keyframes outside `0-100%` was reported gone the moment it
   * left the viewport and clamped mid-animation.
   */
  const marginForAxis = (els, horizontal) => {
    createVisibilityTracker(els, () => {}, horizontal, null, ROOT);
    return instances.at(-1).opts.rootMargin;
  };

  it('puts the margin on the horizontal axis when that is the one scrolled', () => {
    expect(marginForAxis([el('a')], true)).toBe('0px 500px 0px 500px');
  });

  it('leads to the left and trails to the right when scrolling horizontally', () => {
    /** Leaving means moving left, so the extra room for `highestEnd` is on the left. */
    expect(marginForAxis([el('a', 0, 2)], true)).toBe('0px 500px 0px 1500px');
    /** Arriving means coming from the right. */
    expect(marginForAxis([el('a', -1, 1)], true)).toBe('0px 1500px 0px 500px');
  });

  it('still uses the vertical axis by default', () => {
    expect(marginForAxis([el('a', 0, 2)], false)).toBe('1500px 0px 500px 0px');
  });
});
