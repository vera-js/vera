/**
 * Tracks which elements are close enough to the viewport to be worth updating.
 *
 * The scroll loop previously walked every registered element on every frame.
 * On a long page that is most of the work for nothing: an element a screen and
 * a half above the fold has a clamped value that cannot change until it comes
 * back. This narrows the loop to what is actually in play, so cost scales with
 * what is on screen rather than what is on the page (principle #4).
 *
 * Correctness rests on two rules:
 *
 * 1. **Both edges get an update.** On the way out, curves clamp outside their
 *    authored range, so a final pass settles the element on its first or last
 *    keyframe and it can then be ignored until it returns. On the way in, the
 *    scroll that brought it into range has already been handled — by a loop
 *    that did not yet include it — so without a pass here a single programmatic
 *    jump (an anchor link, a restored scroll position) would leave it showing a
 *    stale value until the reader nudged the page.
 *
 * 2. **Elements start active and are only ever removed on a positive report.**
 *    The tracker can subtract work, never withhold it. If the observer never
 *    fires — an environment without real layout, a browser quirk — every
 *    element stays in the loop and the result is simply the unoptimised
 *    behaviour, which is correct. An optimisation that can silently stop
 *    animations is not worth having.
 */
import type { RuntimeElement } from './runtime.js';

export interface VisibilityTracker {
  /** Elements currently worth updating. Iterate this, not the full list. */
  readonly active: ReadonlySet<RuntimeElement>;
  /**
   * Whether the margin this tracker was built with reaches as far as this
   * element animates.
   *
   * The margin is computed once, from the elements present at the time, and an
   * observer's `rootMargin` cannot be changed afterwards. So an element adopted
   * later — every element an editor adds, which arrives through the mutation
   * observer — is watched with a margin that knows nothing about it, and one
   * whose keyframes reach further outside 0-1 than anything already on the page
   * is reported as gone while it is still animating. That is rule 1's failure,
   * and the caller answers it by rebuilding the tracker.
   *
   * **It was already answered, by accident.** `add()` hands every adopted
   * element to the box `ResizeObserver`, whose first delivery is guaranteed, so
   * a frame later `measure()` rebuilds the tracker with the new element
   * included. Measured in all three engines: the margin does catch up. This
   * exists for the case that observer is not there — §12 calls `ResizeObserver`
   * "safely assumable; guard anyway and degrade", and the degrade was an
   * element frozen at 0.837 of an animation that reaches 1. `spikes/late-element.mjs`
   * deletes it and sweeps. It is also a frame earlier and does not depend on an
   * unrelated observer for a rule this module states as its own.
   */
  covers(element: RuntimeElement): boolean;
  observe(element: RuntimeElement): void;
  unobserve(element: RuntimeElement): void;
  disconnect(): void;
}

/**
 * How far beyond the viewport an element can still be animating.
 *
 * Timeline position 0 is the moment an element starts entering the scroll
 * window and 1 is the moment it has fully left. Keyframes are allowed outside
 * that (`-50% 0, 150% 1`), which means an animation can still be running while
 * the element is off-screen. The root margin has to cover that, or an element
 * would stop updating mid-animation.
 *
 * A position in viewport units moves when the viewport does, so the tracker is
 * recreated after every re-measure rather than built once (see animation.ts).
 *
 * Expressed in **pixels**, per element, because one timeline unit is not one
 * viewport: `updateTimelinePosition` divides by `element.size + win.size`, so
 * the taller the element the further a percentage of the viewport falls short.
 *
 * It was a flat percentage, and this comment used to say the under-estimate was
 * a missed optimisation rather than a correctness bug, on the grounds that
 * anything outside the margin had already been clamped by its exit update. That
 * is only true when the margin covers the whole animating range. Measured in
 * Chromium with an element three times the viewport and keyframes from -100% to
 * 200%: it **started** at 0.839 — the entry update never ran — stepped
 * backwards to 0.218, and froze at 0.804, never reaching the end. Both edges,
 * which are the two rules above.
 *
 * The pad stays, and stays proportional to the root: it covers rounding and the
 * gap between a re-measure and the observer's first report, neither of which
 * scales with the element.
 */
const PAD = 0.5;

/**
 * How far outside the viewport this one element is still animating, in pixels
 * either side. The margin is the largest of these; `covers` compares against
 * the one that was built.
 */
const reachOf = (
  element: RuntimeElement,
  /** The root's size on the scrolled axis, which the margin is in units of. */
  rootSize: number
): readonly [before: number, after: number] => {
  /** The same span `updateTimelinePosition` divides by. */
  const span = element.size + rootSize;
  return [-element.lowestStart * span, (element.highestEnd - 1) * span];
};

const rootMarginFor = (
  before: number,
  after: number,
  horizontal: boolean,
  rootSize: number
): string => {
  /** Where an element goes once it has left, and where it comes from. */
  const lead = Math.round(after + rootSize * PAD);
  const trail = Math.round(before + rootSize * PAD);

  /**
   * On the axis being scrolled, and only that one. A margin is `top right
   * bottom left`, so the two axes need different slots — and this used to fill
   * the vertical pair whatever `scrollDirection` said. A horizontally scrolled
   * instance therefore got no margin at all on the axis it moves along: an
   * element with keyframes reaching outside `0-100%` was reported as gone the
   * moment it left the viewport and clamped, mid-animation, which is precisely
   * what the margin exists to prevent.
   *
   * Percentages resolve against the root's width for the left and right slots
   * and its height for the other two, so each axis is measured against the
   * dimension it actually scrolls along.
   */
  return horizontal ? `0px ${trail}px 0px ${lead}px` : `${lead}px 0px ${trail}px 0px`;
};

/**
 * Builds the tracker.
 *
 * @param elements every element, used only to size the root margin
 * @param update called on both edges — see rule 1 above
 * @returns null where `IntersectionObserver` is unavailable, which the caller
 * treats as "keep every element in the loop"
 */
export const createVisibilityTracker = (
  elements: readonly RuntimeElement[],
  /**
   * Called on both edges — see rule 1. `active` says which edge, so the caller
   * can tell the page apart from the update it does either way.
   */
  update: (element: RuntimeElement, active: boolean) => void,
  /** Which axis the instance scrolls along; the margin goes on that one. */
  horizontal = false,
  /**
   * The scrolling container, or null for the window.
   *
   * **A margin cannot undo clipping by an ancestor.** With no root the observer
   * measures against the viewport, and an element inside a scrolling container
   * is reported as gone the moment that container scrolls it out of view —
   * however large `rootMargin` is, because the margin expands the viewport
   * rectangle and the clipping happens below it. So the element clamped
   * mid-animation, which is exactly what the margin exists to prevent.
   *
   * Measured in Chromium: an element in a horizontal pane, with keyframes
   * reaching from -100% to 200%, froze at 0.68 and never finished. With the
   * container as the root it runs to 1.
   *
   * Only elements can be roots, so the window is `null` — which is what the
   * observer already assumed, and why nothing was wrong until a container was
   * involved.
   */
  root: Element | null = null,
  /**
   * The root's size on the scrolled axis. The margin is in pixels now, and a
   * timeline unit is `element.size + rootSize`, so it cannot be built without
   * this. Defaulted so the fake observers in the suite need not supply it.
   */
  rootSize = 0
): VisibilityTracker | null => {
  if (typeof IntersectionObserver !== 'function') return null;

  let before = 0;
  let after = 0;
  for (const element of elements) {
    const [b, a] = reachOf(element, rootSize);
    before = Math.max(before, b);
    after = Math.max(after, a);
  }

  const active = new Set<RuntimeElement>();
  const byNode = new Map<Element, RuntimeElement>();
  /**
   * Which elements the observer has ever reported on.
   *
   * Rule 2 starts every element active, so a first report of "yes, visible"
   * would otherwise be a no-op and the element would never be announced. That
   * left an element already on screen at load never reporting at all — nothing
   * to hang "start this video when it arrives" on. Reporting the first
   * observation, whichever way it goes, gives every element exactly one
   * initial state and then a notification per change.
   */
  const reported = new Set<RuntimeElement>();

  /**
   * Built inside a try, because the constructor can throw.
   *
   * `rootMargin` is *computed* — from how far outside 0-1 the authored
   * keyframes reach — and a margin an engine will not parse is a SyntaxError,
   * not a quiet no-op. This module's contract is that it "can subtract work,
   * never withhold it", and an exception here withheld everything: it escaped
   * `init()` and left the instance half-wired, with no scroll listener and no
   * elements painted. Returning null falls back to iterating the full list,
   * which is the same path an environment without IntersectionObserver takes.
   */
  let observer: IntersectionObserver;
  try {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const element = byNode.get(entry.target);
          if (!element) continue;

          const first = !reported.has(element);
          reported.add(element);

          if (entry.isIntersecting) {
            if (active.has(element) && !first) continue;
            active.add(element);
            update(element, true);
          } else if (active.delete(element) || first) {
            /** One last pass so it settles on its clamped end value. */
            update(element, false);
          }
        }
      },
      { root, rootMargin: rootMarginFor(before, after, horizontal, rootSize) }
    );
  } catch {
    return null;
  }

  return {
    active,
    covers(element) {
      const [b, a] = reachOf(element, rootSize);
      return b <= before && a <= after;
    },
    observe(element) {
      byNode.set(element.node, element);
      /** Active until the observer says otherwise — see rule 2 above. */
      active.add(element);
      observer.observe(element.node);
    },
    unobserve(element) {
      byNode.delete(element.node);
      active.delete(element);
      reported.delete(element);
      observer.unobserve(element.node);
    },
    disconnect() {
      observer.disconnect();
      byNode.clear();
      active.clear();
      reported.clear();
    },
  };
};
