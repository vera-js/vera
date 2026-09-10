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
import { getElementSize, getWindowSize, displacementOf, normalisePosition } from './dom.js';
import { generateSimple, mergeBandsForWidth } from './generate.js';
import { tickFor } from './ticks.js';
import type { Generated } from './generate.js';
import { acquire, release, ensureProperty, setTail, STAGGER_PROPERTY } from './registry.js';
import { syncTo, rampTo, dispose } from './drive.js';
import type { Driven, SheetRoot } from './types.js';

import { emit, EVENTS } from './events.js';
import { sortForApply } from './apply.js';
import type { ParsedElement, ElementMotion } from './parse.js';
import type { RawKeyframe } from './schema.js';
import type { WindowSize } from './dom.js';

/** Animations of one element, grouped for application — a curve-free INVENTORY since the
 *  sweep: will-change hints, the translate-z check, geometry flags and teardown read the
 *  buckets; nothing evaluates per frame any more. */
interface ScreenPlan {
  readonly all: readonly ElementMotion[];
  readonly transform: readonly ElementMotion[];
  readonly filter: readonly ElementMotion[];
  /** Plain CSS declarations — border radii and the like. */
  readonly properties: readonly ElementMotion[];
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
  /** The scroll range percentages are measured across — see `resolveRange`. */
  rangeStart: number;
  rangeSize: number;
  /** `play` is set: this element runs its keyframes over time at a threshold rather than scrubbing. */
  readonly playing: boolean;
  /** The custom property progress is written to, or null. Opt-in — see the `progress` setting. */
  readonly progressProperty: string | null;
  /**
   * Where a PLAY reverses, or null for a single threshold crossed both ways. Resolved with the range
   * because it is the far end of it — kept apart from `rangeSize` because a play with one half still
   * has a range (its default end), and using that as an exit would make the element leave at a line
   * the author never wrote.
   */
  exitAt: number | null;
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

  /** Last strings written, so an unchanged frame costs nothing. */

  readonly runOnce: boolean;
  /** Selector that drives this element instead of scroll, if any. */
  readonly when: string | null;
  /**
   * The generated write path, or null when this element is outside `generateSimple`'s scope and
   * the inline path drives it. Everything write time needs, derived ONCE at activation so the
   * frame path re-derives nothing: the registry hash to release, the driver's slice, and the two
   * clocks — `tau` for a scrub's chase, `play` for a ramp.
   */
  generated: {
    readonly hash: string;
    /** Transition-mode play: the write is ONE attribute flip and the compositor owns the
     *  clock; no drives run and no variable exists. */
    readonly transition: boolean;
    /** True when any keyframe position is a LENGTH — those rules are per-geometry-bucket and a
     *  re-measure regenerates them (release old, acquire new, re-mark). Bands are NOT this:
     *  their width switching is @media's job. */
    readonly geometric: boolean;
    /** Every registry key this element holds — groups, segments, switches, element rule — for
     *  teardown. */
    readonly hashes: readonly string[];
    /** One driver slice per seek variable, with the raw inertia seconds that time it. */
    readonly drives: readonly { readonly driven: Driven; readonly tau: number }[];
    readonly play: number | null;
  } | null;
  /** A setup-carrying tick module's teardown, run at clearElement -- the drawer-drop moment. */
  readonly tickTeardown: (() => void) | null;
  /**
   * Where this element's refusals go — the engine's rejections registry,
   * captured from the directive's `ctx.reject` at activation. A closure
   * rather than an import, because this pack is an additive bundle that
   * imports nothing from the engine; the fold-in's replacement for the old
   * module-level rejections map.
   */
  readonly reject: (code: string, args?: readonly string[]) => void;
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

const planFor = (animations: readonly ElementMotion[]): ScreenPlan => {
  /**
   * CURVE-FREE since the sweep: the buckets survive because will-change hints, the translate-z
   * check, geometry flags and teardown all read them — but nothing evaluates anything per frame
   * any more, so the arena, the curves, the scratch views and the per-frame evaluate loop are
   * gone with the inline write path. The browser interpolates; this is an inventory.
   */
  const sorted = sortForApply(animations);
  return {
    all: sorted,
    transform: sorted.filter((a) => a.property.category === 'transform'),
    filter: sorted.filter((a) => a.property.category === 'filter'),
    properties: sorted.filter((a) =>
      a.property.category !== 'transform' && a.property.category !== 'filter' &&
      Boolean(a.property.cssProperty)),
  };
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
const mergeForWidth = (animation: ElementMotion, width: number): RawKeyframe[] => {
  /** The band semantics live in generate.ts now, shared — one brain, two consumers. */
  const merged = mergeBandsForWidth(animation.keyframes, animation.bands, width);

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

  const stagger = element.parsed.stagger;
  const offset = stagger
    ? normalisePosition({ ...stagger, value: 0, unit: '' }, scrollWindow, win, root)
    : 0;

  /**
   * The generated path consumes the offset as its CONSTANT var, re-written here because this is
   * the one place that runs at construction AND on every re-measure — a geometry stagger (px)
   * renormalises against the new scroll window exactly as the old curve shift did.
   */
  if (element.generated) {
    if (offset !== 0) element.node.style.setProperty(STAGGER_PROPERTY, String(offset));
    else element.node.style.removeProperty(STAGGER_PROPERTY);
  }

  /**
   * Timeline BOUNDS only — run-once and the unfinishable check read these. The curve refill
   * that lived here died with the curves: positions normalise straight off the merged
   * keyframes, and the browser does the rest.
   */
  let lowest = Infinity;
  let highest = -Infinity;
  for (const animation of element.plan.all) {
    for (const k of mergeForWidth(animation, win.width)) {
      const at = normalisePosition(k, scrollWindow, win, root) + offset;
      lowest = Math.min(lowest, at);
      highest = Math.max(highest, at);
    }
  }
  element.lowestStart = lowest === Infinity ? 0 : lowest;
  element.highestEnd = highest === -Infinity ? 1 : highest;
};

/** The client-side acquisition order, in one place — construction and regeneration must never
 *  drift on it: groups, segment keyframes, the element rule, THEN the media switches (they tie
 *  the element rule on specificity, so sheet source order decides). Returns the teardown keys. */
const deliverGenerated = (node: Element, generatedCss: Generated): string[] => {
  const sheetRoot = node.getRootNode() as SheetRoot;
  /** Transition mode is three rules, ORDER-SENSITIVE: base, then active (they tie on
   *  specificity — the flip's whole mechanism is the later rule winning while the marker is
   *  present), then the no-JS block. */
  if (generatedCss.mode === 'transition') {
    acquire(sheetRoot, `${generatedCss.hash}#b`, generatedCss.elementRule);
    acquire(sheetRoot, `${generatedCss.hash}#t`, generatedCss.armedRule);
    acquire(sheetRoot, `${generatedCss.hash}#on`, generatedCss.activeRule);
    acquire(sheetRoot, `${generatedCss.hash}#nj`, generatedCss.noJsRule);
    return [`${generatedCss.hash}#b`, `${generatedCss.hash}#t`,
      `${generatedCss.hash}#on`, `${generatedCss.hash}#nj`];
  }
  for (const group of generatedCss.groups) acquire(sheetRoot, group.hash, group.rule);
  for (const segment of generatedCss.segments) {
    for (const rule of segment.rules) acquire(sheetRoot, rule.hash, rule.rule);
  }
  acquire(sheetRoot, `${generatedCss.hash}#el`, generatedCss.elementRule);
  for (const [i, segment] of generatedCss.segments.entries()) {
    acquire(sheetRoot, `${generatedCss.hash}#m${i}`, segment.media);
  }
  return [...generatedCss.groups.map((g) => g.hash),
    ...generatedCss.segments.flatMap((seg, i) =>
      [...seg.rules.map((rule) => rule.hash), `${generatedCss.hash}#m${i}`]), `${generatedCss.hash}#el`];
};

/**
 * Re-measure for a GEOMETRIC generated element (8d): length positions normalised against the new
 * scroll window mean new rule text, a new hash, a new identity. Regenerates through the same
 * generator and the same delivery order as construction; an unchanged hash (the common resize —
 * geometry buckets are coarse) costs one generate call and nothing else. Drives and the tick are
 * untouched: the VARIABLES are the element's identity to the driver, and none of them change.
 */
const regenerateRules = (element: RuntimeElement, win: WindowSize): void => {
  if (!element.generated || !element.generated.geometric) return;
  const fresh = generateSimple(element.parsed, {
    scrollWindow: element.size + win.size, win, root: rootFontSize,
  });
  /** A regeneration that falls out of scope would strand the element silently — keep the last
   *  good rules instead; the next measure retries. Should be unreachable (geometry only moves
   *  numbers), so say so if it happens. */
  if (!fresh || !fresh.groups.length) {
    element.reject('motion-regenerate-failed', []);
    return;
  }
  if (fresh.hash === element.generated.hash) return;
  const keys = deliverGenerated(element.node, fresh);
  /** New rules IN before old rules out — an element must never reference a name mid-swap. */
  element.node.setAttribute('data-vd-a', fresh.hash);
  for (const key of element.generated.hashes) release(key);
  element.generated = {
    ...element.generated,
    hash: fresh.hash,
    hashes: keys,
  };
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
     * Never for a PLAY. It reaches `highestEnd` the moment its threshold is crossed and the page's
     * length has nothing to do with it — this said "the page ends before this animation does" about
     * an animation that finishes on a trigger, on a page of any height.
     *
     * This tested `when` until `when` became a gate rather than a driver. A gated element still
     * scrubs, so the page's length is exactly as relevant to it as to any other; the property that
     * makes the diagnostic false is not having a scroll timeline at all, which is now `playing`.
     *
     * A false diagnostic costs what a missing one costs. It lands in the same
     * `rejected` list a GUI renders beside the real refusals, and the sentence
     * two paragraphs up — that saying this where it does not apply "would make
     * the diagnostic noise" — is the argument, already written down, for the
     * case it did not cover. `when` replaces the scroll driver, and what
     * depended on the driver goes with it: the same rule that refuses `ease`
     * and `stagger` there.
     */
    !element.playing &&
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
 * **Ancestors, and erring towards silence.** `data-vm-perspective`
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
  if (!element.plan.transform.some((one) => one.property.key === 'translate-z')) return null;
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
    ? 'translate-z does nothing without a perspective to project through — add a perspective ' +
      'key on this element, or CSS `perspective` on its parent.'
    : 'translate-z: no perspective';
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
      ? `pin: nothing to hold within — its parent is no ${horizontal ? 'wider' : 'taller'} ` +
        'than the element.'
      : 'pin: no room';
  }
  const stop = settings.scrollElement as unknown;
  for (let up: HTMLElement | null = parent; up; up = up.parentElement) {
    if (up === stop || up === document.body || up === document.documentElement) break;
    const overflow = getComputedStyle(up).overflow;
    if (overflow && overflow !== 'visible') {
      return __DEV__ ? `pin: an ancestor has overflow: ${overflow}, which turns sticky off.` : `pin: overflow ${overflow}`;
    }
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
  settings: RuntimeSettings,
  rejectFor: (code: string, args?: readonly string[]) => void
): RuntimeElement | null => {
  const node = parsed.node as HTMLElement;

  /**
   * One curve easing for the element, resolved once — `linear` resolves to
   * null so the straight-line path stays a bare multiply — and one more per
   * property that carries its own in the nested value form, resolved lazily
   * so an element with none pays one comparison per animation.
   */
  /**
   * The generation decision comes FIRST, because it decides who solves easing. A generated
   * element's curves are CSS timing functions the BROWSER evaluates — emitted verbatim, no
   * easings module, no JS solver — so resolving curves for it would build dead weight and fire
   * `motion-easings-module-missing` for a module the element does not need. The old path keeps
   * the requirement: its solver is ours.
   */
  /** Stagger generates too since 8a — the offset is a per-element var the seek subtracts, so
   *  the whole-group-one-path rule is satisfied ON the generated path now. */
  /**
   * Measured BEFORE generation since 8d: geometry-position values normalise against the scroll
   * window, so the generator needs the element's size in hand. Still before any style write —
   * the displacement contract below is unchanged.
   */
  const measured = getElementSize(node, settings.scrollDirection, settings.scrollElement);
  const measuredWin = getWindowSize(settings.scrollDirection, settings.scrollElement ?? window);
  const generatedCss = generateSimple(parsed, {
    scrollWindow: measured.size + measuredWin.size, win: measuredWin, root: rootFontSize,
  });

  /**
   * NO INLINE PATH remains (the sweep): a value the generator cannot express refuses BY NAME
   * and the element drops — the two shapes are a composite target (transform/filter) whose
   * members misalign under one non-linear ease, and a third-party discrete hold.
   */
  if (!generatedCss) {
    rejectFor('motion-inexpressible', []);
    return null;
  }
  const plan = planFor(parsed.animations);

  const { start, end, size } = measured;
  /**
   * Before anything is written, which is what makes this the displacement
   * caused by everything *except* this instance.
   */
  const displaced = displacementOf(node, settings.scrollDirection, start, settings.scrollElement);

  
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


  /**
   * THE FLIP (write-path stage 4). In-scope elements are driven through generated CSS — the rule
   * ACQUIRED into their own tree, then the element marked, in that order, always: WebKit never
   * re-resolves an animation name an element already carries. Everything `generateSimple`
   * declines answers null and stays on the inline path, unchanged — the gate is the contract.
   */
  /**
   * A staggered GROUP rides one path together. The zero-offset first sibling carries no `stagger`
   * field, so gating on `parsed.stagger` alone generated piece one and left its siblings inline —
   * mixed write paths inside a single cascade, found by the split suite. The ancestor check keeps
   * the group whole until stage 5 moves stagger itself.
   */
  /**
   * The tick, resolved ONCE — a Map hit at activation, never per frame. Containment is the
   * closure: a throwing tick is dead from that frame on and reported through the rejections
   * registry, so one bad tick costs its own element, never the page — and never a console storm,
   * because a per-frame throw would otherwise report per frame. A `setup`-carrying module gets
   * its lifecycle here too; the teardown runs from `clearElement`, so the engine's
   * rebuild-on-edit is the staleness story exactly as it was for property modules.
   */
  let tick: ((progress: number) => void) | null = null;
  let tickTeardown: (() => void) | null = null;
  const tickName = parsed.settings['tick'];
  if (typeof tickName === 'string') {
    const module = tickFor(tickName);
    if (!module) rejectFor('motion-tick-unknown', [tickName]);
    else {
      let dead = false;
      tick = (progress: number): void => {
        if (dead) return;
        try {
          module.tick(node as HTMLElement, progress);
        } catch (error) {
          dead = true;
          rejectFor('motion-tick-threw', [tickName, String(error)]);
        }
      };
      if (module.setup) {
        try {
          const off = module.setup(node as HTMLElement, parsed.settings, rejectFor);
          if (typeof off === 'function') tickTeardown = off;
        } catch (error) {
          dead = true;
          rejectFor('motion-tick-threw', [tickName, String(error)]);
        }
      }
    }
  }

  let generated: RuntimeElement['generated'] = null;
  let acquiredKeys: string[] = [];
  if (generatedCss) {
    /** Every seek variable — the base, plus a per-category one per inertia override.
     *  Transition mode has none: no variable, no registration, no drives. */
    for (const v of generatedCss.vars) ensureProperty(v.name, node);
    /** A TICK-ONLY element generated no CSS — zero groups, nothing to deliver — and rides this
     *  path for the drive machinery alone: the same chase, ramp and variable write, aimed at its
     *  function instead of a rule. */
    if (generatedCss.groups.length || generatedCss.mode === 'transition') {
      acquiredKeys = deliverGenerated(node, generatedCss);
      setTail('@media (scripting: none) { [data-vd-a] { animation: none; } }');
    }
    /**
     * The mark, AFTER acquire — the invariant. It is the observable "this element rides the
     * generated path": devtools reads it, the suites read it (jsdom drops the `animation`
     * shorthand, so the attribute is the honest surface there), and stage 6's rule-based
     * delivery will select on it.
     */
    node.setAttribute('data-vd-a', generatedCss.hash);
    /**
     * ARM the transition only after the BASE state is committed. Activation-time rule injection
     * is itself a style change, so longhands live at delivery would animate every element in
     * from its natural state (measured: 0.91 sampled en route to a 0.1 base). The forced read
     * here makes the engine resolve the un-armed base as its own style state; arming then adds
     * longhands with no value change, so nothing fires and no frame-race exists — a gate that
     * matches at activation still snaps to base first, exactly as a server-rendered page does
     * (which arrives pre-armed, its first paint already base).
     */
    if (generatedCss.mode === 'transition' && !node.hasAttribute('data-vera-t')) {
      void getComputedStyle(node as Element).transitionProperty;
      node.setAttribute('data-vera-t', '');
    }
    generated = {
      hash: generatedCss.hash,
      transition: generatedCss.mode === 'transition',
      geometric: parsed.animations.some((a) =>
        a.keyframes.some((f) => f.positionUnit !== '%') ||
        a.bands.some((b) => b.keyframes.some((f) => f.positionUnit !== '%'))),
      /** One driver slice per seek variable, each timed by ITS setting — `--vd-p-transform`
       *  chases at `transform-inertia`'s rate while the base follows `inertia`. */
      drives: generatedCss.vars.map((v) => ({
        driven: {
          node: node as HTMLElement, varName: v.name,
          written: null, target: 0, mode: 'idle' as const,
          tau: 0, rampFrom: 0, rampStart: 0, rampDuration: 0,
          /** The tick rides the BASE variable's writes — the author-visible number, after
           *  whatever chase or ramp is shaping it — never a per-category one. */
          tick: v.name === generatedCss.varName ? tick : null,
        },
        tau: Number(parsed.settings[v.inertiaKey] ?? settings.inertia),
      })),
      hashes: acquiredKeys,
      play: typeof parsed.settings['play'] === 'number' ? parsed.settings['play'] : null,
    };
  }
    const element: RuntimeElement = {
    node,
    parsed,
    plan,
    generated,
    restore,
    displaced,
    /** Both readings carry the correction, here and on every re-measure. */
    start: start + displaced,
    rangeStart: 0,
    rangeSize: 0,
    playing: parsed.settings['play'] !== undefined,
    progressProperty:
      typeof parsed.settings['progress'] === 'string' ? parsed.settings['progress'] : null,
    exitAt: null,
    end: end + displaced,
    size,
    lowestStart: 0,
    highestEnd: 1,
    unfinishable: false,
    pinBlocked: null,
    flatBlocked: null,
    /**
     * A stagger in anything but `%` moves with the viewport, exactly as a
     * position does — and a width band moves with it by definition.
     */
    geometryDependent:
      (parsed.stagger !== undefined && parsed.stagger.positionUnit !== '%') ||
      plan.all.some((a) => a.geometryDependent || a.bands.length > 0),
    timelinePosition: 0,
    runOnceRan: false,
    runOnce: parsed.settings['run-once'] === true,
    when: typeof parsed.settings['when'] === 'string' ? parsed.settings['when'] : null,
    tickTeardown,
    reject: rejectFor,
  };

  const win = getWindowSize(settings.scrollDirection, settings.scrollElement ?? window);
  refreshCurves(element, win);
  regenerateRules(element, win);
  markUnfinishable(element, win);
  element.pinBlocked = pinTrouble(element, settings);
  element.flatBlocked = flatTrouble(element, settings);

  /** Resolve the range NOW: an element that is never re-measured would otherwise carry a zero-width
   *  range and sit at position 0 for ever — every animation frozen at its first keyframe. */
  resolveRange(element, settings, win);

  return element;
};

/**
 * Evaluates every animation for the current timeline position and writes the
 * result. One evaluate per animation, one style write per category.
 */
export const animateElement = (element: RuntimeElement): void => {
  /**
   * The whole write path: hand every driver slice its target and let the drive loop (or the
   * idle write-through) land the number. CSS computes the pixels — the evaluate/compose/apply
   * loop that followed this branch for inline elements is DELETED with the inline path; there
   * is exactly one way an element animates now.
   */
  if (!element.generated) return;
  /**
   * Transition mode's paint IS the marker: position at the end → on, anywhere else → off. ONE
   * home for the toggle, so every caller's contract holds for free — the play block's crossing,
   * the gate's rest, and the run-once latch's force-repaint (which burned this in: the latch
   * short-circuits to animateElement alone, and a rebuilt latched element re-painted NOTHING
   * until the marker lived here).
   */
  if (element.generated.transition) {
    if (element.timelinePosition >= element.highestEnd) element.node.setAttribute('data-vera-on', '');
    else element.node.removeAttribute('data-vera-on');
    return;
  }
  for (const d of element.generated.drives) {
    syncTo(d.driven, element.timelinePosition, element.generated.play !== null ? 0 : d.tau);
  }
};


/**
 * Recomputes the timeline position from the current scroll window.
 *
 * 0 is where the element first begins entering the scroll window, 1 where it
 * has completely left. The old implementation quantised this to
 * 1/resolution steps purely so LUT indexing landed on an exact entry; with the
 * LUT gone there is no reason to, and the values are smoother for it.
 */
/**
 * Resolve the scroll range this element's percentages are measured across.
 *
 * An alignment is `"<edgeFraction> <viewportFraction>"`: the range reaches that end when the
 * anchor's edge sits at that place in the viewport. So the scroll offset for one end is
 * `anchorEdge - viewportPlace * viewportSize`, and the range is the span between the two.
 *
 * The defaults — `top bottom` and `bottom top` — reduce to `(scrollY + V - A) / (Ah + V)`, which is
 * the window this had before naming existed, so every animation already written keeps its meaning.
 */
const alignmentAt = (
  spec: string | undefined,
  fallback: [number, number],
  anchorStart: number,
  anchorSize: number,
  win: WindowSize
): number => {
  const [edge, place] = spec ? spec.split(' ').map(Number) : fallback;
  return anchorStart + (edge ?? 0) * anchorSize - (place ?? 0) * win.size;
};

/**
 * `scroll`'s two halves, or `undefined` for each one not given — which is what `alignmentAt` reads as
 * "use the default for this end".
 *
 * Stored as one normalised string because a setting's value is `string | number | boolean`; split
 * here rather than at parse time so the runtime holds exactly what the author wrote and the two ends
 * keep travelling together.
 */
const scrollHalves = (element: RuntimeElement): [string | undefined, string | undefined] => {
  const raw = element.parsed.settings['scroll'];
  if (typeof raw !== 'string' || raw === '') return [undefined, undefined];
  const [first, second] = raw.split(',');
  return [first || undefined, second || undefined];
};

export const resolveRange = (
  element: RuntimeElement,
  settings: RuntimeSettings,
  win: WindowSize
): void => {
  let anchorStart = element.start;
  let anchorSize = element.size;

  const selector = element.parsed.settings['anchor'];
  /**
   * `self` is the element's OWN transit, which is what a full-bleed section wants: measured against
   * the viewport, a section taller than the screen finishes its animation while most of it is still
   * visible. Spelled as a word rather than requiring the author to give their own element an id and
   * point at it.
   */
  if (selector === 'self') {
    const [first, second] = scrollHalves(element);
    const from = alignmentAt(first, [0, 1], element.start, element.size, win);
    const to = alignmentAt(second, [1, 0], element.start, element.size, win);
    element.rangeStart = from;
    element.rangeSize = to - from;
    element.exitAt = second === undefined ? null : to;
    return;
  }
  if (typeof selector === 'string' && selector !== '') {
    /** Resolved in the element's OWN root, so a component can anchor to its own section without
     *  reaching into the page — the same rule `path-selector` follows. */
    const root = element.node.getRootNode() as ParentNode;
    const found = root.querySelector?.(selector) as HTMLElement | null;
    if (found) {
      const box = getElementSize(found, settings.scrollDirection, settings.scrollElement);
      anchorStart = box.start;
      anchorSize = box.size;
    }
  }

  const [first, second] = scrollHalves(element);
  const from = alignmentAt(first, [0, 1], anchorStart, anchorSize, win);
  const to = alignmentAt(second, [1, 0], anchorStart, anchorSize, win);
  element.rangeStart = from;
  element.rangeSize = to - from;
  /** Only an AUTHORED second half is an exit — see `exitAt`. */
  element.exitAt = second === undefined ? null : to;
};

export const updateTimelinePosition = (element: RuntimeElement, win: WindowSize): void => {
  element.timelinePosition =
    element.rangeSize === 0 ? 0 : (win.start - element.rangeStart) / element.rangeSize;
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
  /**
   * **The latch is checked FIRST, above the gate.** `run-once` means played through and finished,
   * and a finished animation is not un-finished by its gate closing — measured here: with the gate
   * tested first, removing the class sent a latched element back to `opacity(0)`.
   *
   * A forced repaint paints what it latched *at* rather than recomputing from the current scroll
   * position — recomputing put a finished animation back to wherever the page happens to be
   * scrolled now. Measured: latched at `translateY(120px)`, scrolled back to the top, toggled off
   * and on, and it came back at `translateY(86.292px)`.
   */
  if (element.runOnce && element.runOnceRan) {
    if (force) animateElement(element);
    return;
  }

  /**
   * **`when` GATES; it no longer replaces the driver.** While the selector matches, the element
   * animates normally — scrubbing below, or playing if `play` is set. While it does not, it rests at
   * its authored start, which is what "not active" means and what makes the gate reversible.
   *
   * It used to replace the scroll driver outright, jumping the element end-to-end on a match. That
   * was one key answering two independent questions — under what condition is this active, and what
   * drives the progress — and one key cannot carry two orthogonal choices. `when: '.open', play: 0.6`
   * says the old behaviour out loud.
   */
  if (element.when && !element.node.matches(element.when)) {
    if (force || element.timelinePosition !== element.lowestStart) {
      element.timelinePosition = element.lowestStart;
      animateElement(element);
    }
    return;
  }

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
  /**
   * **A play does not scrub.** It walks the timeline end-to-end in one step when a threshold is
   * crossed and lets the transition (whose duration is `play`) take the time; a scrub tracks scroll
   * position continuously. Which is why `scroll`'s two halves mean different things in the two
   * modes and the same sentence covers both: *scroll names where the animation begins and ends —
   * scrubbing spreads it across that span, playing runs it at each end.*
   *
   * With ONE half there is one threshold, crossed both ways: in going down, out coming back up past
   * the same line. With two, the second is the exit — so an element can come in at 75% and leave
   * when its bottom clears 25%, and reverse symmetrically. `run-once` is the opt-out that latches
   * after the first forward play and never reverses.
   */
  if (element.playing) {
    const entered = win.start >= element.rangeStart;
    const exited = element.exitAt !== null && win.start >= element.exitAt;
    const target = entered && !exited ? element.highestEnd : element.lowestStart;
    if (!force && target === element.timelinePosition) return;
    /** The clock, armed before the bookkeeping below — `animateElement`'s sync then defers to
     *  it. Transition mode needs no clock at all: the marker flip in `animateElement` is the
     *  whole driver, and the platform owns the time. */
    if (element.generated && !element.generated.transition) {
      for (const d of element.generated.drives) rampTo(d.driven, target, element.generated.play ?? 0);
    }
    element.timelinePosition = target;
    animateElement(element);
    settings.onProgress?.(element.node, target);
    if (element.runOnce && target === element.highestEnd) {
      element.runOnceRan = true;
      emit(element.node, EVENTS.complete, target);
    }
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
  resolveRange(element, settings, win ?? getWindowSize(settings.scrollDirection, settings.scrollElement ?? window));

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
    const winNow = win ?? getWindowSize(settings.scrollDirection, settings.scrollElement ?? window);
    refreshCurves(element, winNow);
    regenerateRules(element, winNow);
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

const managedStyles = (_plan: ScreenPlan): string[] => [
  /** The inline write path is gone, so the instance's own writes are settings styles only —
   *  animated values live in generated CSS the teardown releases by key, never inline. */
  'will-change', 'transform-origin', 'position', 'top', 'inset-inline-start',
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
  element.tickTeardown?.();
  if (element.generated) {
    /** Count out, stop the clock, strip the marks — the loop must never hold a removed element. */
    for (const key of element.generated.hashes) release(key);
    for (const d of element.generated.drives) {
      dispose(d.driven);
      node.style.removeProperty(d.driven.varName);
    }
    node.style.removeProperty(STAGGER_PROPERTY);
    node.removeAttribute('data-vd-a');
    node.removeAttribute('data-vera-on');
    node.removeAttribute('data-vera-t');
  }
  /** The progress property too, or a torn-down element leaves a stale number behind for whatever
   *  CSS was reading it — visible as a bar frozen part-way rather than as nothing at all. */
  if (element.progressProperty) node.style.removeProperty(element.progressProperty);


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

  /** Last, so it lands on top of every removal above. */
  for (let i = 0; i < element.restore.length; i += 2) {
    node.style.setProperty(element.restore[i]!, element.restore[i + 1]!);
  }
  adopted.delete(node);
};

export { getWindowSize };
