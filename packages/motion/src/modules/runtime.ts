/**
 * Builds and drives runtime elements.
 *
 * Replaces createElements.js (element construction) and setState.js (the
 * per-frame loop). The two are together because the whole point of the new
 * shape is that construction does the work once so the frame does almost none:
 * animations are grouped by category, sorted into apply order, and given
 * pre-allocated value buffers at build time, so a frame is an evaluate loop and
 * one style write per category (principle #4).
 */
import { getElementSize, getWindowSize, displacementOf } from './dom.js';
import { ATTRIBUTE_PREFIX } from './namespace.js';
import { buildCurve, curveDoubles, fillCurve, evaluate, curveStart, curveEnd } from './curve.js';

import { emit, EVENTS } from './events.js';
import { composeTransform, composeFilter, applyProperty, sortForApply } from './apply.js';
import type { ParsedElement, ElementMotion } from './parse.js';
import type { RawKeyframe } from './schema.js';
import type { NumericCurve } from './curve.js';
import type { Easing } from './timing.js';
import { insert } from './schema.js';
import { reject } from './rejections.js';
import type { WindowSize } from './dom.js';

/**
 * An animation with its curve attached.
 *
 * The curve is built here rather than in `parse` because a keyframe position
 * in `vh`, `px` or `rem` only means something once the element and viewport
 * have been measured. Parse produces keyframes; the runtime resolves them.
 */
interface PlanAnimation extends ElementMotion { curve: NumericCurve }

/** Animations of one element, for one breakpoint, grouped for application. */
interface ScreenPlan {
  readonly transform: readonly PlanAnimation[];
  readonly filter: readonly PlanAnimation[];
  /** Plain CSS declarations — border radii and the like. */
  readonly properties: readonly PlanAnimation[];

  /**
   * Scratch buffers, sized once so no frame allocates. Views into the
   * element's arena (see `planFor`), which changes where the doubles live and
   * nothing else — they index from 0 like the owned arrays they replaced.
   */
  readonly transformValues: Float64Array;
  readonly filterValues: Float64Array;
  /** Last value written per plain-CSS property, to skip unchanged writes. */
  readonly lastProperties: Float64Array;
  /** Every animation in this plan, in apply order — the list curves rebuild from. */
  readonly all: readonly PlanAnimation[];
}

/**
 * The public face of an animated element — the shape `instance.elements`
 * promises, and **all** it promises.
 *
 * Two fields, deliberately. The runtime's own element record
 * (`RuntimeElement`) carries a dozen more, and the suite reads them freely —
 * against `src`, where every name survives. The production build mangles
 * those internal names (`INTERNAL_PROPS` in rollup.config.js), which is only
 * sound because this type is the entire published contract: a field promoted
 * into it must come off that list in the same edit, and
 * `test/dist-surface.test.js` runs the built artifact so forgetting is loud.
 *
 * `timelinePosition` is public because the README teaches it: the same number
 * `onProgress` reports, readable without a callback from your own loop.
 */
export interface MotionElement {
  readonly node: HTMLElement;
  /** Timeline progress — `0` entering the scroll window, `1` fully left, unclamped. */
  readonly timelinePosition: number;
}

export interface RuntimeElement {
  readonly node: HTMLElement;
  readonly parsed: ParsedElement;
  /**
   * One plan, not one per breakpoint.
   *
   * There used to be three — desktop, tablet and mobile — each with its own
   * curves and scratch buffers, of which exactly one was ever read. Width
   * ranges are resolved when the element is measured instead, so the frame
   * loop reads a single plan and no longer asks which breakpoint applies.
   */
  readonly plan: ScreenPlan;
  readonly transition: string | null;
  readonly transformPrefix: string;
  /**
   * What the page had inline, for the properties this instance takes over.
   *
   * Flat pairs — name, value, name, value — because it is read once per
   * teardown and never per frame, and two arrays or an object of tuples cost
   * more than the indexing saves.
   *
   * The runtime owns these while it animates, which the README states. What it
   * did not do is give them back: `destroy()` promises to release every style
   * it *injected*, and it was removing the author's too. A page builder that
   * emits `transform: translateX(-50%)` for centring — which is most of them —
   * lost the centring for good the first time an instance tore down.
   */
  readonly restore: readonly string[];
  /**
   * How far anything other than this library displaces the element — an
   * ancestor's transform, or one the page wrote inline. Measured once, before
   * the first style is written, and added to every layout reading after.
   */
  readonly displaced: number;

  /** Cached geometry — recomputed on resize and mutation, never per frame. */
  start: number;
  end: number;
  size: number;

  /**
   * How far the authored keyframes reach outside 0-1. Derived from the curves,
   * so they move with them on resize.
   */
  lowestStart: number;
  highestEnd: number;
  /**
   * True when this element's curves must be rebuilt whenever the page is
   * measured — because a position resolves against geometry, **or** because a
   * width band decides which keyframes apply. Both change on resize, and
   * missing the second meant a band was resolved once at construction and then
   * never again.
   */
  readonly geometryDependent: boolean;


  timelinePosition: number;
  runOnceRan: boolean;
  /**
   * The page is not long enough for this element's animation to finish — see
   * `refreshCurves`. Re-derived on every measure, so it stops being true the
   * moment the page grows.
   */
  unfinishable: boolean;
  /**
   * Why `pin` will not hold, or null if it will. Re-derived on every measure
   * for the same reason `unfinishable` is: both are answers about a layout
   * that changes under the page.
   */
  pinBlocked: string | null;
  /**
   * Why `translate-z` will not be visible, or null if it will. Derived with
   * `pinBlocked` and for the same reason: it is an answer about a layout and an
   * ancestor's computed style, both of which change under the page.
   */
  flatBlocked: string | null;
  /**
   * Why the page's CSS is discarding what this element writes, or null.
   *
   * Unlike the two above it is derived **after** a write rather than from
   * layout, because the question is whether a write survived — so `start()`
   * sets it once per (re)start, after its full paint pass, rather than
   * `resetElement` re-deriving it on every measure. A stylesheet rule is not
   * something a resize changes.
   */
  cascadeBlocked: string | null;

  /** Last strings written, so an unchanged frame costs nothing. */
  lastTransform: string;
  lastFilter: string;

  readonly runOnce: boolean;
  /** Selector that drives this element instead of scroll, if any. */
  readonly when: string | null;
}

export interface RuntimeSettings {
  readonly scrollDirection: string;
  /** The scrolling container, when it is not the window. Geometry is relative to it. */
  readonly scrollElement?: Window | HTMLElement | null;
  /** Seconds the element takes to reach the position scroll says it should be at. */
  readonly inertia: number;
  /** Timing function of that catch-up. Handed to CSS. */
  readonly inertiaEase: string;
  /** Timing function of the curve itself. Evaluated here. */
  readonly ease: string;
  /**
   * Called with every element's timeline position, every frame it updates.
   *
   * A callback rather than an event because this runs 60 times a second per
   * element; see events.ts for the measurement. Undefined by default, and the
   * check below is one property read.
   */
  readonly onProgress?: ((node: HTMLElement, progress: number) => void) | undefined;
  readonly translateZFix?: boolean;
  readonly willChange?: boolean;
  readonly transformOrigin?: string;
}

const planFor = (animations: readonly ElementMotion[], ease: Easing | null): ScreenPlan => {
  const sorted = sortForApply(animations);

  /**
   * One Float64Array per element, holding every curve and all three scratch
   * buffers, instead of three arrays per curve plus three per plan. Same
   * evaluation code either way — `buildCurve` hands back persistent views —
   * but the data is contiguous and the per-element cost measured at 2,084 B
   * against 3,152 B for separate arrays (3 animations x 2 keyframes, Node 22).
   * On the pages this library is sized for the difference is noise; at the
   * thousands of elements the perf audit stresses it is megabytes.
   *
   * Each slice is sized for the first *real* fill, not the raw attribute:
   * `mergeForWidth` always gives a lone keyframe a resting partner, so its
   * curve is two keyframes from the first measure on — a slice sized 1 would
   * be abandoned immediately. A width band that later changes a curve's
   * keyframe count still rebuilds that curve standalone (see `refreshCurves`),
   * stranding its slice — retained but bounded, and only on band edges.
   */
  /**
   * How many doubles one animation's curve can ever need.
   *
   * Sized for the **widest merge**, not for the base. `mergeForWidth` merges
   * every band whose range contains the width over the base keyframes, adding
   * any at a position the base does not have — so an element whose band
   * introduces a new keyframe needs more slots than its attribute lists, and
   * sizing from `keyframes.length` alone meant such a curve was rebuilt
   * standalone on its **first measure** and never returned to the arena. It
   * cost both ways: the slice sat unused and the curve paid for three separate
   * typed arrays anyway, which is the whole expense the arena exists to avoid.
   * Measured before this comment was written, on the element the probe built:
   * a band adding one position took its curve out of the arena at
   * construction, not at a band edge.
   *
   * Distinct positions across the base and **all** bands, which is an upper
   * bound rather than an exact count — two bands adding the same position, or
   * bands that never both match, over-reserve by a few doubles. That is the
   * cheap direction: eight bytes against a curve leaving the arena entirely.
   */
  /**
   * How many doubles one animation's curve gets in the arena.
   *
   * Sized from the base keyframes — `mergeForWidth` gives a lone one a resting
   * partner, so two is the floor. It is deliberately **not** sized for the
   * widest possible merge: a curve's views are carved at one length, while the
   * merged count changes with viewport width, so any fixed reservation is
   * wrong at some width. Sizing for the maximum was tried and measured as a
   * lateral move — it keeps a matching band's curve in the arena and pushes a
   * *non*-matching one out, trading the same cost in the other direction. The
   * real fix is re-carving views inside the reserved slice when the count
   * changes; see the audit ledger.
   */
  const slice = (a: ElementMotion): number => curveDoubles(Math.max(2, a.keyframes.length));

  let scratch = 0;
  for (const a of sorted) {
    /** A module property writes through `apply` and may name no CSS at all. */
    if (a.property.category === 'transform' || a.property.category === 'filter' ||
        a.property.cssProperty || a.property.apply) scratch++;
  }

  let doubles = scratch;
  for (const a of sorted) doubles += slice(a);
  const arena = new Float64Array(doubles);

  /**
   * Curves are placed first and filled with placeholders; `refreshCurves` puts
   * the real values in once geometry is known, before anything evaluates.
   * Allocation happens once per element ever; refilling happens on every
   * resize, which is why the two are separate.
   */
  let at = 0;
  const numeric: readonly PlanAnimation[] = sorted.map((a) => {
    const points = a.keyframes.map((k) => ({ position: 0, value: k.value }));
    while (curveDoubles(points.length) < slice(a)) points.push({ position: 0, value: points[0]?.value ?? 0 });
    const curve = buildCurve(points, ease, a.property.discrete, arena, at);
    at += slice(a);
    return { ...a, curve };
  });

  const transform = numeric.filter((a) => a.property.category === 'transform');
  const filter = numeric.filter((a) => a.property.category === 'filter');
  const properties = numeric.filter(
    (a) =>
      a.property.category !== 'transform' &&
      a.property.category !== 'filter' &&
      Boolean(a.property.cssProperty || a.property.apply)
  );

  /**
   * The scratch buffers are views too, after the curves. `lastProperties` is a
   * view, so its `fill(NaN)` here and in `clearElement` stops at its own
   * bounds — no curve data is reachable from it by construction.
   */
  const transformValues = arena.subarray(at, at + transform.length);
  at += transform.length;
  const filterValues = arena.subarray(at, at + filter.length);
  at += filter.length;
  const lastProperties = arena.subarray(at, at + properties.length);
  lastProperties.fill(NaN);

  return { all: numeric, transform, filter, properties, transformValues, filterValues, lastProperties };
};

/**
 * Builds the CSS transition that produces the damped follow.
 *
 * The runtime writes a *target* value each frame; this transition carries the
 * element there over `speed` seconds, so it perpetually chases the scroll.
 * Because transform/opacity/filter transitions are compositor-driven, that
 * smoothing runs off the main thread — which is why per-element inertia is
 * cheap here and why it cannot be expressed by a native scroll-driven
 * animation — an `animation-timeline` animation overrides a transition, so
 * the two cannot be combined.
 *
 * A speed of 0 means no transition: values track scroll position exactly.
 */
const transitionFor = (
  plan: ScreenPlan,
  settings: RuntimeSettings,
  element: ParsedElement
): string | null => {
  const ease = String(element.settings['inertia-ease'] ?? settings.inertiaEase);
  const base = Number(element.settings['inertia'] ?? settings.inertia);

  /**
   * Per-category inertia, so one element can move fast and fade slowly — the
   * inertia capability the pre-rewrite code had as transformSpeed/filterSpeed.
   *
   * These were declared in the schema and parsed, and then never read: the
   * transition was built from the base speed alone, so both attributes did
   * nothing at all. An attribute that parses cleanly and is then ignored is the
   * failure this codebase rejects elsewhere.
   */
  const speedFor = (category: string): number => {
    const override = element.settings[`${category}-inertia`];
    return override === undefined ? base : Number(override);
  };

  /**
   * Every breakpoint, not just desktop. The transition is set once and has to
   * still be right after a resize switches the element to its tablet or mobile
   * animations — a filter that only appears at tablet width would otherwise
   * snap instead of easing.
   */
  const speeds = new Map<string, number>();
  const consider = (cssProperty: string, seconds: number) => {
    /** Inertia of 0 means "track exactly": no transition for that property. */
    if (seconds > 0) speeds.set(cssProperty, seconds);
  };

  if (plan.transform.length) consider('transform', speedFor('transform'));
  if (plan.filter.length) consider('filter', speedFor('filter'));
  for (const animation of plan.properties) {
    if (animation.property.cssProperty) consider(animation.property.cssProperty, base);
  }

  if (!speeds.size) return null;

  return [...speeds]
    .map(([property, speed]) => `${property} ${speed}s ${ease}`)
    .join(', ');
};

/**
 * Resolves a keyframe's authored position onto the 0-1 timeline.
 *
 * 0 is the moment the element begins entering the scroll window and 1 the
 * moment it has completely left, so the window an absolute distance is
 * measured against is the element's own size plus the viewport's — the same
 * quantity `updateTimelinePosition` divides by.
 *
 * `%` is already that fraction and needs no geometry at all, which is why the
 * common page never rebuilds a curve. Every other unit is a length, converted
 * to pixels and then divided by the window.
 *
 * @param root the root font size in pixels, read once per rebuild for `rem`
 */
const normalisePosition = (
  keyframe: RawKeyframe,
  scrollWindow: number,
  win: WindowSize,
  root: number
): number => {
  const { position, positionUnit } = keyframe;
  if (positionUnit === '%') return position / 100;
  if (scrollWindow === 0) return 0;

  const pixels =
    positionUnit === 'vh' ? (position * win.height) / 100
      : positionUnit === 'vw' ? (position * win.width) / 100
      : positionUnit === 'rem' ? position * root
      : position;

  return pixels / scrollWindow;
};

/**
 * The keyframes that apply at this viewport width: the base, with every band
 * whose range contains the width merged over it in declaration order.
 *
 * **Merge, not replace.** A band keyframe at a position the base already has
 * replaces that value; one at a new position is added. That is what lets
 * `[0-500]: 100% 20px` mean "same animation, less travel on a phone" instead
 * of "discard the start keyframe" — which is what a whole-value override did,
 * and the reason a lone `-mobile="50px"` used to silently lose a custom start.
 *
 * A lone keyframe still has its missing end filled from the property's resting
 * value, and that happens *after* merging, so a band can supply the end the
 * base was missing.
 */
const mergeForWidth = (animation: PlanAnimation, width: number): RawKeyframe[] => {
  const merged: RawKeyframe[] = [...animation.keyframes];

  for (const band of animation.bands) {
    if (width < band.min || width > band.max) continue;
    for (const k of band.keyframes) {
      /** Linear scan, not a keyed map: keyframe counts are 2-6, and this is smaller. */
      const at = merged.findIndex(
        (m) => m.position === k.position && m.positionUnit === k.positionUnit
      );
      if (at < 0) merged.push(k);
      else merged[at] = k;
    }
  }

  if (merged.length > 1) return merged;

  const resting: RawKeyframe = {
    /**
     * A discrete property has no resting value. Its `initial` is a slot
     * number, and slot 0 is whichever value the page happened to mint first —
     * another element's, and possibly another property's, since the table is
     * shared. `color="0% crimson"` on its own filled its missing end from it
     * and animated crimson to a `background` gradient authored elsewhere.
     *
     * The element's own first value is the only meaning available, and it
     * makes the lone keyframe hold, which is what one value should do.
     */
    value: animation.property.discrete
      ? (merged[0] ?? animation.bands[0]?.keyframes[0])?.value ?? animation.property.initial
      : animation.property.initial,
    unit: merged[0]?.unit ?? animation.unit,
    position: 0,
    positionUnit: '%',
  };

  /**
   * Nothing applies at this width — every keyframe this property has lives in
   * a band, and none of them match. It rests at the property's resting value
   * rather than leaving an empty curve, which `evaluate` would read past the
   * end of and write as `NaN`.
   */
  if (!merged.length) return [resting, { ...resting, position: 100 }];

  /**
   * A single keyframe is ambiguous on its own. `"0"` means "animate to 0", so
   * the start is filled; `"0% 0"` means "animate from 0", so the end is.
   */
  const only = merged[0]!;
  return only.positionUnit === '%' && only.position === 0
    ? [only, { ...resting, position: 100 }]
    : [resting, only];
};

/**
 * Root font size in pixels, for `rem` positions.
 *
 * Cached at module scope and refreshed once per measure pass, because
 * `getComputedStyle` is a style read and this used to run **once per element**
 * — 200 reads on a resize to answer a question about the document. It changes
 * with CSS, so it is re-read whenever the page is measured rather than once at
 * load. Two instances on a page write the same value from the same source.
 */
let rootFontSize = 16;

/** Re-reads the root font size. Call once per measure pass, not per element. */
export const readRootFontSize = (): void => {
  rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
};

/**
 * Fills every curve on an element from its current geometry, and records how
 * far the authored keyframes reach outside 0-1.
 *
 * Called once at construction and again after each re-measure. The arrays are
 * already the right size, so this allocates nothing beyond the sort scratch —
 * and on a page whose positions are all `%` it is skipped entirely.
 */
const refreshCurves = (element: RuntimeElement, win: WindowSize): void => {
  const scrollWindow = element.size + win.size;
  const root = rootFontSize;

  /**
   * An ancestor's `stagger`, normalised here for the same reason the positions
   * are: `40px` of stagger and a `50%` keyframe measure different things until
   * both are timeline fractions, at which point they simply add.
   */
  const stagger = element.parsed.stagger;
  const offset = stagger
    ? normalisePosition({ ...stagger, value: 0, unit: '' }, scrollWindow, win, root)
    : 0;

  let lowest = Infinity;
  let highest = -Infinity;

  for (const animation of element.plan.all) {
    const merged = mergeForWidth(animation, win.width);
    const points = merged.map((k) => ({
      position: normalisePosition(k, scrollWindow, win, root) + offset,
      value: k.value,
    }));

    /**
     * A band can add or remove keyframes, so the curve is only refilled in
     * place when the count still matches. Band edges are only crossed on
     * resize, so allocating there is not on any hot path. The rebuilt curve
     * owns its arrays; the slice it had in the element's arena stays behind,
     * unreferenced but retained — bounded by the plan's original size, and
     * cheaper than compacting a buffer every other curve still points into.
     */
    if (points.length === animation.curve.positions.length) fillCurve(animation.curve, points);
    else animation.curve = buildCurve(points, animation.curve.ease, animation.curve.hold);

    lowest = Math.min(lowest, curveStart(animation.curve));
    highest = Math.max(highest, curveEnd(animation.curve));
  }

  /** Defaults matter for an element whose only animation was rejected. */
  element.lowestStart = lowest === Infinity ? 0 : lowest;
  element.highestEnd = highest === -Infinity ? 1 : highest;
};

/**
 * Whether the page is long enough for this element's animation to finish.
 *
 * `100%` is where the element has *fully left* the scroll window, so one near
 * the end of the document can never get there: nothing follows it to scroll
 * past. Measured on an ordinary page, a last section reached **0.222** of its
 * timeline and stopped — three quarters of the animation an author wrote never
 * happening, with nothing said about it. The README warns that a keyframe
 * *beyond* 100% never completes; this is the same outcome caused by the page
 * rather than by the keyframe, and much the more likely of the two.
 *
 * Compared against the highest keyframe this element actually has, not against
 * 1 — an animation that finishes at `50%` is unaffected, and saying otherwise
 * would make the diagnostic noise. False on a container that cannot scroll at
 * all: nothing animates there, every element is equally unfinishable, and
 * saying so once per element is noise about a larger problem the author will
 * notice unaided.
 *
 * A **state**, re-derived on every measure, rather than a `reject()` call.
 * `reject` is append-only by design — a module refusing every frame must not
 * turn the diagnostic list into a leak — which makes it the wrong shape for a
 * condition that can stop being true. Recorded that way, a page that grew after
 * the warning kept it for ever, naming an element by then perfectly able to
 * finish. It also has to run for *every* element rather than inside
 * `refreshCurves`, which is skipped for anything not geometry-dependent: on a
 * page whose positions are all `%` that is every element there is.
 */
const markUnfinishable = (element: RuntimeElement, win: WindowSize): void => {
  element.unfinishable =
    /**
     * Never for a `when` element. It is driven by a selector match rather than
     * by scroll, so it reaches `highestEnd` the moment the selector does and
     * the page's length has nothing to do with it — this said "the page ends
     * before this animation does" about an animation that finishes whenever
     * the class is toggled, on a page of any height.
     *
     * A false diagnostic costs what a missing one costs. It lands in the same
     * `rejected` list a GUI renders beside the real refusals, and the sentence
     * two paragraphs up — that saying this where it does not apply "would make
     * the diagnostic noise" — is the argument, already written down, for the
     * case it did not cover. `when` replaces the scroll driver, and what
     * depended on the driver goes with it: the same rule that refuses `ease`
     * and `stagger` there.
     */
    !element.when &&
    win.reach > win.size &&
    win.reach - element.start < element.highestEnd * (element.size + win.size);
};

/**
 * Why this element's `pin` will not hold, or null if it will.
 *
 * `pin` writes `position: sticky`, which is conditional in two ways the
 * library can see and the author usually cannot. Measured in all three engines
 * (`spikes/pin.mjs`): in both cases the element does not hold at all — it
 * scrolls away as if `pin` had never been written, with nothing said anywhere.
 *
 *   - **A clipping ancestor.** Any `overflow` other than `visible` between the
 *     element and its scroll container makes that ancestor the scrollport, and
 *     it never scrolls. A theme wrapper hiding a decorative overflow is the
 *     single most ordinary thing on a WordPress page.
 *   - **No room to travel.** Sticky moves within its containing block, so a
 *     block no taller than the element — what a flex or grid child gets for
 *     free — leaves nowhere to go.
 *
 * A **transform** on an ancestor is not one of these, though it is the third
 * thing every list of sticky-killers names: it is the containing block for a
 * `fixed` descendant, not for a sticky one. Measured in all three engines
 * alongside the other two, and the pin holds.
 *
 * The walk stops *at* the scroll container and never reaches the body, which
 * is not fastidiousness: `overflow-x: hidden` on the body is how a large share
 * of themes kill a horizontal scrollbar, and it computes `overflow-y` to
 * `auto`. Measured in all three engines — the pin still holds, because the
 * body is the scrollport rather than an obstacle between the element and it.
 * A check that walked one level further would report against most real pages.
 */
/**
 * Why `translate-z` will not be visible, or null if it will.
 *
 * `translateZ()` needs a perspective to project through, and without one it is
 * measured to do **nothing at all**: a 100x100 box stays 100x100 at
 * `translateZ(200px)` and doubles with a perspective. The attribute reference
 * has said so, as measured fact, for as long as the attribute has existed —
 * and the runtime accepted it in silence, which is the worst of the two: the
 * documentation tells an author the thing does nothing and the library lets
 * them write it anyway.
 *
 * **Ancestors, and erring towards silence.** `data-vera-motion-perspective`
 * writes the `perspective()` transform function on the element itself, but CSS
 * `perspective` on an ancestor is the other, older way to set one up, and a
 * page using it is not making a mistake. Any ancestor carrying one ends the
 * walk without a word — even though a perspective only reaches past a direct
 * child through `transform-style: preserve-3d`, so this stays quiet in a case
 * or two where the attribute really is inert. That is the safe direction: a
 * false accusation in `rejected` costs more than a missed one, because the GUI
 * renders it beside the real refusals.
 */
const flatTrouble = (element: RuntimeElement, settings: RuntimeSettings): string | null => {
  if (element.parsed.settings['perspective'] !== undefined) return null;
  const attribute = `${ATTRIBUTE_PREFIX}-translate-z`;
  if (!element.plan.transform.some((one) => one.property.attribute === 'translate-z')) return null;
  const stop = settings.scrollElement as unknown;
  for (let up = (element.node as HTMLElement).parentElement; up; up = up.parentElement) {
    const perspective = getComputedStyle(up).perspective;
    /**
     * `undefined` means the engine does not report the property at all, which
     * is not evidence of anything — happy-dom is one such engine. Say nothing.
     */
    if (perspective === undefined) return null;
    if (perspective && perspective !== 'none') return null;
    if (up === stop || up === document.body || up === document.documentElement) break;
  }
  return __DEV__
    ? `${attribute} does nothing without a perspective to project through — ` +
      `add ${ATTRIBUTE_PREFIX}-perspective on this element, or CSS \`perspective\` on its parent.`
    : `${attribute}: no perspective`;
};

/**
 * Whether the page's own CSS is discarding what this element writes.
 *
 * The runtime composes inline styles and never reads back — that skip is 94%
 * of frames — so it cannot tell a write that landed from one the cascade threw
 * away. Two things in a stylesheet do exactly that, measured in all three
 * engines (`spikes/cascade-override.mjs`): `transform: none !important` beats
 * any inline value that is not itself important, and a running CSS `animation`
 * on the same property beats both. Either way the attribute parses, validates,
 * animates internally and does *nothing*, with `rejected` empty because
 * nothing was refused — the quiet failure this library refuses everywhere else.
 *
 * **Only the unambiguous half is reported.** A composed string was written and
 * the computed value is `none`: that can only be an override, because every
 * value this runtime writes computes to a matrix, `translateY(0px)` included.
 * A CSS animation is deliberately *not* detected — telling one that touches
 * these properties from one that does not needs CSSOM keyframe inspection,
 * which cross-origin stylesheets make unreliable, and an author animating
 * `opacity` in CSS while animating `translate-y` here is doing nothing wrong.
 * A false accusation costs more than a missed one; same rule as `flatTrouble`.
 *
 * **The no-box guard is load-bearing, not defensive.** A `display: none`
 * element reports computed `transform: none` in Chromium and WebKit (Firefox
 * reports the matrix) — so without this, every element inside a closed
 * accordion, an inactive tab or a collapsed `<details>` would be accused, in
 * two engines out of three. Measured before this function was written.
 */
export const cascadeTrouble = (element: RuntimeElement): string | null => {
  const node = element.node;
  /** Nothing written yet, so there is nothing to have been overridden. */
  if (!element.lastTransform && !element.lastFilter) return null;
  /** Not rendered: see above. It will be measured again when it is shown. */
  if (!node.offsetWidth && !node.offsetHeight) return null;

  const computed = getComputedStyle(node);
  /**
   * `undefined` means the engine does not report the property at all, which is
   * not evidence of anything — happy-dom is one such engine. Say nothing.
   */
  const beaten = (written: string, value: string | undefined): boolean =>
    written !== '' && value === 'none';

  const property = beaten(element.lastTransform, computed.transform) ? 'transform'
    : beaten(element.lastFilter, computed.filter) ? 'filter'
    : null;
  if (!property) return null;

  return __DEV__
    ? `this element's CSS is discarding the ${property} the runtime writes — a stylesheet ` +
      `\`${property}: none !important\`, or a CSS \`animation\` on it, outranks an inline style. ` +
      'Nothing here can animate until that rule goes.'
    : `${property}: overridden by CSS`;
};

const pinTrouble = (element: RuntimeElement, settings: RuntimeSettings): string | null => {
  if (element.parsed.settings['pin'] === undefined) return null;
  const node = element.node as HTMLElement;
  const parent = node.parentElement;
  if (!parent) return null;
  /**
   * An element with no box at all is not rendered — inside a closed accordion,
   * a `display: none` tab panel, a collapsed `<details>`. Every measurement
   * below reads zero there, which would report "nothing to hold within" about
   * a pin that is fine and will measure again the moment it is shown.
   */
  if (!node.offsetWidth && !node.offsetHeight) return null;
  const horizontal = settings.scrollDirection === 'horizontal';
  const room = horizontal
    ? parent.offsetWidth - node.offsetWidth
    : parent.offsetHeight - node.offsetHeight;
  if (room <= 0) {
    return __DEV__
      ? `${ATTRIBUTE_PREFIX}-pin: nothing to hold within — its parent is no ` +
        `${horizontal ? 'wider' : 'taller'} than the element.`
      : `${ATTRIBUTE_PREFIX}-pin: no room`;
  }
  const stop = settings.scrollElement as unknown;
  for (let up: HTMLElement | null = parent; up; up = up.parentElement) {
    if (up === stop || up === document.body || up === document.documentElement) break;
    const overflow = getComputedStyle(up).overflow;
    if (overflow && overflow !== 'visible') {
      return __DEV__ ? `${ATTRIBUTE_PREFIX}-pin: an ancestor has overflow: ${overflow}, which turns sticky off.` : `${ATTRIBUTE_PREFIX}-pin: overflow ${overflow}`;
    }
  }
  return null;
};

/** Said once, not once per element — a page gets one line, not five hundred. */
let warnedAboutEasing = false;

/**
 * Resolves an `ease` value, or leaves the curve straight.
 *
 * `linear` needs nothing, which is why it stays the fast path and why the
 * solver is a separate import. Anything else needs `@verajs/motion/easings`
 * wired, and if it is not, the element still animates — on a straight line —
 * and the page is told exactly what to import — in the console once, and in
 * `rejected` per element, because a GUI reads one of those and not the other.
 * Failing loudly beats a curve that is quietly the wrong shape.
 */
const resolveCurveEasing = (node: Element, value: string, declared: boolean): Easing | null => {
  /**
   * How to name the value in a diagnostic.
   *
   * `ease` reaches here from the attribute *or* from the instance default, and
   * the first version of this reported both as `data-vera-motion-ease="…"` —
   * so a page that set `createMotion({ ease: 'ease-out' })` without wiring the
   * module got that message on every element, naming an attribute not one of
   * them carried. A GUI would highlight markup that does not exist.
   */
  const named = declared ? `${ATTRIBUTE_PREFIX}-ease="${value}"` : `ease "${value}" (an option, not an attribute)`;
  if (value === 'linear') return null;
  /**
   * First resolver that answers wins; a module that does not know returns null.
   *
   * And one that *throws* resolves nothing, rather than taking the page with
   * it. This is the fifth insert point and the one `runInserts` cannot cover,
   * because it is the only chain whose links return a value. Unguarded, an
   * exception here left `init()` with **no element adopted at all** — the same
   * failure the other four had, in the only place a module runs per element
   * rather than per page.
   */
  let threw = false;
  for (const resolve of insert('easing')) {
    try {
      const shaped = resolve(value);
      /**
       * A function or nothing. A resolver answering a truthy non-function —
       * a broken module returning `42` — sailed through here into the curve,
       * and `evaluate` then threw `ease is not a function` out of `init()`
       * on the first frame: the page-down failure the try above guards,
       * arriving through the value instead of the throw. Same refusal as a
       * throw, because a module answering nonsense is the same module.
       */
      if (typeof shaped === 'function') return shaped;
      if (shaped) threw = true;
    } catch {
      threw = true;
    }
  }
  if (threw) {
    reject(node, __DEV__ ? `${named}: the easing module threw; the curve is linear.` : `${named}: easing threw`);
    return null;
  }
  if (insert('easing').length) return null;
  /**
   * Per element, unlike the console line. This was console-only, and the
   * README tells anyone whose element is not animating to check `rejected` and
   * says it lists every refused attribute — while the most consequential
   * quiet failure the library has, an `ease` that parses, validates and then
   * does nothing, appeared there not at all. One line in a console the GUI
   * cannot read is not a report.
   */
  reject(node, __DEV__ ? `${named} needs the easings module; the curve is linear.` : `${named}: needs easings module`);
  if (!warnedAboutEasing) {
    warnedAboutEasing = true;
    console.warn(
      `@verajs/motion: ease="${value}" needs the easings module.${__DEV__
        ? " import { easings } from '@verajs/motion/easings' and wireMotion(easings). " +
          'Until then every curve is linear.'
        : ''}`
    );
  }
  return null;
};

/**
 * Builds the runtime representation of one parsed element.
 *
 * This is where the per-frame cost is paid down: animations are grouped by
 * category, sorted into apply order, given pre-allocated value buffers, and
 * had their curves built — so a frame is an evaluate loop and one style write
 * per category (principle #4).
 *
 * @param parsed the element's attributes, already validated
 * @param settings instance-level defaults the element may override
 */
export const createRuntimeElement = (
  parsed: ParsedElement,
  settings: RuntimeSettings
): RuntimeElement => {
  const node = parsed.node as HTMLElement;

  /**
   * One curve easing for the element, resolved once. `linear` resolves to null
   * so the straight-line path stays a bare multiply.
   */
  const declaredEase = parsed.settings['ease'];
  const ease = resolveCurveEasing(node, String(declaredEase ?? settings.ease), declaredEase !== undefined);

  const plan = planFor(parsed.animations, ease);

  const { start, end, size } = getElementSize(node, settings.scrollDirection, settings.scrollElement);
  /**
   * Before anything is written, which is what makes this the displacement
   * caused by everything *except* this instance.
   */
  const displaced = displacementOf(node, settings.scrollDirection, start, settings.scrollElement);

  /**
   * Leading transform functions the element needs regardless of its animation.
   *
   * `perspective()` first, because it applies to the functions that follow it —
   * without it `translate-z` does nothing at all. `translateZ(0px)` promotes
   * the element to its own compositor layer, and is a prefix rather than an
   * animated function so it survives every rewrite of the transform string.
   */
  const perspective = parsed.settings['perspective'];
  const transformPrefix =
    (perspective ? `perspective(${perspective})` : '') +
    (perspective && settings.translateZFix ? ' ' : '') +
    (settings.translateZFix ? 'translateZ(0px)' : '');

  /**
   * Read once, here, from the inline style only — a value from a stylesheet
   * needs no restoring, since removing the inline one uncovers it again.
   *
   * Skipped when another instance has already adopted this node, because what
   * is inline then is *its* current frame, not the page's. Restoring that on
   * teardown froze the element at whatever it happened to be showing —
   * `translateY(110.744px)`, in the test that caught it — which is worse than
   * the clean element the old code left. Two instances over one element is
   * outside the contract either way, but outside the contract should not mean
   * permanently disfigured.
   */
  const restore: string[] = [];
  if (!adopted.has(node)) {
    adopted.add(node);
    for (const name of managedStyles(plan)) {
      const had = node.style.getPropertyValue(name);
      if (had) restore.push(name, had);
    }
  }

  const element: RuntimeElement = {
    node,
    parsed,
    plan,
    transition: transitionFor(plan, settings, parsed),
    transformPrefix,
    restore,
    displaced,
    /** Both readings carry the correction, here and on every re-measure. */
    start: start + displaced,
    end: end + displaced,
    size,
    lowestStart: 0,
    highestEnd: 1,
    unfinishable: false,
    pinBlocked: null,
    flatBlocked: null,
    cascadeBlocked: null,
    /**
     * A stagger in anything but `%` moves with the viewport, exactly as a
     * position does — and a width band moves with it by definition.
     */
    geometryDependent:
      (parsed.stagger !== undefined && parsed.stagger.positionUnit !== '%') ||
      plan.all.some((a) => a.geometryDependent || a.bands.length > 0),
    timelinePosition: 0,
    runOnceRan: false,
    lastTransform: '',
    lastFilter: '',
    runOnce: parsed.settings['run-once'] === true,
    when: typeof parsed.settings['when'] === 'string' ? parsed.settings['when'] : null,
  };

  const win = getWindowSize(settings.scrollDirection, settings.scrollElement ?? window);
  refreshCurves(element, win);
  markUnfinishable(element, win);
  element.pinBlocked = pinTrouble(element, settings);
  element.flatBlocked = flatTrouble(element, settings);

  return element;
};

/**
 * Evaluates every animation for the current timeline position and writes the
 * result. One evaluate per animation, one style write per category.
 */
export const animateElement = (element: RuntimeElement): void => {
  const { plan } = element;
  const position = element.timelinePosition;

  const { transform, transformValues } = plan;
  if (transform.length) {
    for (let i = 0; i < transform.length; i++) {
      transformValues[i] = evaluate(transform[i]!.curve, position);
    }
    const next = composeTransform(
      { animations: transform, values: transformValues },
      element.transformPrefix
    );
    /**
     * Skip the write when nothing changed — most frames, in practice.
     *
     * The cache is what this element last *wrote*, not what the DOM currently
     * holds, and closing that gap would mean reading the DOM every frame,
     * which is the cost the cache exists to avoid. So the runtime owns the
     * inline transform of an element it animates: if something else clears it,
     * the value returns on the next frame where it actually changes, and not
     * before. Documented in the README under "The runtime owns the inline
     * styles it animates".
     */
    if (next !== element.lastTransform) {
      element.node.style.transform = next;
      element.lastTransform = next;
    }
  }

  const { filter, filterValues } = plan;
  if (filter.length) {
    for (let i = 0; i < filter.length; i++) {
      filterValues[i] = evaluate(filter[i]!.curve, position);
    }
    const next = composeFilter({ animations: filter, values: filterValues });
    if (next !== element.lastFilter) {
      element.node.style.filter = next;
      element.lastFilter = next;
    }
  }

  const { properties, lastProperties } = plan;
  for (let i = 0; i < properties.length; i++) {
    const animation = properties[i]!;
    const value = evaluate(animation.curve, position);
    /** NaN-initialised, so the first pass always writes. */
    if (value === lastProperties[i]) continue;
    lastProperties[i] = value;
    /**
     * A module can refuse at write time — `frame` on something that is not a
     * canvas is only discoverable here. The reason goes to the instance's
     * diagnostics rather than only to the console, which a GUI cannot read.
     */
    /**
     * The fifth crossing, and the only one that runs per frame. A module's
     * `apply` throwing left `init()` — and after init, every element *after*
     * this one in the list, on every frame, for the life of the page. A throw
     * becomes the refusal the return type already provides for.
     *
     * `lastProperties[i]` is written above, so a value that does not change
     * does not call `apply` again: a throwing module costs one call per new
     * value, not one per frame.
     */
    let refusal: void | string;
    try {
      refusal = applyProperty(element.node, animation.property, animation.unit, value);
    } catch {
      refusal = `${animation.property.attribute}: this module's apply threw.`;
    }
    if (refusal) reject(element.node, refusal);
  }
};

/**
 * Drives a state-driven element from its selector.
 *
 * The whole feature is this: the timeline position comes from a selector match
 * rather than from scroll. End of the authored range while it matches, start
 * while it does not — the *authored* range rather than 0 and 1, so keyframes
 * outside the usual bounds still resolve to the right ends.
 *
 * Everything downstream is untouched. The damping that makes a scroll animation
 * chase is the same damping that makes this ease rather than snap.
 *
 * @returns whether the position changed, so the caller can skip a pointless write
 */
export const updateStateElement = (
  element: RuntimeElement,
  force = false,
  settings?: RuntimeSettings
): boolean => {
  if (!element.when) return false;

  /**
   * run-once means the same thing here as on scroll: play through, then latch.
   *
   * A forced repaint still has to *paint* it. `enable()` strips every animated
   * style and `start()` puts them back, passing `force` precisely so a latched
   * element is not skipped — its own comment says so — and this returned
   * before reading `force` at all. Measured: a latched state-driven element
   * came back from a disable/enable toggle with no transform whatsoever.
   *
   * Repaint, never re-evaluate: the selector may well have stopped matching
   * since it latched, and latched means the end value holds regardless.
   */
  if (element.runOnce && element.runOnceRan) {
    if (force) animateElement(element);
    return false;
  }

  const matches = element.node.matches(element.when);
  const next = matches ? element.highestEnd : element.lowestStart;

  /**
   * `force` exists for the initial pass. A resting element's position already
   * equals its start, so without it the element would carry no inline style at
   * all until the selector first matched — visible as a flash of un-animated
   * content the moment it does.
   */
  if (!force && next === element.timelinePosition) return false;

  element.timelinePosition = next;
  animateElement(element);

  settings?.onProgress?.(element.node, next);

  if (element.runOnce && matches && !element.runOnceRan) {
    element.runOnceRan = true;
    emit(element.node, EVENTS.complete, next);
  }

  return true;
};

/**
 * Recomputes the timeline position from the current scroll window.
 *
 * 0 is where the element first begins entering the scroll window, 1 where it
 * has completely left. The old implementation quantised this to
 * 1/resolution steps purely so LUT indexing landed on an exact entry; with the
 * LUT gone there is no reason to, and the values are smoother for it.
 */
export const updateTimelinePosition = (element: RuntimeElement, win: WindowSize): void => {
  const scrollWindow = element.size + win.size;
  element.timelinePosition =
    scrollWindow === 0 ? 0 : (win.end - element.start) / scrollWindow;
};

/** Recomputes position, screen type and timeline position, then writes. */
export const updateElement = (
  element: RuntimeElement,
  win: WindowSize,
  settings: RuntimeSettings,
  /**
   * Paint even a latched `run-once` element. `start()` passes this; the frame
   * loop never does.
   *
   * The latch exists so a finished run-once element costs nothing per frame,
   * and that also made it invisible to `start()` — so `disable()` cleared its
   * styles and `enable()` left it blank, having already played. The same
   * force flag `updateStateElement` takes, for the same reason.
   */
  force = false
): void => {
  /** State-driven elements ignore scroll entirely — see updateStateElement. */
  if (element.when) return;

  /**
   * Deliberately allocation-free. This runs once per element per frame, and
   * the previous version built two object literals here every time — one to
   * ask a position predicate a question whose answer was assigned to
   * `element.position` and then never read by anything, and one to pass
   * breakpoint settings by name. Both are gone: the dead call entirely, and
   * the other by passing primitives (principles #3 and #4). The predicate
   * itself outlived the call by some months and has now gone too.
   */
  /**
   * No breakpoint lookup here any more. Width ranges are resolved when the
   * element is measured, which is where the width is already known — this ran
   * once per element per frame to answer a question that changes on resize.
   */
  if (element.runOnce && element.runOnceRan) {
    /**
     * Latched. A forced repaint paints what it latched *at* rather than
     * recomputing from the current scroll position — recomputing put a
     * finished animation back to wherever the page happens to be scrolled
     * now. Measured: latched at `translateY(120px)`, scrolled back to the top,
     * toggled off and on, and it came back at `translateY(86.292px)`.
     */
    if (force) animateElement(element);
    return;
  }

  updateTimelinePosition(element, win);
  animateElement(element);

  settings.onProgress?.(element.node, element.timelinePosition);

  /**
   * `complete` fires once, ever.
   *
   * There is no `!runOnceRan` here, and there used to be. The early return
   * above now sends every latched element away before this line, so nothing
   * reaching it can have run — and the mutation suite proved it, by deleting
   * the condition and staying green. Two guards for one invariant is how a
   * guard rots unnoticed, so the one that still does something stays and this
   * one goes.
   */
  if (element.runOnce && element.timelinePosition >= element.highestEnd) {
    element.runOnceRan = true;
    emit(element.node, EVENTS.complete, element.timelinePosition);
  }
};

/** Applies settings-derived styles that do not animate. */
export const setElementStyles = (element: RuntimeElement, settings: RuntimeSettings): void => {
  const { node } = element;
  if (element.parsed.settings['will-change'] ?? settings.willChange) {
    /**
     * Composed from what this element actually animates.
     *
     * `transform, filter` was written out flat, which is wrong in both
     * directions at once: an element animating only `opacity` asked the
     * compositor to prepare for two properties it never touches — a layer
     * promotion, with the memory that costs — and did not name the one
     * property it does. A `background` from `@verajs/motion/paint` was never
     * hinted at all.
     *
     * Deduped because nothing stops two attributes driving one CSS property.
     */
    const hints = new Set<string>();
    if (element.plan.transform.length) hints.add('transform');
    if (element.plan.filter.length) hints.add('filter');
    for (const animation of element.plan.properties) {
      if (animation.property.cssProperty) hints.add(animation.property.cssProperty);
    }
    if (hints.size) node.style.willChange = [...hints].join(', ');
  }
  const origin = element.parsed.settings['transform-origin'] ?? settings.transformOrigin;
  if (origin) node.style.transformOrigin = String(origin);

  /**
   * Pinning is `position: sticky`, not a fixed/margin dance. The element stays
   * in the layout flow, so content below neither jumps when it attaches nor
   * collapses when it releases — the two failures the hand-computed version
   * had. How long it holds is the extent of its containing block along the
   * scrolled axis, as CSS defines.
   */
  const pin = element.parsed.settings['pin'];
  if (pin !== undefined) {
    node.style.position = 'sticky';
    /**
     * On the axis being scrolled. `top` unconditionally meant a horizontally
     * scrolled instance pinned against the wrong edge — the element held its
     * vertical position, which nothing was moving, while the content it was
     * meant to hold against slid past it sideways.
     *
     * `inset-inline-start` rather than `left`, because the leading edge is a
     * *direction* question and the engine already knows the answer: in an RTL
     * scroller the content moves past the right edge, and a physical `left`
     * pinned against the one edge nothing scrolls past. The logical property
     * resolves per element, with no `isRtl` read here at all.
     */
    if (settings.scrollDirection === 'horizontal') node.style.setProperty('inset-inline-start', String(pin));
    else node.style.top = String(pin);
  }
};

/**
 * Applies transitions after a tick, for a whole set of elements at once.
 *
 * Deferred by one frame because setting the transition in the same frame as the
 * element's first values would animate it in from wherever the browser happened
 * to think it was; the initial state needs to land untransitioned.
 *
 * Batched because the per-element version scheduled one animation frame each —
 * 200 elements meant 200 callbacks for 200 style writes that could share one,
 * and every DOM mutation scheduled another 200 on top.
 *
 * @returns a canceller for the pending frame
 */
export const setTransitions = (
  elements: Iterable<RuntimeElement>,
  /**
   * Called once the write has landed **or** been cancelled, so a caller
   * holding a set of outstanding cancellers can drop this one. Without it a
   * caller either forgets its cancellers — which is the bug this parameter
   * exists for — or accumulates one per mutation batch for the life of the
   * page.
   */
  settled?: () => void,
  /**
   * Whether an element is still the caller's to write, asked **at fire
   * time**. The deferral opens a per-element window the cancellers cannot
   * close: a batch is cancelled whole, so an element dropped between queue
   * and frame — an attribute edit followed by removing the marker, which is
   * two keystrokes in an editor — had its `clearElement` overwritten by this
   * write, leaving an inline `transition` on a node no instance held and
   * nothing could ever clean. Found by observer-path chaos; every seed hit it.
   */
  alive?: (element: RuntimeElement) => boolean
): (() => void) => {
  const pending = [...elements].filter((e) => e.transition);
  if (!pending.length) return () => {};

  const frame = requestAnimationFrame(() => {
    for (const element of pending) {
      if (alive && !alive(element)) continue;
      element.node.style.transition = element.transition as string;
    }
    settled?.();
  });

  /**
   * Cancellable, because the deferral opens a window: `destroy()` between this
   * call and the frame would have `clearElement` strip the transition and then
   * this write it straight back onto a torn-down element. `scrollListener`
   * cancels its frame for exactly this reason; this one did not.
   */
  return () => {
    cancelAnimationFrame(frame);
    settled?.();
  };
};

/**
 * Clears the *animated* styles and re-measures.
 *
 * Geometry has to be read with the transform removed: `calcOffsetStart` walks
 * offsetTop and is unaffected, but `getBoundingClientRect().height` is — an
 * element mid-`scale()` measures its scaled size, which would then be fed back
 * into the timeline.
 *
 * Settings-derived styles (pin, transform-origin, will-change) are deliberately
 * left alone: they are configuration, not animation state, and stripping them
 * here is how the pin silently disappeared on the first re-measure.
 */
export const resetElement = (
  element: RuntimeElement,
  settings: RuntimeSettings,
  /** Read once by the caller when re-measuring a whole page, rather than per element. */
  win?: WindowSize
): void => {
  const { node } = element;

  const { start, end, size } = getElementSize(node, settings.scrollDirection, settings.scrollElement);
  /** Layout position plus whatever else is moving it — see `displacementOf`. */
  element.start = start + element.displaced;
  element.end = end + element.displaced;
  element.size = size;

  markUnfinishable(element, win ?? getWindowSize(settings.scrollDirection, settings.scrollElement ?? window));
  /** A resize is exactly when a wrapper starts or stops clipping. */
  element.pinBlocked = pinTrouble(element, settings);
  element.flatBlocked = flatTrouble(element, settings);

  /**
   * `runOnceRan` is deliberately **not** cleared here.
   *
   * Re-measuring is about geometry; latching is about having played. Clearing
   * it meant any resize replayed every `run-once` element that was not, at
   * that instant, still past its end — and un-latched selector-driven ones
   * outright, since nothing re-latches those without a fresh match. The
   * documented contract is "once, ever", on either driver.
   */

  /**
   * A keyframe positioned in `vh`, `px` or `rem` resolves against the geometry
   * that just changed, and a width band may have started or stopped applying.
   * An element with neither is already normalised and is left untouched, which
   * is every element on the usual page.
   */
  if (element.geometryDependent) {
    refreshCurves(element, win ?? getWindowSize(settings.scrollDirection, settings.scrollElement ?? window));
  }
};

/**
 * Every inline style an instance may write on an element — the fixed ones, plus
 * whatever its own properties name. `clearElement` removes exactly these, so
 * this is the list to read back first.
 */
/**
 * Nodes some instance is currently animating, so a second one can tell the
 * page's inline styles from the first one's output. Module scope is the only
 * channel the two share; nothing is written to the DOM for this.
 */
const adopted = new WeakSet<Element>();

const managedStyles = (plan: ScreenPlan): string[] => [
  'transition', 'transform', 'filter', 'will-change', 'transform-origin',
  'position', 'top', 'inset-inline-start',
  ...plan.properties.map((a) => a.property.cssProperty ?? '').filter(Boolean),
];

/**
 * Full teardown to the element's natural state, settings styles included.
 *
 * This is what the disable toggle and destroy() want: nothing of the library's
 * left behind, and content readable exactly as it would be with the library
 * absent. Re-enabling calls setElementStyles() again.
 *
 * "Natural state" means what the *page* said, which is why the author's own
 * inline values go back on at the end rather than being removed along with
 * this instance's.
 */
export const clearElement = (element: RuntimeElement, settings: RuntimeSettings): void => {
  const { node } = element;
  node.style.transition = '';
  node.style.transform = '';
  node.style.filter = '';

  /**
   * Invalidate the write cache. Without this the next composed string would
   * match what was last written, the write would be skipped, and the element
   * would stay visually cleared — the failure mode of any such cache.
   */
  element.lastTransform = '';
  element.lastFilter = '';
  element.plan.lastProperties.fill(NaN);

  /**
   * **No re-measure here.** It used to call `resetElement`, three lines after
   * writing style — so every call forced a synchronous layout, and callers do
   * this per element. `destroy()` on 5,000 elements took **4.5 seconds**
   * against 87ms for the `init()` that built them, and the curve was
   * quadratic: 0.9ms at 50, 154ms at 1,000, 596ms at 2,000.
   *
   * Three of the four callers discard the element straight afterwards and
   * never read the measurement — the re-parse path measures again in
   * `createRuntimeElement`, which is the same reading taken after the strip
   * rather than during it. The fourth is `clear()`, which needs it for the
   * `enable()` that may follow and now takes it as a second pass over the
   * list, with one window read for all of them instead of one each.
   */

  node.style.removeProperty('will-change');
  node.style.removeProperty('transform-origin');
  if (element.parsed.settings['pin'] !== undefined) {
    node.style.removeProperty('position');
    /** The same axis it was written on, so an authored offset on the other survives. */
    node.style.removeProperty(settings.scrollDirection === 'horizontal' ? 'inset-inline-start' : 'top');
  }
  for (const animation of element.plan.properties) {
    if (animation.property.cssProperty) node.style.removeProperty(animation.property.cssProperty);
  }

  /** Last, so it lands on top of every removal above. */
  for (let i = 0; i < element.restore.length; i += 2) {
    node.style.setProperty(element.restore[i]!, element.restore[i + 1]!);
  }
  adopted.delete(node);
};

export { getWindowSize };
