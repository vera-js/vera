/**
 * A REGION is what a `createMotion` instance used to be, minus everything the
 * directives engine now owns. One region = one scroll context: the page by
 * default, or any container carrying `data-vd-motion-group` — its own axis,
 * its own scroller, its own defaults, its own frame loop and visibility
 * tracker. Elements join the nearest region above them and leave it on
 * teardown; the engine's churn activation replaced the scanning, signature
 * and MutationObserver machinery wholesale, and the two-instances CLAIMED
 * guard died with it — regions partition, they cannot overlap on an element.
 *
 * What survives is the animation lifecycle, ported with its measured lore:
 * the read-then-write batching (adopt synchronously, paint on a microtask —
 * 400 `offsetParent` walks cost 0.2ms clean and 277ms with a write between
 * each), the deferred-transition dance and its cancellers, the visibility
 * tracker with margins derived from how far keyframes reach, the resize
 * triptych (window resize + document ResizeObserver + per-element boxes),
 * the balanced active/idle announcements, and the reduced-motion contract:
 * elements rest in their natural readable state, never half-applied.
 */
import { getWindowSize } from './dom.js';

import { scrollListener, resizeListener } from './eventListeners.js';
import { createVisibilityTracker } from './visibility.js';

import { emit, EVENTS } from './events.js';

import { forgetSticky, forgetDirection } from './dom.js';

import { supports, prefersReducedMotion, prefersCoarsePointer, onReducedMotionChange, onCoarsePointerChange } from './supports.js';

import {
  createRuntimeElement, updateElement, resetElement, clearElement,
  setElementStyles, readRootFontSize, writeScrollVar,
} from './runtime.js';
import { insert, pageProblem } from './schema.js';

import { forgetStagger } from './parse.js';
import type { DroppedElement, InsertMap, Range, Region, RegionParseContext, RuntimeElement, RuntimeSettings } from './types.js';


export interface RegionOptions {
  readonly axis: 'vertical' | 'horizontal';
  readonly scrollElement: Window | HTMLElement;
  readonly inertia: number;
  readonly inertiaEase: string;
  readonly ease: string;
  readonly translateZFix: boolean;
  readonly transformOrigin: string;
  readonly onProgress?: ((node: HTMLElement, progress: number) => void) | undefined;
  /** `false` = inline delivery (the cache-escape hatch); see RuntimeSettings.hoist. */
  readonly hoist?: boolean;
}


/**
 * Runs one insert point's chain, and keeps going if a link throws. Two
 * modules commonly register the same point — split and sequence both need a
 * `teardown` — and a throwing one used to stop every module wired after it.
 * Said once for the whole page, like the easing warning: a module that
 * throws in `release` throws once per element, and five hundred identical
 * lines is not five hundred times the information.
 */
let warnedInsert = false;
export const runInserts = (point: keyof InsertMap, ...args: readonly unknown[]): void => {
  for (const fn of insert(point)) {
    try {
      (fn as (...rest: readonly unknown[]) => void)(...args);
    } catch (error) {
      if (!warnedInsert) {
        warnedInsert = true;
        pageProblem('motion-module-threw', [point]);
        console.warn('[vera] motion: the module exception was:', error);
      }
    }
  }
};

/**
 * How many regions are currently live, so the `forget` insert can fire on
 * the transition to zero — the one question a module holding page-level
 * state structurally cannot answer for itself.
 */
let liveRegions = 0;

/**
 * And how many ELEMENTS, page-wide: when the last one leaves, no curve can
 * hold a paint slot, so page-level module state is safe to drop. The old
 * semantics fired `forget` on the last instance's destroy(), which an
 * engine-driven page never calls — an editor emptying and refilling the
 * page recovers automatically now, which is strictly more often.
 */
let liveElements = 0;
const elementJoined = (): void => {
  liveElements++;
};
const elementLeft = (): void => {
  if (--liveElements === 0) runInserts('forget');
};

/**
 * The page's animation switch: explicit calls win over the watched
 * preferences, exactly as the instance API's enable()/disable() did. PAGE
 * level rather than per region, because prefers-reduced-motion is a fact
 * about the visitor, not about a scroll container.
 */
let wanted = true;
let reducedMotion = false;
let touchDisabled = false;
let following = true;
let watchTouch = false;
const liveRegionSet = new Set<Region>();
let preferencesWatched = false;

const animationOn = (): boolean => wanted && !(following && (reducedMotion || (watchTouch && touchDisabled)));

const resolvePreferences = (): void => {
  const on = animationOn();
  for (const region of liveRegionSet) region._setEnabled(on);
};

const watchPreferences = (): void => {
  if (preferencesWatched || typeof window === 'undefined') return;
  preferencesWatched = true;
  /**
   * ALWAYS respected — the opt-out knob died in the audit: emission carries always-on reduced
   * blocks (the pre-JS/no-JS truth), so a JS-side opt-out was structurally half-broken, and an
   * ignore-accessibility-preferences option is not a knob this library wants to own. THE
   * LAYERING, stated once: emission neutralises paint (works with JS off); THIS disable stops
   * the JS work — the drive loop, tick consumers a stylesheet cannot reach, the scroll writes.
   */
  reducedMotion = prefersReducedMotion();
  touchDisabled = watchTouch && prefersCoarsePointer();
  /** Live toggles on both macOS and Windows, so watched rather than sampled. */
  onReducedMotionChange((reduced) => {
    reducedMotion = reduced;
    resolvePreferences();
  });
  onCoarsePointerChange((coarse) => {
    touchDisabled = coarse;
    resolvePreferences();
  });
};

/** Page-level factory knobs the pack's connector sets before any region exists. */
export const configurePreferences = (touch: boolean): void => {
  watchTouch = touch;
};

/**
 * The authoring escape hatches. Explicit answers stop the preferences being
 * followed — an author previewing under their own reduced-motion setting
 * has to see what they are configuring for visitors; a page that never
 * calls this stays still for a visitor who asked for less motion.
 */
export const enableMotion = (): void => {
  wanted = true;
  following = false;
  resolvePreferences();
};
export const disableMotion = (): void => {
  wanted = false;
  following = false;
  resolvePreferences();
};


export const createRegion = (options: RegionOptions, breakpoints: ReadonlyMap<string, Range>): Region => {
  const runtimeSettings: RuntimeSettings = {
    scrollDirection: options.axis,
    scrollElement: options.scrollElement === window ? null : (options.scrollElement as HTMLElement),
    inertia: options.inertia,
    inertiaEase: options.inertiaEase,
    ease: options.ease,
    onProgress: options.onProgress,
    translateZFix: options.translateZFix,
    transformOrigin: options.transformOrigin,
    hoist: options.hoist,
  };
  const scroller: Window | HTMLElement = options.scrollElement;
  const dropped: DroppedElement[] = [];
  const parseContext: RegionParseContext = { breakpoints, dropped, inertia: options.inertia };

  let elements: RuntimeElement[] = [];
  const byNode = new Map<Element, RuntimeElement>();
  let enabled = animationOn();
  let destroyed = false;
  const teardown: Array<() => void> = [];
  /** Elements a `vd:motion:active` was dispatched for and no idle since. */
  const announced = new Set<RuntimeElement>();

  type Tracker = ReturnType<typeof createVisibilityTracker>;
  let visible: Tracker | null = null;
  let boxes: ResizeObserver | undefined;

  /* ── deferred paints and transitions — read-then-write across engine churn ── */
  const unpainted = new Set<RuntimeElement>();
  let painting = false;

  const paintPending = (): void => {
    painting = false;
    if (!unpainted.size || !enabled) return;
    const list = [...unpainted];
    unpainted.clear();
    /** The read first, then every write — the same order, one level up. */
    const win = getWindowSize(runtimeSettings.scrollDirection, scroller);
    /** The first paint may precede any scroll event, and a page can load mid-document — the
     *  scroller var must be true before cascade elements first resolve. */
    writeScrollVar(runtimeSettings, win);
    for (const element of list) setElementStyles(element, runtimeSettings);
    for (const element of list) {
      if (!enabled) return;
      updateElement(element, win, runtimeSettings, true);
    }
  };

  const queuePaint = (): void => {
    if (painting) return;
    painting = true;
    queueMicrotask(paintPending);
  };

  /* ── the frame loop ── */
  const update = (): void => {
    if (!enabled) return;
    const win = getWindowSize(runtimeSettings.scrollDirection, scroller);
    /** Tier C: ONE write per scroller per pass — every cascade-driven element derives its own
     *  progress from this in CSS, so the per-frame cost stops scaling with element count. */
    writeScrollVar(runtimeSettings, win);
    const targets: Iterable<RuntimeElement> = visible ? visible.active : elements;
    for (const element of targets) updateElement(element, win, runtimeSettings);
  };

  /**
   * A gate opened or closed. `when` no longer replaces the scroll driver, so this re-runs the
   * ORDINARY update — the element resumes scrubbing where the page is, or rests at its start.
   * The window has to be measured here because a selector match is not a scroll event and the
   * frame loop's `win` is not in hand.
   */
  const updateState = (force = false): void => {
    if (!enabled) return;
    const win = getWindowSize(runtimeSettings.scrollDirection, scroller);
    for (const element of elements) {
      if (element.when) updateElement(element, win, runtimeSettings, force);
    }
  };

  /**
   * One element, on either edge of the visibility tracker. The update
   * happens regardless — arriving, so a programmatic jump does not leave it
   * stale; leaving, so it settles on its clamped value. The event is
   * dispatched after, so a listener sees the settled state.
   */
  const updateOne = (element: RuntimeElement, active: boolean): void => {
    if (!enabled) return;
    /**
     * A cached size of zero means it was measured while it had no box —
     * `display: none`, which is every accordion and tab panel before it
     * opens. Re-measured here, when the tracker first reports it, which is
     * before it can be seen.
     */
    if (active && element.size === 0) resetElement(element, runtimeSettings);
    updateElement(element, getWindowSize(runtimeSettings.scrollDirection, scroller), runtimeSettings);
    if (active) announced.add(element);
    else announced.delete(element);
    emit(element.node, active ? EVENTS.active : EVENTS.idle, element.timelinePosition);
  };

  const retrack = (): void => {
    visible?.disconnect();
    visible = createVisibilityTracker(
      elements,
      updateOne,
      runtimeSettings.scrollDirection === 'horizontal',
      scroller === window ? null : (scroller as Element),
      getWindowSize(runtimeSettings.scrollDirection, scroller).size
    );
    for (const element of elements) visible?.observe(element);
  };

  /** Re-measure only: animated styles cleared, configuration left in place. */
  const measure = (): void => {
    const win = getWindowSize(runtimeSettings.scrollDirection, scroller);
    readRootFontSize();
    forgetSticky();
    forgetDirection();
    forgetStagger();
    for (const element of elements) resetElement(element, runtimeSettings, win);
    retrack();
  };

  /* ── lifecycle wiring, created lazily on the first add ── */
  let started = false;
  const start = (): void => {
    if (started || destroyed) return;
    if (!supports()) {
      pageProblem('motion-unsupported');
      return;
    }
    started = true;
    liveRegions++;
    liveRegionSet.add(region);
    watchPreferences();
    enabled = animationOn();

    readRootFontSize();
    forgetSticky();
    forgetDirection();

    const scroll = scrollListener(scroller, update);
    teardown.push(scroll.removeScrollListener);
    teardown.push(() => visible?.disconnect());

    /**
     * A page whose images carry no width or height is still reflowing at
     * activation; `load` fires once every subresource has settled, so one
     * re-measure there catches the common case.
     */
    if (document.readyState !== 'complete') {
      const onLoad = () => { measure(); update(); };
      window.addEventListener('load', onLoad, { once: true });
      teardown.push(() => window.removeEventListener('load', onLoad));
    }

    /** Re-measure on anything that can move geometry, coalesced per frame. */
    let queued: number | null = null;
    const remeasure = () => {
      if (queued !== null) return;
      queued = requestAnimationFrame(() => {
        queued = null;
        measure();
        update();
        /** State-driven elements too, FORCED: the curve underneath moved. */
        updateState(true);
      });
    };
    teardown.push(() => {
      if (queued !== null) { cancelAnimationFrame(queued); queued = null; }
    });

    /**
     * Two sources, because neither sees everything — plus the scroller and
     * every element's own box; see the runtime port's lore for each measured
     * gap.
     */
    if (typeof ResizeObserver === 'function') {
      const sizeObserver = new ResizeObserver(remeasure);
      sizeObserver.observe(document.documentElement);
      if (scroller !== window) sizeObserver.observe(scroller as Element);
      boxes = sizeObserver;
      for (const element of elements) sizeObserver.observe(element.node);
      teardown.push(() => { boxes = undefined; sizeObserver.disconnect(); });
    }
    const resize = resizeListener(remeasure);
    teardown.push(resize.removeResizeListener);
  };

  const clear = (): void => {

    unpainted.clear();
    for (const element of elements) {
      runInserts('release', element.node);
      clearElement(element, runtimeSettings);
    }
    if (elements.length) {
      try {
        const win = getWindowSize(runtimeSettings.scrollDirection, scroller);
        for (const element of elements) resetElement(element, runtimeSettings, win);
      } catch {
        /* geometry unreadable; the teardown above already stands */
      }
    }
    /** Balanced by construction: exactly what was told active is told idle. */
    for (const element of announced) emit(element.node, EVENTS.idle, element.timelinePosition);
    announced.clear();
  };

  const region: Region = {
    parseContext,
    settings: runtimeSettings,

    add(parsed, rejectFor) {
      if (destroyed) return null;
      start();
      const already = byNode.get(parsed.node);
      if (already) return already;
      const element = createRuntimeElement(parsed, runtimeSettings, rejectFor);
      /** An inexpressible value refused in construction; its rejection is already recorded. */
      if (!element) return null;
      elements.push(element);
      byNode.set(parsed.node, element);
      elementJoined();
      boxes?.observe(element.node);
      /**
       * A new element can animate further outside the viewport than the
       * tracker was built for, and rootMargin is fixed at construction.
       * Rebuilt only when one actually reaches further.
       */
      if (!visible || !visible.covers(element)) retrack();
      else visible.observe(element);
      unpainted.add(element);
      queuePaint();
      return element;
    },

    remove(node) {
      const element = byNode.get(node);
      if (!element) return;
      byNode.delete(node);
      elements = elements.filter((e) => e !== element);
      elementLeft();
      visible?.unobserve(element);
      boxes?.unobserve(node);
      announced.delete(element);
      unpainted.delete(element);
      runInserts('release', node);
      clearElement(element, runtimeSettings);
      for (let i = dropped.length - 1; i >= 0; i--) {
        if (dropped[i]!.node === node) dropped.splice(i, 1);
      }
    },

    refresh() {
      if (!started) return;
      measure();
      update();
      updateState(true);
    },

    updateWhen(node) {
      if (!enabled) return;
      const element = byNode.get(node);
      if (!element?.when) return;
      updateElement(element, getWindowSize(runtimeSettings.scrollDirection, scroller), runtimeSettings, false);
    },

    /**
     * A stagger group's offsets are index × step in document order, so a
     * member joining or leaving moves every member after it. Indices are
     * read live at curve-refresh time (the fold-in's redesign — parse-time
     * indices are what forced whole-group re-parses), so churn costs one
     * curve refill per member, not a re-parse.
     */
    refreshGroup(host) {
      forgetStagger();
      const win = getWindowSize(runtimeSettings.scrollDirection, scroller);
      for (const element of elements) {
        if (!host.contains(element.node) || element.node === host) continue;
        resetElement(element, runtimeSettings, win);
        unpainted.add(element);
      }
      if (unpainted.size) queuePaint();
    },

    _setEnabled(on) {
      if (on === enabled || destroyed) return;
      enabled = on;
      if (!on) clear();
      else {
        for (const element of elements) setElementStyles(element, runtimeSettings);
        retrack();
        const win = getWindowSize(runtimeSettings.scrollDirection, scroller);
        for (const element of elements) {
          if (!enabled) return;
          updateElement(element, win, runtimeSettings, true);
        }
      }
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const off of teardown.splice(0)) off();
      visible = null;
      clear();
      /** By containment, so a module does not reach another region's state. */
      const nodes = new Set<Node>(elements.map((e) => e.node));
      runInserts('teardown', (node: Node) => nodes.has(node));
      for (const _ of elements) elementLeft();
      elements = [];
      byNode.clear();
      dropped.length = 0;
      if (started) {
        liveRegionSet.delete(region);
        if (--liveRegions === 0) runInserts('forget');
      }
    },
  };

  return region;
};
