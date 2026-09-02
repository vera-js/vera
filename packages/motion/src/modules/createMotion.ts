/**
 * The runtime. Creates, drives and tears down attribute-driven animations.
 *
 * A factory rather than a class: animation types are a discriminated union
 * rather than a hierarchy, every function is testable in isolation, and there
 * is no `this` to bind wrongly. The public surface is deliberately small —
 * everything else is attributes.
 */
import { getWindowSize, resolveScrollElement, forgetSticky, forgetDirection, standingDownAll } from './dom.js';
import { parseEasing, settings as liveSettings, properties as liveProperties } from './schema.js';
import { findElements, parseElement, forgetStagger } from './parse.js';
import type { RejectedElement, DroppedElement } from './parse.js';
import { ATTRIBUTE_PREFIX } from './namespace.js';
import { insert } from './schema.js';
import type { InsertMap } from './schema.js';
import { createRuntimeElement, updateElement, updateStateElement, resetElement, clearElement, setElementStyles, setTransitions, readRootFontSize, cascadeTrouble } from './runtime.js';
import { scrollListener, resizeListener } from './eventListeners.js';
import { createMutationObserver, observerOptions } from './observer.js';
import { createVisibilityTracker } from './visibility.js';
import { emit, EVENTS } from './events.js';
import { rejectionsFor, rejectedNodes, forgetRejections, pageProblems, reject } from './rejections.js';
import type { VisibilityTracker } from './visibility.js';
import { supports, supportsMutationObserver, prefersReducedMotion, prefersCoarsePointer, onReducedMotionChange, onCoarsePointerChange } from './supports.js';
import type { ParsedElement } from './parse.js';
import type { MotionElement, RuntimeElement, RuntimeSettings } from './runtime.js';

export interface MotionOptions {
  /** Axis the timeline runs along. */
  scrollDirection?: 'vertical' | 'horizontal';
  /** Window, or a selector for a scrolling container. */
  scrollElement?: Window | HTMLElement | string;

  /**
   * How much the element resists the position scroll says it should be at, in
   * seconds. `0` tracks scroll exactly.
   *
   * **The library calls this inertia and nothing else.** The same idea is
   * momentum, damping, smoothing, `scrub` or `lerp` in other tools; none of
   * those are names here. Inertia is the physically apt one: a property you
   * set that governs resistance to a change in motion, where momentum is an
   * instantaneous quantity you could not set as a constant.
   *
   * The default is small and deliberate. Its value is not aesthetic — it is
   * resilience. The catch-up is a CSS transition, which runs on the
   * compositor, so when the main thread misses a frame the element keeps
   * moving toward its last target instead of freezing for that frame. At `0` a
   * dropped frame is a visible stall; at `0.1` the compositor covers it.
   *
   * Measured by `spikes/ease.mjs`, at the default `inertia-ease` and a
   * constant-velocity scroll: it settles within **33ms** — two frames — and
   * trails an undamped element by **8px** on a 600px range mid-scroll, which
   * is only apparent side by side.
   *
   * Those replace "77ms" and "about a tenth of its range", which were quoted
   * here with no harness behind them and reproduce nowhere: a lag depends on
   * the scroll velocity it was taken at, and neither the velocity nor the
   * range was recorded with them.
   */
  inertia?: number;

  /**
   * Timing function of the inertia. Handed to CSS as the transition's timing
   * function; nothing in JS evaluates it.
   *
   * Because the target is rewritten every frame, only the first ~17% of the
   * curve is traversed, so this is really a stiffness control. Measured at
   * `inertia: 0.1`: `ease-in` trails by 113px mid-scroll, the default by 8px.
   */
  inertiaEase?: string;

  /**
   * Timing function of the **curve** — how value relates to scroll position.
   * `linear` by default, which is what the library has always produced.
   *
   * Distinct from `inertiaEase`, and it cannot be handed to CSS: a transition
   * runs on a timer and cannot ask where the scrollbar is, and the one CSS
   * mechanism that knows (`animation-timeline`) overrides transitions, so
   * using it would mean giving up inertia.
   */
  ease?: string;

  /**
   * Named viewport-width ranges, so `data-vm-opacity-mobile` means whatever
   * this site calls mobile.
   *
   * A name is only ever an alias for a range — the same range you could have
   * written inline as `[0-500]`. Register as `[min, max]`, with `null` for no
   * upper bound:
   *
   * ```js
   * createMotion({ breakpoints: { phone: [0, 500], wide: [1200, null] } })
   * ```
   *
   * This replaced a fixed `tablet`/`mobile` pair with two width options, which
   * meant a site could have exactly those two bands at exactly those two names
   * — and, because both options defaulted to null and null meant "off", the
   * suffixes did nothing at all unless configured in JavaScript.
   */
  breakpoints?: Readonly<Record<string, readonly [number, number | null]>>;

  respectReducedMotion?: boolean;
  willChange?: boolean;
  translateZFix?: boolean;
  transformOrigin?: string;


  /**
   * Where to look for animated elements — one node or an array of them, like
   * `wireMotion` takes one module or a list. `createMotion({ root: [nav, hero] })`
   * watches exactly those subtrees and nothing else: scoping is the
   * granularity control, and it is sugar over calling `observe()` per root.
   * Pass a ShadowRoot to drive a web component's internals —
   * `querySelectorAll` does not pierce shadow boundaries, so each root is
   * registered explicitly. Without it, the document is the one root.
   */
  root?: ParentNode | readonly ParentNode[];

  /** Watch for elements added or changed after init. */
  observeMutations?: boolean;

  /**
   * Leave everything un-animated where the primary input is a finger.
   *
   * Off by default, because most scroll animation is fine on a phone. It is
   * for the effects that are not: pinning fights momentum scrolling, wide
   * horizontal travel has nowhere to go, and heavy parallax costs most on the
   * devices least able to pay for it.
   *
   * Detected with `(pointer: coarse)` — the *primary input device*, not "does
   * this browser understand touch events", which a touchscreen laptop with a
   * trackpad also answers yes to. Watched rather than sampled, since an iPad
   * gaining a trackpad changes the answer mid-session.
   *
   * Behaves exactly like reduced motion: elements are still parsed, so
   * `enable()` can override without re-parsing, and content is left in its
   * natural readable state rather than frozen mid-animation.
   */
  disableOnTouch?: boolean;

  /**
   * Called with each element's timeline position, every frame it updates —
   * `0` as it begins entering the scroll window, `1` once it has fully left.
   *
   * For driving anything that is not a CSS property: a canvas, a WebGL scene,
   * a video's `currentTime`, an audio parameter. The library already computes
   * this number; without it you would have to redo the geometry to get it.
   *
   * A callback rather than an event, deliberately. At 200 elements a bubbling
   * `CustomEvent` per frame measures about 0.18ms against 0.002ms for a call —
   * about **6.6x the library's entire per-frame cost**, versus a tenth of it.
   * Both halves come from one run of `spikes/event-cost.mjs`, which times the
   * library's own frame on its own page for exactly this comparison. This said
   * "roughly 5x" — the fifth copy of a ratio taken from two runs of two
   * different harnesses, and the one the pass that corrected the other four
   * missed. The rare notifications (`vm:active`, `vm:idle`,
   * `vm:complete`) are events, where dispatch is free and delegation
   * is worth having.
   *
   * Values outside 0-1 are normal: keyframes may sit outside that range.
   */
  onProgress?: (node: HTMLElement, progress: number) => void;
}

export interface MotionInstance {
  init(): void;
  destroy(): void;

  /**
   * The editor preview switch. Disabling returns every element to its natural,
   * un-animated state rather than freezing it mid-transform, and re-enabling
   * picks up from the current scroll position. Parsed state is kept, so
   * toggling never re-parses.
   *
   * `enable()` is an explicit instruction and **overrides reduced motion**.
   * That is deliberate: an author who personally prefers reduced motion still
   * has to see the animations they are configuring for visitors. It is an
   * authoring-time escape hatch, not a default — a page that never calls it
   * stays still for a visitor who asked for less motion.
   */
  enable(): void;
  disable(): void;
  setEnabled(enabled: boolean): void;
  readonly enabled: boolean;
  /** True when the visitor asked for reduced motion and the instance is honouring it. */
  readonly reducedMotion: boolean;
  /** True when the primary input is a finger and the instance is honouring `disableOnTouch`. */
  readonly touchDisabled: boolean;

  /** Every attribute the runtime refused, with the element it was on. */
  readonly rejected: readonly RejectedElement[];
  /**
   * Re-scan the roots: add what is new, drop what has left, re-read the rest.
   *
   * It exists for markup a module has to *prepare* — split text is the case —
   * because rewriting the DOM from inside the observer's callback re-enters
   * it. Call this after rendering, the way `scroll-to.collect()` is called
   * after rendering a nav.
   *
   * It **drops** as well as adds, which it did not: with `observeMutations`
   * off, a removed element stayed in the list for the life of the page. And it
   * **re-reads**, which it also did not — `adopt` kept the parse it already
   * had, so with the observer off nothing on the page could pick up an edited
   * attribute at all.
   */
  collect(): void;
  /** Re-measure geometry after an external layout change. */
  refresh(): void;

  /** Register or drop an additional root, typically a component's shadow root. */
  observe(root: ParentNode): void;
  unobserve(root: ParentNode): void;

  /**
   * Every element this instance is animating. The type is `MotionElement` —
   * `node` plus `timelinePosition` — and that narrowness is load-bearing: it
   * is what lets the runtime's internal field names be mangled in production.
   * See the type's docblock before widening it.
   */
  readonly elements: readonly MotionElement[];
}

/**
 * Every one of our own attributes on a node, name and value, as one string.
 *
 * The whole of what `parseElement` reads off the element itself, which is what
 * makes it a fair test of "would a re-parse produce anything different".
 * Ordering follows the DOM's, which is insertion order and stable across a
 * value change — a re-set attribute keeps its place.
 */
const ownAttributes = (node: Element): string => {
  let out = '';
  for (const { name, value } of node.attributes) {
    if (name.startsWith(ATTRIBUTE_PREFIX)) out += `${name}=${value};`;
  }
  return out;
};

const DEFAULTS = {
  scrollDirection: 'vertical',
  /**
   * Deliberately **not** `window`.
   *
   * DEFAULTS is a module-scope object literal, so a `window` here is evaluated
   * the moment the module is imported — and `dist/motion.js` then threw
   * `ReferenceError: window is not defined` on import in any non-browser
   * environment. Not when used: on *import*, which is what an SSR framework
   * does while rendering on the server. `scroll-to` never had the bug, because
   * it resolves `?? window` inside its factory.
   *
   * `undefined` means "the window", resolved in `resolveScrollElement` once
   * someone actually calls `createMotion`.
   */
  scrollElement: undefined as Window | HTMLElement | string | undefined,
  inertia: 0.1,
  inertiaEase: 'cubic-bezier(0.33, 1, 0.68, 1)',
  /** Straight line, which is what the library has always produced. */
  ease: 'linear',
  /**
   * Sensible names out of the box, so the suffixes work with no JavaScript at
   * all. Override the whole map to use different names or different widths.
   */
  breakpoints: { mobile: [0, 640], tablet: [641, 1024] } as Readonly<
    Record<string, readonly [number, number | null]>
  >,
  respectReducedMotion: true,
  willChange: false,
  translateZFix: false,
  transformOrigin: '',
  observeMutations: true,
  disableOnTouch: false,
} as const;

/**
 * Wraps `onProgress` so a consumer's exception cannot take the instance down.
 *
 * Dropping it is a whole feature going quiet, so it is reported the way the
 * `onProgress` that was never callable already is: through `problem`, which
 * records **and** warns. It warned only, and a page that reads per-frame
 * progress and stops receiving it has no way to find out from the library —
 * the GUI renders `rejected` and cannot read a console.
 *
 * @param fn whatever the page passed, which may be anything at all
 * @param report records the reason where a GUI can read it
 * @returns a callback that reports once and then stops, or undefined
 */
const guarded = (
  fn: ((node: HTMLElement, progress: number) => void) | undefined,
  report: (reason: string) => void
): ((node: HTMLElement, progress: number) => void) | undefined => {
  if (typeof fn !== 'function') return undefined;
  let live = true;
  return (node: HTMLElement, progress: number): void => {
    if (!live) return;
    try {
      fn(node, progress);
    } catch (error) {
      live = false;
      report('onProgress threw, so it is being ignored from here on.');
      console.warn('@verajs/motion: the onProgress exception was:', error);
    }
  };
};

/**
 * The `breakpoints` option, checked the way an attribute's value already is.
 *
 * Every entry is `[min, max]` with `max` optionally null for an open end. It
 * was destructured unchecked, so a number where a pair belonged threw
 * `not iterable` out of `createMotion`; and a reversed or non-numeric pair
 * registered a name that no viewport width can satisfy, which makes every
 * attribute suffixed with it inert at every size, silently.
 *
 * A bad entry is dropped rather than the whole map: the other names are still
 * usable, and an attribute naming the dropped one is then reported as an
 * unknown attribute, which is the right thing to say about it.
 *
 * @param table whatever the page passed, which may be anything at all
 * @param report records the reason where a GUI can read it
 */
const usableBreakpoints = (
  table: Readonly<Record<string, readonly [number, number | null]>> | undefined,
  report: (reason: string) => void
): Map<string, { min: number; max: number }> => {
  const out = new Map<string, { min: number; max: number }>();
  /** `?? {}` because a JS caller can pass null, and `Object.entries(null)` throws. */
  for (const [name, range] of Object.entries(table ?? {})) {
    const pair = Array.isArray(range) ? (range as readonly unknown[]) : null;
    const min = pair ? Number(pair[0]) : NaN;
    const max = pair && pair[1] !== null && pair[1] !== undefined ? Number(pair[1]) : Infinity;
    if (!pair || !Number.isFinite(min) || Number.isNaN(max) || min > max) {
      report(__DEV__ ? `breakpoint ${JSON.stringify(name)} is not a usable [min, max]; ignoring it.` : `breakpoint ${JSON.stringify(name)}: not [min, max]`);
      continue;
    }
    out.set(name, { min, max });
  }
  return out;
};

/**
 * Every option name there is: the defaults, plus the two that have none.
 *
 * `root` and `onProgress` cannot sit in `DEFAULTS` — one has no sensible
 * default value and the other is a callback — so they are named here, and
 * audit rule 25 holds this set to `MotionOptions`.
 */
const KNOWN_OPTIONS = new Set([...Object.keys(DEFAULTS), 'root', 'onProgress']);

/**
 * Which instance is animating a given element, page-wide.
 *
 * Module-level, because the question spans instances and nothing else can see
 * across them — the same reason `modules/rejections.ts` holds its registry
 * here. A `WeakMap` so an element that leaves the document takes its entry with
 * it, and an opaque token per instance rather than the instance itself, which
 * would keep every one of them alive for the life of the page.
 */
const CLAIMED = new WeakMap<Element, object>();

/**
 * How many instances are currently animating this page.
 *
 * Module scope, so two instances on one page share it — which is the whole
 * point: it is what lets core fire the `forget` insert on the transition to
 * **zero**, the one question a module cannot answer about itself. A module
 * holding page-level state has no way to know whether some other instance is
 * still running, and guessing wrong empties a table whose numbers another
 * instance's curves still hold.
 *
 * Counted per instance rather than derived from `started`, because an
 * instance that never started, or one destroyed twice, must not move it — see
 * the `counted` flag inside.
 */
let liveInstances = 0;

/**
 * Creates an animation instance.
 *
 * Nothing happens until `init()` — construction only resolves options, so an
 * instance can be made before the DOM it will drive exists. Everything the
 * instance owns is torn down by `destroy()`.
 *
 * @param options overrides for the defaults above; every one is optional
 * @returns the instance, whose surface is documented on `MotionInstance`
 */
export const createMotion = (options: MotionOptions = {}): MotionInstance => {
  /**
   * An option present with the value `undefined` means **not given**, not "off".
   *
   * `{ ...DEFAULTS, ...options }` lets an explicit `undefined` win, and for a
   * boolean whose default is `true` that inverts it: `respectReducedMotion:
   * undefined` produced `enabled === true` on a device asking for reduced
   * motion, and reported nothing. `observeMutations` is the same shape, and so
   * are `manageFocus` and `cancelOnUserInput` on the other entry point. The
   * public `reducedMotion` getter, typed `boolean`, returned `undefined`.
   *
   * `{ respectReducedMotion: config.respect }` with the key absent from
   * `config` is how generated code is written, which is exactly what a GUI editor emits.
   * `exactOptionalPropertyTypes` makes TypeScript refuse the literal, so this
   * is the JavaScript audience again — and it is the one case in that set where
   * being wrong turns an accessibility preference off.
   *
   * Not reported: `undefined` is how JavaScript spells "unset", so there is
   * nothing to tell anyone. `inertia: undefined` used to be reported as "not
   * usable" and is now simply the default, which is the same answer arrived at
   * honestly.
   */
  const settings = { ...DEFAULTS, ...options };
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined && key in DEFAULTS) {
      (settings as Record<string, unknown>)[key] = (DEFAULTS as Record<string, unknown>)[key];
    }
  }

  /**
   * Problems with the configuration itself, which have no element to hang on.
   *
   * They went to the console alone, and the console is the one place the
   * GUI editor cannot look — while being the thing most likely to write a bad
   * option, because it generates them. `scroll-to` has reported its own
   * configuration through `rejected` since it gained diagnostics; this is the
   * same contract on the other entry point, and the reason
   * `RejectedElement.node` is now nullable.
   *
   * Warning *and* recording, not one or the other: a developer with devtools
   * open should not have to read an array, and a GUI cannot read a console.
   */
  /** This instance's identity in `CLAIMED`, and nothing else. */
  const owner = {};

  /**
   * Whether the page wants animation at all, as distinct from whether it is
   * running. Set by `enable()` and `disable()` before `init()`, when there is
   * nothing yet to turn on or off but the answer is still an answer.
   */
  let wanted = true;

  const configProblems: string[] = [];
  const problem = (reason: string): void => {
    configProblems.push(reason);
    console.warn(`@verajs/motion: ${reason}`);
  };

  /**
   * An option this library does not have.
   *
   * Every *value* was already checked and every bad one reported — and the key
   * itself was not, so `createMotion({ intertia: 0.4 })` ran on the default and
   * said nothing at all. That is the exact asymmetry this codebase refuses one
   * level down: an attribute nobody registered is reported as unknown, on the
   * element, with its name. An option nobody declared was not.
   *
   * TypeScript catches it, which decides the audience rather than excusing it:
   * a GUI editor generates these objects server-side, the demo pages are plain
   * JavaScript, and the GUI that would show the answer is the one that cannot
   * read a console.
   *
   * `KNOWN` is `DEFAULTS` plus the two options that have no default — audit
   * rule 25 checks that against `MotionOptions` itself, because a hand-written
   * copy of an interface's members is the drift this repository keeps finding
   * (the drift every hand-held copy of a live table shows), and here it would fail *closed*: a new option
   * would be reported as not existing.
   */
  for (const key of Object.keys(options)) {
    if (!KNOWN_OPTIONS.has(key)) {
      problem(__DEV__ ? `createMotion was given "${key}", which is not an option this library has.` : `"${key}": unknown option`);
    }
  }

  /**
   * A boolean option that is not a boolean.
   *
   * `disableOnTouch: 'no'` is truthy, so it turned animation **off on every
   * touch device** — the opposite of what was written, silently, in the option
   * most likely to be filled in from a config string. `observeMutations: 'no'`
   * and `manageFocus: 'no'` are the same shape.
   *
   * This library already refuses exactly this one level down: `run-once="yes"`
   * used to come out **off** and is now reported, on the argument that being
   * wrong about a boolean is quiet in a way being wrong about a number is not —
   * nothing looks broken, the behaviour is just inverted. The *option* path
   * never got the same treatment, and it is the one a GUI and a PHP template
   * write into.
   *
   * Derived from `DEFAULTS` rather than from a list of names, so a new boolean
   * option is covered by existing: the same reason `KNOWN_OPTIONS` is built
   * that way (hand-held copies of a live table drift).
   */
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (typeof fallback !== 'boolean') continue;
    const given = (options as Record<string, unknown>)[key];
    if (given === undefined || typeof given === 'boolean') continue;
    problem(__DEV__ ? `${key} must be true or false, not ${JSON.stringify(given)}; using ${fallback}.` : `${key}: not a boolean; using ${fallback}`);
    (settings as Record<string, unknown>)[key] = fallback;
  }

  /**
   * Runs one insert point's chain, and keeps going if a link throws.
   *
   * The chain is the point: two modules commonly register the same point, and
   * a throwing one used to stop every module wired after it. `split` and
   * `sequence` both register `teardown`, so a third module throwing there left
   * a split paragraph in pieces after `destroy()` and a sequence holding its
   * decoded frames — the exact failure the chain was introduced to prevent,
   * arriving by a different route. On `prepare` it was worse: the exception
   * left `init()` with no element adopted, after `split` had already rewritten
   * the DOM, so the page had split text and no animation at all.
   *
   * Said once for the whole page, like the easing warning. A module that
   * throws in `release` throws once per element, and five hundred identical
   * lines is not five hundred times the information.
   *
   * Inside the instance so it can reach `problem`, which is the difference
   * between a module failure a developer with devtools open can see and one
   * the GUI can. It was module-scope and console-only: a wired module that
   * threw in `prepare` left the page unsplit, undrawn, or unprepared, and
   * `rejected` — the list the README sends people to — said nothing at all.
   * `warnedInsert` being per instance rather than per page falls out of the
   * move, and is the more useful of the two.
   *
   * @param point which chain to run
   * @param args passed to every function on it
   */
  let warnedInsert = false;
  const runInserts = (point: keyof InsertMap, ...args: readonly unknown[]): void => {
    for (const fn of insert(point)) {
      try {
        (fn as (...rest: readonly unknown[]) => void)(...args);
      } catch (error) {
        if (!warnedInsert) {
          warnedInsert = true;
          problem(__DEV__ ? `a wired module threw in ${point}; the rest of the chain still ran.` : `module threw in ${point}`);
          console.warn('@verajs/motion: the module exception was:', error);
        }
      }
    }
  };

  /**
   * The same options, checked the way the attributes carrying them already are.
   *
   * An attribute goes through the schema — `inertia-ease` is validated by
   * `parseEasing`, `inertia` is range-checked — and the option of the same name
   * went through nothing. That asymmetry did not merely go unreported: it broke
   * the feature. `inertiaEase: 'wobble'` builds `transition: transform 0.3s
   * wobble`, which the CSSOM **refuses**, so the inline transition stays empty
   * and inertia does nothing at all. `inertia: NaN` — `parseInt` of a config
   * string — reaches the same place by a different road. Measured in Chromium
   * both ways: computed `transitionDuration` of `0s` where a working instance
   * has `0.3s`.
   *
   * Falling back to the default is the point rather than the warning. A typo
   * that costs you the library's headline feature, silently and permanently,
   * is a worse outcome than one that costs you your chosen easing curve.
   *
   * happy-dom accepts the invalid declaration, so none of this is visible
   * there — it is the regression net, never the oracle, for anything the
   * platform decides.
   */
  if (options.onProgress !== undefined && typeof options.onProgress !== 'function') {
    problem('onProgress is not a function; ignoring it.');
  }

  /**
   * `CSS.supports`, because the engine is the parser — the same reasoning the
   * paint module gives for not hand-writing one.
   *
   * Behaviour was already safe: an unusable value is refused by the CSSOM, so
   * the element animated around its default origin rather than around a broken
   * one. What was missing is the *saying so*, which is the whole 40 bytes —
   * the difference between an option that quietly does nothing and a line
   * naming it. A half-validated options object is worse than either extreme,
   * because it invites the next reader to assume the rest are checked.
   *
   * **happy-dom returns `true` from `CSS.supports` for invalid values**, so
   * this can only be tested in a browser; `spikes/` measurements are in the
   * commit. Recorded in the audit while it was open.
   */
  if (settings.transformOrigin && typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('transform-origin', settings.transformOrigin)) {
    problem(`transformOrigin ${JSON.stringify(settings.transformOrigin)} is not usable; ignoring it.`);
    settings.transformOrigin = '';
  }

  const inertiaBounds = liveSettings().find((setting) => setting.attribute === 'inertia');
  for (const name of ['ease', 'inertiaEase', 'inertia'] as const) {
    const value = settings[name];
    /**
     * An easing is a string and checked as one; the other two are numbers.
     *
     * **Against the range the schema declares for the same name**, not merely
     * against `Number.isFinite`. `inertia` is an option *and* an attribute, and
     * the attribute has been range-checked since the rewrite — so
     * `data-vm-inertia="-1"` was refused and reported while
     * `createMotion({ inertia: -1 })` was accepted in silence and produced no
     * transition at all, which is `inertia: 0` reached by a sign error with
     * nothing said. `4000` went the other way and wrote `transition: transform
     * 4000s` past a documented ceiling of 3600.
     *
     * Read from the live registry rather than written out again here, for the
     * reason every other list in this repository is (principle #5): a second
     * copy of a bound is a copy that drifts.
     */
    const inRange = (n: number): boolean =>
      (inertiaBounds?.min === undefined || n >= inertiaBounds.min) &&
      (inertiaBounds?.max === undefined || n <= inertiaBounds.max);
    const usable = typeof value === 'string'
      ? parseEasing(value) !== null
      : Number.isFinite(value) && inRange(value as number);
    if (usable) continue;
    /**
     * `JSON.stringify(NaN)` is `"null"`, so `inertia: NaN` — which is what
     * `parseInt` of a config string gives you, and the case this loop exists
     * for — reported "inertia null is not usable" and sent the reader looking
     * for a null they had not written. Quoted for a string, plain otherwise.
     */
    const shown = typeof value === 'string' ? JSON.stringify(value) : String(value);
    problem(`${name} ${shown} is not usable; using ${DEFAULTS[name]}.`);
    (settings as Record<string, unknown>)[name] = DEFAULTS[name];
  }

  /**
   * The one option whose value is a *table*, and the last one going unchecked.
   *
   * `[min, max]` was destructured straight out of it, so
   * `breakpoints: { mobile: 640 }` threw `number 640 is not iterable` out of
   * `createMotion` and took the page with it — a raw TypeError naming nothing
   * the caller wrote, from the option a GUI is most likely to generate. A
   * reversed pair (`[900, 100]`) or a non-numeric one was accepted instead,
   * and registered a name no viewport can ever match: every attribute using it
   * was silently inert at every width.
   */
  if (settings.scrollDirection !== 'vertical' && settings.scrollDirection !== 'horizontal') {
    problem(__DEV__
      ? `scrollDirection ${JSON.stringify(settings.scrollDirection)} is not 'vertical' or ` +
        "'horizontal'; using vertical."
      : `scrollDirection ${JSON.stringify(settings.scrollDirection)}: using vertical`);
    settings.scrollDirection = 'vertical';
  }

  /**
   * A malformed selector throws from querySelector. That is a developer typo
   * rather than untrusted input, but a raw DOMException out of the factory is
   * a poor way to report it — and the library's posture everywhere else is to
   * degrade with an explanation rather than break.
   */
  const scrollElement = resolveScrollElement(settings.scrollElement, problem);

  const runtimeSettings: RuntimeSettings = {
    scrollDirection: settings.scrollDirection,
    scrollElement,
    inertia: settings.inertia,
    inertiaEase: settings.inertiaEase,
    ease: settings.ease,
    /**
     * Only if it is callable, and only until it throws.
     *
     * `settings.onProgress?.(node, progress)` guards against *absent*, not
     * against present-and-not-a-function — so a non-function threw
     * `settings.onProgress is not a function` out of `init()`, taking the whole
     * instance with it. That is the one option whose value is invoked rather
     * than read, and the library's posture everywhere else is to degrade with
     * an explanation rather than break.
     *
     * A callable that *throws* had exactly that consequence and was not
     * guarded: the exception left `init()`, so every element on the page went
     * unanimated and the consumer's own script stopped at the `init()` call —
     * over a bug in a callback about one element's progress. Dropped on the
     * first throw rather than caught per frame, because a callback that threw
     * once will throw sixty times a second, and the non-function case above
     * drops it too.
     */
    onProgress: guarded(options.onProgress, problem),
    translateZFix: settings.translateZFix,
    willChange: settings.willChange,
    transformOrigin: settings.transformOrigin,
  };

  /** Names resolve to ranges once, here, so nothing downstream sees a name. */
  /** Diagnostics for elements dropped whole; see MotionInstance.rejected. */
  const dropped: DroppedElement[] = [];

  const parseContext = {
    dropped,
    /**
     * `?? {}` because a JS caller can pass null, and `Object.entries(null)`
     * throws "Cannot convert undefined or null to object" — an error naming
     * nothing the caller wrote. TypeScript rejects it, so this is for everyone
     * else. `{}` is also the supported way to register no names at all.
     */
    breakpoints: usableBreakpoints(settings.breakpoints, problem),
    /** What an element inherits when it writes no `inertia` of its own. */
    inertia: settings.inertia,
  };

  /**
   * Something that can actually be scanned.
   *
   * `root` is typed `ParentNode`, and the consumer of this library is a
   * WordPress plugin whose JavaScript is generated by PHP — there is no
   * compiler between that and here. A string, which is what `scrollElement`
   * accepts and so the obvious thing to try, threw `root.querySelectorAll is
   * not a function` **out of `init()`**, taking the page's own script down with
   * it. `observe()` was worse: it added the value to `roots` and then threw, so
   * one bad call left the instance poisoned — every later `collect()` and the
   * `destroy()` threw on the same value.
   *
   * Reported and refused, which is what every other bad option gets. Not
   * coerced from a selector: `scrollElement` resolves one because a page's
   * scroller is often known only by selector, while a root is a node the caller
   * already has.
   */
  const usableRoot = (root: unknown): root is ParentNode =>
    typeof (root as ParentNode | null)?.querySelectorAll === 'function';

  /**
   * One or many. A junk single value is reported and the document takes over;
   * a junk *entry* in an array is reported by position and skipped, and losing
   * every candidate falls back to the document rather than to an instance that
   * silently watches nothing.
   */
  if (options.root !== undefined && !Array.isArray(options.root) && !usableRoot(options.root)) {
    configProblems.push(__DEV__ ? 'root is not an element or document; falling back to the document' : 'root unusable; using document');
  }
  const givenRoots: ParentNode[] = Array.isArray(options.root)
    ? options.root.filter((entry, index) => {
        if (usableRoot(entry)) return true;
        configProblems.push(`root[${index}] is not an element or document; skipped`);
        return false;
      })
    : usableRoot(options.root)
      ? [options.root]
      : [];
  /**
   * The default root is the document — **where there is one**. Construction is
   * documented as doing nothing until `init()`, precisely so an instance can
   * be made before the DOM it will drive exists; reaching for `document` here
   * threw `document is not defined` out of an SSR render, from a constructor
   * whose whole contract is that it touches nothing. With no document there
   * is nothing to scan and `init()` returns early through `supports()`, so an
   * empty root set is the honest representation of that.
   */
  const fallbackRoot: readonly ParentNode[] = typeof document === 'undefined' ? [] : [document];
  const roots = new Set<ParentNode>(givenRoots.length > 0 ? givenRoots : fallbackRoot);

  /**
   * Whether a node is this instance's to touch.
   *
   * Three places asked it and each wrote the loop out: `destroy()`, deciding
   * which nodes a module's `teardown` may put back; `collect()`, deciding what
   * has left; and `rejected`, deciding whose refusals to report. Wiring is
   * page-level and instances are not, so the answer is the boundary between
   * them — one definition, or the next place to need it writes a fourth.
   *
   * The root itself counts: `observe(node)` on an element makes that element
   * ours as much as its descendants.
   */
  const inRoots = (node: Node): boolean => {
    for (const root of roots) if (root === node || root.contains(node)) return true;
    return false;
  };
  let elements: RuntimeElement[] = [];
  /**
   * Node -> element, kept alongside the array.
   *
   * The mutation handlers used `findIndex` and `includes` over the whole list,
   * once per changed node, so a batch cost O(elements x changed). In an editor
   * — the environment mutations actually come from — that is a few hundred
   * elements against a few dozen mutations, repeatedly. Principle #4 asks work
   * to scale with element count, not with the page.
   */
  /**
   * Attribute names that mean "this element animates", rebuilt per scan because
   * a module registers its properties at runtime — `frame` arrives with
   * `@verajs/motion/sequence`, the paint properties with `@verajs/motion/paint`.
   */
  const animatableNames = (): Set<string> =>
    new Set(liveProperties().map((property) => `${ATTRIBUTE_PREFIX}-${property.attribute}`));

  const byNode = new Map<Element, RuntimeElement>();
  /**
   * What each node's parse was read from, so `collect()` can tell whether it
   * still holds. A `WeakMap` because it is keyed by node and outlives nothing.
   */
  const signatures = new WeakMap<Element, string>();
  let enabled = false;
  let started = false;
  /** Whether this instance is currently counted in `liveInstances`. */
  let counted = false;
  let reducedMotion = false;
  let touchDisabled = false;
  /**
   * Whether the instance is still taking its cue from the media queries.
   *
   * `enable()` and `disable()` are explicit instructions and end it. Without
   * this the resolver read only `enabled`, so a preference that changed twice
   * walked straight over either call: an author previewing under their own
   * reduced-motion setting lost the preview the second time the preference
   * moved, and a GUI that had paused with `disable()` found the page animating
   * again. The comment on the resolver has always said an explicit call wins;
   * this is what makes that true.
   */
  let following = true;

  const teardown: Array<() => void> = [];
  /**
   * Elements a `vm:active` has been dispatched for and no
   * `vm:idle` since. The pair has to balance across everything that
   * stops the instance, not only across what the tracker happens to report.
   */
  const announced = new Set<RuntimeElement>();
  /**
   * One `MutationObserver` per root, not one shared across all of them.
   *
   * A `MutationObserver` has no per-target unobserve, so a single shared one
   * can only stop watching a root by disconnecting and re-observing every
   * other — which is O(roots) on a call that happens once per component. A
   * closed shadow root cannot be discovered from outside, so a framework built
   * on them hands every root over individually: Vera does exactly that through
   * its `'init'` insert, `element._root` for the reference and
   * `element._cleanups` for the matching `unobserve`. The number of calls is
   * the number of components.
   *
   * Measured before this: **779ms to mount 400 components and 478ms to unmount
   * them**, against 5.4ms for the same 400 elements in one tree. One observer
   * each makes both O(1) — `watch` adds, `unwatch` disconnects, and neither
   * touches any other root. `spikes/roots-cost.mjs`.
   *
   * The cost is one observer object per root and, when several roots mutate in
   * the same turn, one callback each rather than one merged one. The work is
   * the same records either way, and each callback is already scoped to the
   * root it came from.
   */
  const watchers = new Map<ParentNode, MutationObserver>();
  /** Whether this instance watches at all — `observeMutations`, and support for it. */
  let watching = false;

  /**
   * Elements adopted but not yet painted, and whether a paint is queued.
   *
   * **Adoption is synchronous; painting is not.** Adopting an element reads its
   * geometry and painting one writes style, so doing both in each call put a
   * write between one call's reads and the next call's — and every call after
   * the first forced a full layout. Measured directly: 400 `offsetParent`
   * walks cost **0.2ms** with layout clean and **277ms** with one style write
   * between each, which is 89% of what a CPU profile of the mount was spending.
   *
   * Deferring the *writes* rather than the whole adoption keeps
   * `instance.elements` correct the moment `observe()` returns, which is what a
   * caller can actually observe. What lands a microtask later is the
   * configuration styles — `will-change`, `transform-origin`, `offset-path`,
   * and the `position: sticky` a `pin` writes — and the first value. A
   * microtask runs before paint, so nothing is ever visible un-animated.
   *
   * This is principle #2 — read then write — held **across calls** rather than
   * only within a loop, which is the one place the three fixes of 2026-08-31
   * did not reach.
   */
  const unpainted = new Set<RuntimeElement>();
  let painting = false;

  const paintPending = (): void => {
    painting = false;
    if (!unpainted.size) return;
    const list = [...unpainted];
    unpainted.clear();
    /**
     * **No `enabled` test here.** There were three — one when the paint is
     * queued, one in `clear()`, and one here — and no single removal was
     * observable, so the mutation suite reported each as untested behaviour and
     * was right to. Two cover the whole gap between them: nothing is queued
     * while disabled, and anything already owed is dropped by `clear()`, which
     * `disable()` and `destroy()` both run. A third guard that cannot be tested
     * is a line the next reader deletes as dead, and they would be correct.
     *
     * The one inside the loop below is a different question — it is about
     * `onProgress` tearing the instance down mid-pass.
     */
    /** The read first, then every write — the same order, one level up. */
    const win = getWindowSize(settings.scrollDirection, scrollElement);
    for (const element of list) setElementStyles(element, runtimeSettings);
    queueTransitions(list);
    for (const element of list) {
      if (!enabled) return;
      if (element.when) updateStateElement(element, true, runtimeSettings);
      else updateElement(element, win, runtimeSettings);
    }
  };

  const queuePaint = (): void => {
    if (painting) return;
    painting = true;
    queueMicrotask(paintPending);
  };

  /**
   * Paint now, for a caller that is already one batch.
   *
   * `init()` and `collect()` read every element and then write every element,
   * so finishing the writes before returning costs one layout and no more —
   * there is no *next* call whose reads they could sit in front of. They stay
   * fully synchronous, which is what they have always been and what seven tests
   * assert about `pin`, `will-change` and `transform-origin`.
   *
   * `observe()` is the one that cannot: a framework hands roots over one call
   * per component, and the writes at the end of each are precisely what made
   * the next one's reads force a layout.
   *
   * **Styles only, and before `start()`.** Both callers run a full pass
   * immediately afterwards, so repeating the value update here would evaluate
   * every `when` selector a second time and write nothing — which is wasted
   * work in a browser and poisons happy-dom's `matches` cache, the artifact
   * that cost a morning when `applyChanges` did the same thing on 2026-08-31.
   */
  const paintNow = (): void => {
    if (!unpainted.size || !enabled) return;
    for (const element of unpainted) setElementStyles(element, runtimeSettings);
    unpainted.clear();
  };

  let visible: VisibilityTracker | null = null;
  /**
   * Watches each animated element's own box.
   *
   * The `ResizeObserver` on the document element catches a reflow that changes
   * the page's height, and the `load` listener catches everything still
   * arriving at first paint. Neither sees an element whose box changes *after*
   * load inside a container that does not itself resize: an accordion's open
   * transition, a lazy image below the fold, a font swapping, an embed sizing
   * itself. Measured in Chromium — an element grown from 100px to 700px by a
   * CSS animation kept its cached size of 100 and painted `opacity(0.698)`
   * where 0.5 was right, for the rest of the page's life.
   *
   * It is the same observer, not a second one, and elements join and leave it
   * exactly where they join and leave the visibility tracker.
   *
   * Cost: not measurable. `spikes/resize-cost.mjs` cannot separate this from
   * its absence — alternated in one sitting the two overlap at every size, and
   * its own spread is wider than any difference either way. The commit that
   * added this quoted a 0.42-to-0.49ms figure as though it were a result; it
   * was one run against a remembered number, which is the thing that harness
   * now prints a warning about.
   */
  let boxes: ResizeObserver | undefined;

  /**
   * Give up this instance's claim on a node.
   *
   * Only its own: another instance's claim is not this one's to drop. Called
   * from `drop()` and from `destroy()`, and deliberately **not** from
   * `clear()` — `disable()` and the reduced-motion toggle both clear, and both
   * keep `elements`, re-styling them on the way back without re-adopting. An
   * instance that is not writing right now still owns what it holds, and a
   * claim released there would never be taken again.
   */
  const unclaim = (node: Element): void => {
    if (CLAIMED.get(node) === owner) CLAIMED.delete(node);
  };

  /** The one place an element joins the instance, so the index cannot drift. */
  const add = (element: RuntimeElement): RuntimeElement => {
    /**
     * Two live instances animating one element.
     *
     * Both adopt it, both write its style every frame, and `destroy()` on
     * either strips what the other owns — silently, with an empty `rejected` on
     * both. The docs have called the configuration unsupported, which is not
     * the same as detected, and the README a consumer reads never mentioned it
     * at all. Two plugins on one WordPress page each calling `createMotion()`
     * is the way it happens.
     *
     * **Per element, not per root.** A root-overlap test at `init()` would
     * accuse two instances that share a document and no elements, which is most
     * of this repository's own tests and none of the bug. This fires only when
     * a second live instance actually adopts a node another one holds, which is
     * the thing that goes wrong.
     *
     * The claim is released in `drop()`, the matching "one place an element
     * leaves it". Missing that would be worse than saying nothing: an
     * `init()` / `destroy()` / `init()` on the same page would accuse itself.
     */
    const held = CLAIMED.get(element.node);
    if (held && held !== owner) {
      reject(
        element.node,
        __DEV__
          ? 'another createMotion() instance is already animating this element; both write its style ' +
            'every frame and either one destroy() strips the other. Use one instance, or give each its own root.'
          : 'two instances animate this element'
      );
    }
    /**
     * The **latest** adopter holds the claim, not the first.
     *
     * Keeping the first one looks equivalent and under-reports by one step: A
     * and B both animate an element, B is told, then A is destroyed. B is still
     * animating, holding nothing, so a third instance arriving after that is
     * told nothing at all — the silence this whole check exists to end,
     * reachable by destroying instances in the order a page actually would.
     *
     * Handing it over instead means `unclaim` finds someone else's token and
     * leaves it alone, which is exactly what its guard is for.
     */
    CLAIMED.set(element.node, owner);
    elements.push(element);
    byNode.set(element.node, element);
    boxes?.observe(element.node);
    return element;
  };

  /** The one place an element leaves it. */
  /**
   * Removes an element from the runtime's own bookkeeping.
   *
   * Deliberately does **not** run the `release` chain. `applyChanges` drops an
   * element in order to re-parse it, and telling a module "this is going away"
   * at that moment is false — `@verajs/motion/split` heard it, put the
   * paragraph back together, `prepare` split it again, and the two chased each
   * other until the process ran out of memory. Releasing is a narrower act
   * with two callers below.
   */
  const drop = (element: RuntimeElement): void => {
    unclaim(element.node);
    byNode.delete(element.node);
    visible?.unobserve(element);
    boxes?.unobserve(element.node);
    /**
     * And out of the announced set, which is otherwise the one place a removed
     * element is still held: it is a strong reference to the runtime element
     * and through it to a detached node, kept until the next `clear()`. An
     * editor removing blocks all afternoon never calls one.
     *
     * **Retention only, and not observable from outside.** The obvious way to
     * catch this — leave it in the set and watch for an extra `idle` on the
     * next `disable()` — cannot work: the event is dispatched on the removed
     * node, and a detached node has no parent chain, so it reaches no listener
     * on `document` however much it bubbles. A mutation planted here survives
     * the suite for that reason, and one was: it is not in the table, and it
     * should not be added back without something that can see the difference.
     *
     * No `idle` here either. `drop()` runs on re-parse as well as removal —
     * the distinction the `release` chain rests on — and an
     * element being re-parsed has not stopped animating.
     */
    announced.delete(element);
  };

  /**
   * Scans every root and adopts what it finds.
   *
   * `prepare` runs first, per root, so a module can change the DOM before the
   * runtime reads it — `@verajs/motion/split` rewrites a paragraph into pieces
   * there, and the ordinary scan then finds them like any hand-written
   * element. Nothing downstream knows the difference.
   *
   * Roots can overlap, so the same element can come back from more than one
   * scan. `adopt` is what stops it being registered twice — there is no second
   * guard here on purpose. One was tried, and a `Set` of already-scanned nodes
   * could not be made to change any outcome: `parseAll` has already done the
   * parsing by the time it would be consulted, so it saved no work, and
   * `adopt` returns the existing element regardless. Two guards for one
   * invariant means the mutation suite can delete either and stay green, which
   * is precisely how a guard rots without anyone noticing.
   */
  let prepared = false;

  const collect = (): void => {
    if (enabled) prepared = true;
    /**
     * Yesterday's reasons go before today's reading.
     *
     * `collect()` re-parses everything in its roots and modules re-`prepare`
     * them, so every refusal about a node in a root is about to be recomputed
     * — and the old ones survived. An element whose attribute was a typo at
     * `init()` and has since been corrected, or one whose property was
     * unknown because its module had not been wired yet, animated perfectly
     * while `rejected` went on reporting the mistake. That is the failure
     * `applyChanges` fixed for the mutation path; this is the same failure on
     * the path a page drives by hand.
     */
    for (const node of rejectedNodes()) if (inRoots(node)) forgetRejections(node);
    /** A stagger index is a fact about the DOM as it is now — see `forgetStagger`. */
    forgetStagger();

    /**
     * A **re-read**, not an add.
     *
     * `adopt` returns the element it already holds and discards the fresh
     * parse — right, and the reason two overlapping roots cannot register one
     * element twice. But it also meant `collect()` could not see a changed
     * attribute at all, so with `observeMutations: false` nothing could: the
     * option existed and left the page no way to update an element it had
     * already adopted.
     *
     * `reparse` is what re-reads a node, and it is the mutation observer's own
     * path — it drops, re-parses, re-adopts, carries the `run-once` latch
     * across, regroups staggers whose indices moved, and prunes the
     * diagnostics for the batch. Handing it every marked node in the roots
     * makes the two paths one, which is the point: a page driving this by hand
     * gets what the observer gives, rather than a second implementation of it
     * that is subtly less.
     *
     * The painting half stays behind: every caller of `collect()` follows with
     * `start()`.
     *
     * Only what actually changed, though. A re-parse re-measures, and
     * measuring is the expensive half: re-reading everything costs **78ms at
     * 5,000 elements** against 9.7ms for the comparison alone. What a parse
     * depends on is cheap to compare — this element's own attributes, plus the
     * stagger context, which is the one input that lives somewhere else.
     *
     * The figure was **4.0 seconds** when this was written, which is what a
     * quadratic in `clearElement` cost rather than what a re-read costs;
     * `spikes/teardown-cost.mjs` is that story. The comparison earns 8x now
     * rather than 400x, and still earns it on a call a page makes after every
     * render. Measured in `spikes/collect-cost.mjs`.
     */
    /**
     * A **set**, because roots may overlap: `observe()` on a node already
     * inside `document` scans everything under it twice. The parse path dedupes
     * again, so the consequence here was not a double registration but a double
     * count — the stagger counter below walks `found` in order, and a node seen
     * twice shifted the index of every element after it, which is a signature
     * mismatch and a re-read nothing asked for.
     */
    /**
     * A root whose host has left the document is dropped.
     *
     * `roots` was only ever added to by `observe()` and removed from by
     * `unobserve()`, and a detached `ShadowRoot` still answers
     * `querySelectorAll` — so a component that unmounted without calling
     * `unobserve` left its root scanned on every `collect()` and its elements
     * updated every frame, for the life of the page. Its elements passed the
     * `inRoots` test below, which is what stops the prune from reaching them:
     * the same "strong reference to a detached subtree, updated every frame"
     * this function fixes for *elements*, never fixed for the roots holding
     * them. Vera drains `element._cleanups` on `disconnectedCallback`, so it
     * calls `unobserve` — this is for everyone who does not.
     *
     * `isConnected` is the whole test, and it means the same thing for all
     * three shapes: a document is always connected, an element is connected
     * while it is in one, and a `ShadowRoot` is connected while its host is —
     * verified in Chromium, WebKit and Firefox. Checked here rather than at
     * removal time for the reason the mutation observer checks it at the end of
     * a batch: a host that is moved is removed and re-added in the same turn,
     * and by the time this runs it is connected again.
     */
    for (const root of roots) {
      if ((root as Node).isConnected) continue;
      roots.delete(root);
      unwatch(root);
    }

    /**
     * And the scroller, which is not a root and is resolved exactly once.
     *
     * `scrollElement: '#pane'` is resolved at `init()` and the scroll listener
     * is bound to whatever it found. Replace that pane — which is what a
     * component framework does on a route change, same selector, new node — and
     * the instance goes on listening to a node that has left the document.
     * Scrolling the new pane drives nothing, and the elements keep being
     * painted from the old one's last `scrollTop`. Measured: an element at rest
     * in a fresh pane came up half-animated, from a scroll position belonging
     * to a container that no longer exists.
     *
     * Reported rather than re-resolved. Re-binding the listener and
     * re-measuring mid-life is a real behaviour change on a rare path, and
     * making it self-heal is a decision rather than a repair — but silence was
     * not defensible either way.
     */
    if (scrollElement !== window && !(scrollElement as Node).isConnected) {
      problem(__DEV__
        ? 'the scrollElement this instance was given has left the document, so scrolling drives ' +
          'nothing and elements are painted from its last position. Make a new instance for the ' +
          'new container.'
        : 'scrollElement left the document');
    }

    const found = new Set<Element>();
    for (const root of roots) {
      runInserts('prepare', root, enabled);
      for (const node of findElements(root)) found.add(node);
    }

    /**
     * And the elements this scan is about to walk straight past.
     *
     * `data-vm` is the whole of `findElements`' selector, so an element
     * carrying `data-vm-opacity` and nothing else is not found, not
     * adopted, and not refused — it simply does not animate, with an empty
     * `rejected` and no console line. That is the one mistake the attribute
     * design invites, because the marker is the only attribute carrying no
     * information of its own, and it is silent in a library whose stated
     * position is that a refusal must never be. The GUI writes it every time;
     * the other two authors these attributes have — a person and an AI — forget it.
     *
     * A **property**, not any prefixed attribute. `stagger` belongs on an
     * unmarked parent, `split` stays on a container whose animation attributes
     * have moved to its pieces, and `scroll-target` is written by `scroll-to`
     * onto arbitrary sections — all three are settings, and all three would be
     * reported on a page that is perfectly correct. The line falls out of what
     * a property *is* rather than out of a list of exceptions, which is the
     * distinction that keeps drifting when it is written down twice.
     *
     * A walk rather than a selector: CSS cannot match on an attribute *name*,
     * and a generated one clause per property measured slower than this in all
     * three engines. Here rather than at `init()` because a reason recorded
     * once is either wiped by the next `collect()` — which clears element
     * reasons so modules can re-raise them — or never recomputed, and a stale
     * refusal is the failure `collect()` was fixed for on 2026-08-31.
     */
    const animatable = animatableNames();
    for (const root of roots) {
      /**
       * The root itself, which every scan here walks straight past.
       *
       * A `TreeWalker` does not return the node it starts at, so an **element**
       * handed to `root:` or to `observe()` never got the missing-marker reason
       * every one of its children would have got. `findElements` had the same
       * blind spot through `querySelectorAll`, where it meant a marked root was
       * never adopted at all; that one is fixed by looking, not by reporting.
       *
       * A `Document` and a `ShadowRoot` cannot carry attributes, so this is
       * only ever about the element case.
       */
      const rootElement = (root as Node).nodeType === 1 ? (root as Element) : null;
      const walker = document.createTreeWalker(root as Node, 1 /* SHOW_ELEMENT */);
      const nodes: Element[] = rootElement ? [rootElement] : [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push(node as Element);
      }
      for (const element of nodes) {
        if (element.hasAttribute(ATTRIBUTE_PREFIX)) continue;
        /**
         * Last resort: quiet when something already explained this element.
         *
         * A `split` container refused for nested markup keeps the animation
         * attributes it would otherwise have moved to its pieces, and has no
         * marker of its own — so it collected a second reason saying it needed
         * one, which is not the problem and would not fix it. A reason that
         * misdirects is worse than the silence this replaces.
         */
        if (rejectionsFor(element).length) continue;
        /**
         * A stagger host that staggers nothing.
         *
         * `parseElement` already refuses this, and reaches only elements it
         * parses — which is marked ones. `stagger` belongs on an **unmarked**
         * parent by design, so the most ordinary version of the mistake, a
         * wrapper whose children lost their markers or never had them, was the
         * one version nothing could see.
         *
         * The same test and the same sentence as the parse-time one, including
         * the `split` exemption: a split container is a documented pairing with
         * `stagger` and its pieces do not exist yet when this runs.
         */
        if (
          element.hasAttribute(`${ATTRIBUTE_PREFIX}-stagger`) &&
          !element.hasAttribute(`${ATTRIBUTE_PREFIX}-split`) &&
          !element.querySelector(`[${ATTRIBUTE_PREFIX}]`)
        ) {
          reject(element, __DEV__ ? `${ATTRIBUTE_PREFIX}-stagger needs animated descendants — it goes on the parent` : `${ATTRIBUTE_PREFIX}-stagger: no animated descendants`);
          continue;
        }
        for (const name of element.getAttributeNames()) {
          if (!animatable.has(name)) continue;
          reject(element, __DEV__ ? `${name} needs ${ATTRIBUTE_PREFIX} on the same element, and nothing here is animated without it.` : `${name} needs ${ATTRIBUTE_PREFIX}`);
          break;
        }
      }
    }

    /**
     * Document order, one counter per host, so an element's index among the
     * descendants *its own* host staggers is known without asking twice — the
     * same rule `parseElement` follows, and the reason a nested group does not
     * shift the outer one. Order alone can change it: moving an element inside
     * a cascade changes every offset after it without touching an attribute.
     */
    const counts = new Map<Element, number>();
    const changed: Element[] = [];
    for (const node of found) {
      let signature = ownAttributes(node);
      const host = node.parentElement?.closest(`[${ATTRIBUTE_PREFIX}-stagger]`);
      if (host) {
        const index = counts.get(host) ?? 0;
        counts.set(host, index + 1);
        signature += `@${index}:${host.getAttribute(`${ATTRIBUTE_PREFIX}-stagger`)}`;
      }
      if (signatures.get(node) !== signature || !byNode.has(node)) changed.push(node);
      signatures.set(node, signature);
    }

    /**
     * `reparse` prunes the diagnostics for the nodes it re-reads, and a node
     * that never parsed is always one of them — `byNode` does not hold it, so
     * it is always in `changed`. What is left is a node this instance is no
     * longer scanning at all: still inside a root, but no longer carrying the
     * marker. Nothing re-reads it and nothing drops it, so its reason was the
     * last thing left of an element otherwise entirely forgotten.
     */
    const scanned = new Set(found);
    for (let i = dropped.length - 1; i >= 0; i--) {
      const node = dropped[i]!.node;
      if (inRoots(node) && !scanned.has(node)) dropped.splice(i, 1);
    }

    reparse(changed);

    /**
     * And drops what is no longer there, which it did not.
     *
     * `collect()` is documented as a **re-scan**, and `scroll-to`'s collect has
     * always pruned — "anything it no longer tracks loses the active class and
     * the target marker attribute". This one only ever added. With
     * `observeMutations: false` — an option this library offers, for a page
     * that would rather call `collect()` itself — a removed element stayed in
     * the list for the life of the page: a strong reference to a detached node
     * and its whole subtree, updated every frame, and counted in
     * `elements.length`, which is the same "a count the page does not have"
     * that `adopt`'s dedupe exists to prevent.
     *
     * Still in a root is the test, not merely still connected: an element
     * moved out of an observed shadow root is gone from this instance's point
     * of view even though the document still holds it.
     *
     * And still **marked**. The marker is the whole of `findElements`'
     * selector, so an element whose `data-vm` was removed is no
     * longer in the scan at all — it is not re-read, it is not stale by the
     * root test, and it went on animating with its last inline transform for
     * the life of the page. The observer path checks exactly this (`the one
     * gesture meaning "stop animating this element"`); with the observer off
     * this was the path, and it did not.
     */
    const stale = new Set(
      elements.filter(
        (element) => !inRoots(element.node) || !element.node.hasAttribute(ATTRIBUTE_PREFIX)
      )
    );
    if (!stale.size) return;
    for (const element of stale) {
      runInserts('release', element.node);
      drop(element);
      clearElement(element, runtimeSettings);
    }
    elements = elements.filter((element) => !stale.has(element));
    /**
     * And the modules, about anything that has left the document entirely.
     *
     * `release` above is per element and per node, and a module's bookkeeping
     * is not always shaped that way: `split` is keyed by the **container**,
     * whose marker is optional, so releasing the spans it made says nothing to
     * it and a removed paragraph keeps its pieces — the same gap `unobserve`
     * had, by the same road.
     *
     * The predicate is `!isConnected`, not "outside my roots". A node this
     * instance no longer contains may simply have moved somewhere another
     * instance is watching, and tearing that down is exactly what the `owns`
     * argument exists to prevent. A node that has left the document belongs to
     * nobody, so putting it back is safe whoever held it — and nothing else
     * ever cleans those up.
     */
    runInserts('teardown', (node: Node) => !node.isConnected);
    retrack();
  };

  const adopt = (parsed: ParsedElement): RuntimeElement => {
    /**
     * Never register the same node twice.
     *
     * `roots` can overlap — `observe(node)` on anything already inside the
     * default `document` root registered every element under it a second time,
     * and since `destroy()` leaves `roots` alone, a later `init()` did it
     * again. The element then updated twice a frame and `elements` reported a
     * count the page did not have.
     *
     * The re-parse path in `reparse` calls `drop()` first, which clears
     * `byNode`, so this does not block a legitimate re-adoption.
     *
     * **Currently unreachable, and kept.** `reparse` is the only caller; it
     * drops any existing element before parsing, and its batch is a `Set`, so
     * `byNode` never holds this node at this point. A mutation removing this
     * line survives the suite for that reason. What actually enforces "once per
     * element" today is that `Set` and the one `collect()` builds its scan into
     * — both of which have their own comment saying so. This stays because it
     * is the invariant stated where an element is registered, and the next
     * caller of `adopt` should not have to discover it.
     */
    const already = byNode.get(parsed.node);
    if (already) return already;

    const element = createRuntimeElement(parsed, runtimeSettings);
    /**
     * **Not styled here.** `setElementStyles` writes `position` and `top` for a
     * pinned element, which dirties layout — and the next element's
     * `createRuntimeElement` reads geometry, so styling inside this loop forced
     * one layout per element. 2,000 pinned elements took **1,079ms** to
     * `init()` against 27ms unpinned, and 75ms at 500. `reparse` writes the
     * whole batch afterwards; nothing between construction and that write reads
     * an element's own styles.
     *
     * A transform or a filter would not have done it — neither invalidates
     * layout — which is why only `pin` showed the shape.
     */
    visible?.observe(element);
    return add(element);
  };

  /**
   * One pass, once per animation frame while scrolling.
   *
   * Iterates only the elements the visibility tracker considers in play. With
   * no IntersectionObserver available it falls back to the full list, which is
   * the old behaviour and still correct — just more work.
   */
  /**
   * Re-parses a set of elements and puts the results back in the loop.
   *
   * Shared by the mutation observer's changed and removed paths. Removal needs
   * it too: a stagger offset is index x step in document order, so deleting one
   * element leaves every element after it holding a stale index — a gap in the
   * cascade rather than a cascade.
   */
  /**
   * Re-reads a set of nodes and returns the elements that came back.
   *
   * The parsing half of `applyChanges`, split out because `collect()` needs it
   * without the painting half: every caller of `collect()` follows with
   * `start()`, which paints the whole list anyway, so leaving the paint in
   * meant a full second pass over the page at `init()` and on every public
   * `collect()`. It was also observable — the second pass re-evaluates every
   * `when` selector and, finding nothing changed, writes no style — which is
   * only wasted work in a browser but poisons happy-dom's `matches` cache, and
   * the `when`-on-a-container test caught it.
   */
  const reparse = (nodes: readonly Element[]): RuntimeElement[] => {
    forgetStagger();
    const fresh: RuntimeElement[] = [];
    const gone = new Set<RuntimeElement>();

    /**
     * A stagger offset is index x step, and the index is document order
     * among the host's animated descendants — so inserting or removing
     * one element changes the offset of every element after it. Those
     * elements did not mutate, so nothing would re-parse them, and a
     * prepended element simply shared index 0 with the existing first:
     * two elements moving in unison in the middle of a cascade.
     *
     * Re-parsing the whole group is the honest fix. Mutations are rare
     * and groups are small; this runs only when a changed node actually
     * sits inside one.
     */
    const regroup = new Set<Element>();
    for (const node of nodes) {
      const host = node.parentElement?.closest(`[${ATTRIBUTE_PREFIX}-stagger]`);
      if (host) regroup.add(host);
    }
    const batch = new Set<Element>(nodes);
    for (const host of regroup) {
      for (const sibling of host.querySelectorAll(`[${ATTRIBUTE_PREFIX}]`)) batch.add(sibling);
    }

    /**
     * `prepare` is deliberately **not** run here.
     *
     * A module that rewrites the DOM does so by mutating it, and mutating
     * inside the observer's own callback re-enters the observer: split
     * rewrote the paragraph, that fired another batch, which prepared
     * again, and the two chased each other until the heap ran out. It is
     * re-entrant by construction, not by accident.
     *
     * Content rendered after `init()` is handled explicitly instead —
     * `collect()` on the instance, which is also what `scroll-to` has
     * always offered for the same situation.
     */

    /**
     * The diagnostics for these nodes are about to be recomputed, so the
     * old ones have to go first.
     *
     * They did not, and both halves of that were wrong. An element that
     * failed to parse got a fresh entry on *every* re-parse, so in the
     * GUI that writes these attributes a broken value accumulated one
     * entry per keystroke. And once the value was corrected the element
     * animated perfectly while `rejected` — the list a GUI renders its
     * error state from — went on reporting every earlier attempt.
     */
    for (let i = dropped.length - 1; i >= 0; i--) {
      if (batch.has(dropped[i]!.node)) dropped.splice(i, 1);
    }

    /**
     * Two passes, because one interleaved reads and writes.
     *
     * `clearElement` writes style and `adopt` measures, so doing both
     * per node makes the engine flush layout once per element. Splitting
     * the loop was not enough on its own — `clearElement` wrote and then
     * read *inside itself*, which is where the 4.0-second `collect()` at
     * 5,000 elements actually came from, and that reading has moved to
     * its callers. Both halves are needed: this ordering is what stops
     * the fresh measurement in `adopt` interleaving with the strips.
     */
    const pending: Array<{ node: Element; latched: number | null }> = [];
    for (const node of batch) {
      const existing = byNode.get(node);
      /**
       * Carried across, because `run-once` means once *ever* and a
       * re-parse is not the element leaving.
       *
       * `resetElement` says so and refuses to clear the latch on a
       * re-measure; a re-parse builds a fresh runtime element, which
       * starts unlatched, and nothing carried it. In the GUI that writes
       * these attributes that is every keystroke: a latched element
       * visibly reverted to its first keyframe — a faded-in block going
       * blank while its author edited an unrelated setting — and fired a
       * second `vm:complete`, an event documented as firing
       * once, ever.
       */
      const latched = existing?.runOnceRan ? existing.timelinePosition : null;
      if (existing) {
        drop(existing);
        clearElement(existing, runtimeSettings);
        gone.add(existing);
      }
      /**
       * The marker is what makes an element ours — it is the whole of
       * `findElements`' selector. `parseElement` never checked it,
       * because at init nothing reaches it without one, so removing
       * `data-vm` left the element registered and still
       * animating: the one gesture that means "stop animating this" was
       * the one that did nothing. It has already been dropped and
       * cleared above; not re-adopting it is the whole fix.
       */
      if (!node.hasAttribute(ATTRIBUTE_PREFIX)) continue;
      pending.push({ node, latched });
    }
    if (gone.size) elements = elements.filter((e) => !gone.has(e));

    /** The measuring half, and `adopt` measures — so it is a batch too. */
    standingDownAll(pending.map((one) => one.node as HTMLElement), () => {
    for (const { node, latched } of pending) {
      const parsed = parseElement(node, parseContext);
      if (!parsed) continue;

      const element = adopt(parsed);
      /**
       * The position travels with the latch. Latched means "played
       * through and stayed there", and a fresh element starts at 0 — so
       * carrying only the flag left a state-driven element painting its
       * *first* keyframe for ever, which is the same revert by a longer
       * road.
       *
       * Only ever set, never cleared: an element that was not latched
       * before must be free to latch now.
       *
       * `element.runOnce` in the guard is **defensive and currently
       * unreachable** — checked rather than assumed. Every reader of
       * `runOnceRan` asks `element.runOnce` first, so setting it on an
       * element whose `run-once` was just removed changes nothing today,
       * and a mutation deleting that half survives the suite. It stays
       * because a latch recorded on something that cannot latch is a lie
       * in the data model, and the next reader of this field should not
       * have to know it might be one. Nobody should read this as
       * describing something that happens today.
       */
      if (latched !== null && element.runOnce) {
        element.runOnceRan = true;
        element.timelinePosition = latched;
      }
      fresh.push(element);
    }
    });
    /**
     * Every write after every read — see `adopt` — and **only while
     * enabled**.
     *
     * `disable()` strips every animated style and the README calls that
     * "return every element to its natural un-animated state". A re-parse
     * while disabled put them straight back: `will-change: transform` on
     * an element the page had just been told is not animating, plus
     * `transform-origin`, `offset-path` and the `position: sticky` a
     * `pin` writes. An editor toggling animation off and then editing an
     * attribute is the ordinary way to reach it, through the mutation
     * observer as much as through `collect()`. `enable()` re-styles
     * everything it holds, so nothing is lost by waiting.
     *
     * **Queued, not written here.** Every path that adopts arrives at
     * this line, so it is the one place the writes are owed from —
     * `init()` and `collect()` flush them before returning, and
     * `observe()` lets them batch, which is the whole difference between
     * the two.
     */
    /**
     * The `enabled` test here is about the **set**, not the write: the
     * paint checks it too, and is what actually keeps `disable()`'s
     * promise. Without this a re-parse while disabled would keep adding
     * to a set nothing drains until the instance is enabled again.
     */
    if (enabled) {
      for (const element of fresh) unpainted.add(element);
      queuePaint();
    }
    return fresh;
  };

  /**
   * Re-reads a set of nodes and brings just those up to date.
   *
   * The mutation observer's path. `collect()` calls `reparse` alone, because
   * the `start()` that follows it does this for the whole list.
   */
  const applyChanges = (nodes: readonly Element[]): void => {
    const fresh = reparse(nodes);
    /**
     * Only the elements that actually changed. This used to call `start()`,
     * which copies the whole element list to apply transitions and then runs a
     * full pass over the page — on every mutation batch, of which an editor
     * produces a great many.
     */
    if (!fresh.length || !enabled) return;
    /**
     * A new element can animate further outside the viewport than anything the
     * tracker was built for, and an observer's `rootMargin` is fixed at
     * construction. Only when one actually reaches further: `retrack()`
     * rebuilds the observer over every element and this runs on every mutation
     * batch.
     */
    if (visible && fresh.some((element) => !visible!.covers(element))) retrack();
  };

  const update = (): void => {
    if (!enabled) return;
    const win = getWindowSize(settings.scrollDirection, scrollElement);
    const targets: Iterable<RuntimeElement> = visible ? visible.active : elements;
    /**
     * updateElement returns immediately for state-driven elements.
     *
     * No `enabled` re-check here, unlike the two loops over `elements` that
     * also reach `onProgress`. This one iterates the tracker's active **Set**,
     * which teardown clears, so a `destroy()` from inside the callback ends
     * the iteration by itself. Measured: removing a guard here changes nothing,
     * in any of three engines.
     */
    for (const element of targets) updateElement(element, win, runtimeSettings);
  };

  /**
   * Re-evaluates state-driven elements. Called when a foreign attribute changes
   * on one — a class toggle, typically — which is far cheaper than the
   * re-parse an attribute change would otherwise trigger.
   */
  /**
   * @param nodes only these, or every state-driven element
   * @param force repaint even though the selector's answer has not changed —
   * see the re-measure callers
   */
  const updateState = (nodes?: readonly Element[], force = false): void => {
    if (!enabled) return;
    for (const element of elements) {
      if (!element.when) continue;
      if (nodes && !nodes.includes(element.node)) continue;
      updateStateElement(element, force, runtimeSettings);
    }
  };

  /**
   * One element, on either edge of the visibility tracker.
   *
   * The update happens regardless — arriving, so a programmatic jump does not
   * leave it stale; leaving, so it settles on its clamped value. The event is
   * dispatched after, so a listener reading the element sees the settled state
   * rather than the one it is about to leave.
   */
  const updateOne = (element: RuntimeElement, active: boolean): void => {
    if (!enabled) return;
    /**
     * A cached size of zero means it was measured while it had no box —
     * `display: none`, which is every accordion, tab panel and off-canvas menu
     * before it opens. Such an element measures as sitting at the top of the
     * document with no height, which puts its timeline position past the end,
     * so it paints its *last* keyframe.
     *
     * Revealing it in the page changes the document's height and the
     * `ResizeObserver` catches it. Revealing it inside a fixed-height scroller
     * changes nothing the library watches, and it stayed at the end of its
     * animation for good — measured at `opacity(1)` in all three engines while
     * sitting 3,501px below the viewport, where it should be at its first
     * keyframe.
     *
     * Re-measuring here rather than watching every element's box: this runs
     * when the tracker first reports the element, which is before it can be
     * seen, and only for the elements that carry the signature.
     */
    if (active && element.size === 0) resetElement(element, runtimeSettings);
    updateElement(element, getWindowSize(settings.scrollDirection, scrollElement), runtimeSettings);
    if (active) announced.add(element);
    else announced.delete(element);
    emit(element.node, active ? EVENTS.active : EVENTS.idle, element.timelinePosition);
  };

  /**
   * Builds the visibility tracker over the current element list, replacing any
   * existing one.
   *
   * The root margin is derived from how far outside 0-1 the authored keyframes
   * reach, so a keyframe positioned in viewport units moves it whenever the
   * viewport changes. A tracker built once at init would go stale and drop an
   * element from the loop slightly before its animation finished. Re-observing
   * puts every element back in the active set until the new observer reports,
   * which is the same fail-safe the initial pass relies on.
   */
  const retrack = (): void => {
    visible?.disconnect();
    visible = createVisibilityTracker(
      elements,
      updateOne,
      settings.scrollDirection === 'horizontal',
      /** Only an element can be an observer root; the window is `null`. */
      scrollElement === window ? null : (scrollElement as Element),
      /**
       * The same size `updateTimelinePosition` adds to the element's, because
       * that is what one timeline unit spans and what the margin is now in.
       */
      getWindowSize(settings.scrollDirection, scrollElement).size
    );
    for (const element of elements) visible?.observe(element);
  };

  /** Re-measure only: animated styles cleared, configuration left in place. */
  const measure = (): void => {
    /** One window read and one style read for the whole pass, not one per element. */
    const win = getWindowSize(settings.scrollDirection, scrollElement);
    readRootFontSize();
    /**
     * And one sticky answer per ancestor, not one per element. A wrapper can
     * be sticky at one width and not at another, so what was learned last time
     * is dropped here — which is the moment it can have changed. Direction
     * is the same shape of fact and is dropped with it.
     */
    forgetSticky();
    forgetDirection();
    /**
     * One stand-down for the whole page, not one per element — see
     * `standingDownAll`. Both readings inside `resetElement` neutralise sticky
     * positioning, and doing that per element wrote style and forced a layout
     * every time round: 57 seconds to measure 5,000 elements inside a sticky
     * stage, against 64ms for the same page without one.
     */
    standingDownAll(
      elements.map((element) => element.node),
      () => { for (const element of elements) resetElement(element, runtimeSettings, win); }
    );
    /**
     * Unconditionally, because the root margin is in pixels.
     *
     * It used to rebuild only when some element was `geometryDependent`, which
     * was right while the margin was a percentage: the observer resolved that
     * against the current root every time, so a resize corrected it for free.
     * A pixel margin does not correct itself, and it is built from the root's
     * size and each element's own — both of which any re-measure can change.
     * A page whose positions are all `%` kept a margin sized for the viewport
     * it was built in: doubling the viewport left it at half what it needed.
     *
     * The rebuild is unconditional rather than guarded because the guard costs
     * more than it saves in code, and nothing measurable in time.
     *
     * The numbers first written here — 0.38 to 0.42ms at 200 elements, 8.4 to
     * 11.1ms at 5,000 — were **noise**, and are corrected rather than deleted
     * because quoting them was the mistake. `spikes/resize-cost.mjs` reports a
     * median whose run-to-run spread is 12-18% *within* one page load and
     * wider between launches: identical code measured 0.62, 0.49 and 0.47ms on
     * three consecutive runs. Alternating this change in and out in one
     * sitting puts both versions inside each other's range at every size.
     *
     * What can be said without measuring is that the pass is debounced to
     * 100ms and already walks every element to re-read its geometry, and that
     * nothing else calls it: the mutation observer does not re-measure.
     */
    retrack();
  };

  /** Full teardown, for disable() and destroy(). */
  const clear = (): void => {
    /**
     * Before the strip, or a write already in flight lands on top of it.
     *
     * **Both** slots. `destroy()` cancelled `start()`'s and `disable()` did
     * not, so a `disable()` inside the frame after `init()` — which is every
     * disable an editor does on load — stripped the transition and then had it
     * written straight back by the write `start()` had already deferred. The
     * element then carried a transition while the instance was off, which is
     * exactly what `disable()` says it removes.
     */
    cancelTransitions();
    for (const cancel of pendingTransitions) cancel();
    pendingTransitions.clear();
    /**
     * And the paints owed but not yet made.
     *
     * `observe()` adopts synchronously and paints on the next microtask, so a
     * `disable()` in between would be undone by a write it had no way to see —
     * the same shape as the deferred transition above, on the other queue.
     * Dropping the set also lets go of the elements it holds, which `clear()`
     * is otherwise careful about.
     */
    unpainted.clear();
    for (const element of elements) {
      runInserts('release', element.node);
      clearElement(element, runtimeSettings);
    }
    /**
     * Measured afterwards, not inside the strip.
     *
     * `enable()` re-styles from what is measured here rather than re-parsing,
     * so the reading has to happen with the animated styles gone — but taking
     * it *per element*, three lines after writing that element's style, forced
     * a synchronous layout every time round. `destroy()` on 5,000 elements
     * took 4.5 seconds, quadratic in the element count, against 87ms for the
     * `init()` that built them. One pass of writes and then one of reads is the
     * same work in an order the engine can batch, and the window is read once
     * for the page instead of once per element.
     */
    if (elements.length) {
      /**
       * **The strip above is the promise; this measurement is the
       * convenience.** `enable()` re-styles from what is read here, so it is
       * worth taking — but every style has already been cleared by the loop
       * above, and a geometry read that throws must not turn `destroy()` into
       * a half-teardown: listeners unreleased, roots still watched, the
       * instance neither alive nor gone. A page can make one throw (the
       * `offsetHeight` accessor is configurable, and plugins and test tooling
       * do override it), and an engine cannot — measured: detached, hidden,
       * foreign-document and detached-tree elements all answer finite zeros
       * in Chromium. Cheap insurance on the one path that must always finish;
       * `enable()` re-measures anyway through `refresh()` if it ever matters.
       */
      try {
        const win = getWindowSize(settings.scrollDirection, scrollElement);
        standingDownAll(
          elements.map((element) => element.node),
          () => { for (const element of elements) resetElement(element, runtimeSettings, win); }
        );
      } catch {
        /* geometry is unreadable; the teardown above already stands */
      }
    }
    /**
     * Every element that was announced active has now left the loop, which is
     * what `vm:idle` means — "it has left the loop, after a final pass
     * that settled it", and `clear()` is that final pass.
     *
     * It fired for an element the *tracker* stopped watching and never for an
     * instance that stopped animating, so `disable()`, `destroy()` and a
     * reduced-motion preference arriving all left every listener holding an
     * element it believed was still animating. The documented use is "start
     * this video when it arrives" — which then never stopped.
     *
     * Balanced by construction: `announced` holds exactly what was told to go
     * active, so nothing is told to go idle that was not.
     */
    for (const element of announced) emit(element.node, EVENTS.idle, element.timelinePosition);
    announced.clear();
  };

  /**
   * Re-collect when motion becomes possible and `prepare` never ran.
   *
   * A module that rewrites the DOM is skipped while nothing will animate — the
   * `aria-hidden` spans `split` makes are pure cost for an animation that is
   * not going to happen — so a page loaded under reduced motion has no pieces,
   * and therefore none of the elements those pieces would have been.
   * Re-enabling has to build them, and there is nothing to re-style because
   * nothing was ever there.
   *
   * `enable()` did this and the media-query listener did not, which is the
   * whole bug: a visitor with reduced motion on who turned it *off* while the
   * page was open got `reducedMotion === false`, an instance reporting itself
   * enabled, and a paragraph that would never animate for the life of the
   * page. Plain elements were fine, since those are collected either way —
   * only what a module builds was missing, and nothing said so.
   */
  const reprepare = (): void => {
    if (prepared) return;
    for (const element of elements) drop(element);
    elements = [];
    collect();
    retrack();
  };

  /** Cancels a deferred transition write if teardown beats the frame. */
  let cancelTransitions: () => void = () => {};

  /**
   * The same, for the mutation path, which had none.
   *
   * `start()` keeps its canceller in the slot above; `applyChanges` threw its
   * away. A `destroy()` or `disable()` landing between a mutation batch and the
   * next frame therefore stripped the element's transition and then had it
   * written straight back — an inline style left on the page for the life of
   * the document, by the teardown that exists to remove it. The comment on
   * `setTransitions` describes exactly this failure at the other call site.
   *
   * A set rather than a slot, because two batches can be outstanding at once
   * and cancelling the first to make room for the second would drop its write.
   * Each entry removes itself once it has landed.
   */
  const pendingTransitions = new Set<() => void>();

  /** Still this instance's element — the fire-time question `setTransitions` asks. */
  const stillHeld = (element: RuntimeElement): boolean => byNode.get(element.node) === element;

  const queueTransitions = (list: readonly RuntimeElement[]): void => {
    let cancel: () => void = () => {};
    cancel = setTransitions(list, () => pendingTransitions.delete(cancel), stillHeld);
    pendingTransitions.add(cancel);
  };

  const start = (): void => {
    if (!enabled) return;
    cancelTransitions();
    cancelTransitions = setTransitions(elements, undefined, stillHeld);
    /**
     * One full pass, not the narrowed one. Elements far below the fold are
     * outside the visibility tracker's margin and would otherwise carry no
     * inline style at all until they approached — which is invisible in normal
     * scrolling, but would flash unstyled content on a jump straight to an
     * anchor deep in the page. One pass at init costs nothing and removes the
     * failure mode entirely.
     */
    const win = getWindowSize(settings.scrollDirection, scrollElement);
    for (const element of elements) {
      /** Re-read per element: both calls below reach `onProgress`, which can tear the instance down. */
      if (!enabled) return;
      /** force: a resting state-driven element, or a latched run-once one, must still be painted. */
      if (element.when) updateStateElement(element, true, runtimeSettings);
      else updateElement(element, win, runtimeSettings, true);
    }

    /**
     * Then ask whether those writes survived the page's CSS — see
     * `cascadeTrouble`. A **second** pass on purpose: every write happens
     * first, so this reads one style recalculation for the whole set rather
     * than forcing one per element by interleaving reads with writes.
     *
     * Here rather than in `createRuntimeElement` because the question is about
     * a write, and no write has happened at construction. Once per start
     * rather than per measure: a stylesheet rule is not something a resize
     * changes, and this is the only per-element style read the library makes
     * for an element carrying neither `pin` nor `translate-z`.
     */
    for (const element of elements) {
      if (!enabled) return;
      element.cascadeBlocked = cascadeTrouble(element);
    }
  };

  const init = (): void => {
    if (started) return;

    if (!supports()) {
      problem('required APIs unavailable, animation disabled.');
      return;
    }

    started = true;
    if (!counted) { counted = true; liveInstances++; }

    /**
     * Reduced motion leaves every element in its natural state — visible and
     * readable, never half-applied. Elements are still parsed, so an explicit
     * enable() can override without re-parsing the page.
     */
    following = true;
    reducedMotion = settings.respectReducedMotion && prefersReducedMotion();
    touchDisabled = settings.disableOnTouch && prefersCoarsePointer();
    enabled = wanted && !reducedMotion && !touchDisabled;
    /**
     * An explicit answer stops the preference being followed, exactly as it
     * does after `init()` — otherwise a `disable()` made before starting would
     * be undone by the first reduced-motion change, which is the one event
     * least likely to mean "start animating".
     */
    if (!wanted) following = false;

    /**
     * The preference is a live toggle on both macOS and Windows, so it is
     * watched rather than sampled. An explicit enable() still wins — it is the
     * authoring escape hatch — which is why this only acts while the instance
     * is still following the preference.
     */
    /**
     * Both are live preferences and either one suppresses animation, so they
     * share one resolver rather than fighting over `enabled`.
     */
    const resolve = (): void => {
      if (!following) return;
      const off = reducedMotion || touchDisabled;
      if (off === !enabled) return;
      enabled = !off;
      if (off) clear();
      else {
        for (const element of elements) setElementStyles(element, runtimeSettings);
        reprepare();
        start();
      }
    };

    if (settings.respectReducedMotion) {
      teardown.push(onReducedMotionChange((reduced) => {
        reducedMotion = reduced;
        resolve();
      }));
    }
    if (settings.disableOnTouch) {
      teardown.push(onCoarsePointerChange((coarse) => {
        touchDisabled = coarse;
        resolve();
      }));
    }

    /**
     * Parse first: the tracker's root margin is derived from how far outside
     * the viewport any element's keyframes reach, which is not known until
     * everything has been parsed.
     */
    /** Before any element is constructed — `createRuntimeElement` builds curves. */
    readRootFontSize();
    /** And before any is measured; see `measure()`. */
    forgetSticky();
    forgetDirection();

    /**
     * Roots can overlap — `observe(node)` on anything already inside the
     * default `document` root is legal and common — so the same element comes
     * back from more than one `parseAll`. `adopt` is what dedupes them.
     *
     * `destroy()` leaves `roots` alone by design, so this is also what stops a
     * destroy/init pair registering everything twice.
     */
    collect();
    retrack();
    teardown.push(() => visible?.disconnect());

    const scroll = scrollListener(scrollElement, update);
    teardown.push(scroll.removeScrollListener);

    /**
     * Geometry is cached at init, but a page whose images carry no width or
     * height is still reflowing at that point: every image that loads shifts
     * everything below it, and every cached `start` goes stale. That is what
     * makes a fresh load look choppy while scrolling "fixes" it — the first
     * resize or mutation happens to re-measure.
     *
     * `load` fires once every subresource has settled, so one re-measure there
     * catches the common case.
     */
    if (document.readyState !== 'complete') {
      const onLoad = () => { measure(); update(); };
      window.addEventListener('load', onLoad, { once: true });
      teardown.push(() => window.removeEventListener('load', onLoad));
    }

    /**
     * Re-measure on anything that can move geometry, coalesced to one pass per
     * frame — a reflow fires these many times in a row, and both sources below
     * can fire for the same change.
     */
    let queued: number | null = null;
    const remeasure = () => {
      if (queued !== null) return;
      /**
       * State-driven elements too, and **forced**.
       *
       * `update()` returns immediately for them by design — they are driven by
       * their selector, not by scroll — so a resize re-measured their geometry,
       * rebuilt their curves against the new viewport, and then repainted
       * nothing. An element with width bands kept the previous breakpoint's
       * values until its class next changed: rotate a phone and the state-driven
       * half of the page is still animating to the old band.
       *
       * Forced because the selector's answer has *not* changed — the element is
       * still matched, still at its end — and the unforced path returns early
       * on exactly that. What changed is the curve underneath it. The write is
       * skipped anyway when the composed string is unchanged, so forcing costs
       * nothing on a resize that moved nothing.
       */
      queued = requestAnimationFrame(() => {
        queued = null;
        measure();
        update();
        updateState(undefined, true);
      });
    };
    /**
     * The handle is kept so teardown can cancel it. A frame deferred with no
     * canceller is the shape that has leaked here four times: destroy() lands
     * inside the window and the callback runs against state that is gone, or
     * worse, against the *next* instance's, forcing a stray layout pass on it.
     */
    teardown.push(() => {
      if (queued !== null) { cancelAnimationFrame(queued); queued = null; }
    });

    /**
     * Two sources, because neither sees everything.
     *
     * A ResizeObserver on the document element catches what a resize event
     * cannot: fonts swapping, lazy images arriving, a component rendering late,
     * content the page adds itself. But the root element's box is the *content*
     * height, so a viewport that changes only in height never resizes it —
     * measured in Chromium, a height-only change fires `resize` once and the
     * observer not at all. A mobile URL bar sliding away is exactly that case.
     *
     * The gap was harmless while geometry depended only on the element, and
     * stopped being harmless when keyframe positions gained viewport and
     * absolute units: those normalise against `element.size + win.size`, so a
     * shorter viewport changes where every one of them sits on the timeline.
     */
    if (typeof ResizeObserver === 'function') {
      const sizeObserver = new ResizeObserver(remeasure);
      sizeObserver.observe(document.documentElement);
      /**
       * And the scroll container, which is the third thing neither source sees.
       *
       * A pane can change size without the document's box changing at all — a
       * splitter drag, a flex reflow, a panel collapsing. Measured in Chromium:
       * halving a fixed-position pane's height left every element's timeline
       * position exactly where it was, 0.4 when the correct value was 0, and
       * `document.documentElement` did not resize because the pane is out of
       * flow. Nothing fired, and the animation stayed wrong until a window
       * resize, a mutation or an explicit `refresh()` happened along.
       */
      if (scrollElement !== window) sizeObserver.observe(scrollElement as Element);

      /** And every element's own box — see `boxes` above for what that adds. */
      boxes = sizeObserver;
      for (const element of elements) sizeObserver.observe(element.node);
      teardown.push(() => { boxes = undefined; sizeObserver.disconnect(); });
    }
    const resize = resizeListener(remeasure);
    teardown.push(resize.removeResizeListener);

    if (settings.observeMutations && supportsMutationObserver()) {
      watching = true;
      for (const root of roots) watch(root);
      teardown.push(unwatchAll);
    }

    paintNow();
    start();
  };

  /** Starts watching one root. Every root gets its own — see `watchers`. */
  const watch = (root: ParentNode): void => {
    if (!watching || watchers.has(root)) return;
    const watcher = createMutationObserver({
        onChanged: (nodes) => applyChanges(nodes),
        onStateChanged: (nodes) => updateState(nodes),
        onRemoved: (nodes) => {
          /**
           * Every removed node, not only the adopted ones — a split container
           * is marked but carries no animation of its own, so the runtime
           * never adopted it and `drop()` would never reach it.
           *
           * Only here. This lived in the *changed* path for one debugging
           * session, and the two are one line apart: releasing on a re-parse
           * told the split module the paragraph was going away, it put the text
           * back, `prepare` split it again, and the two chased each other
           * until the heap ran out.
           */
          for (const node of nodes) {
            runInserts('release', node);
          }

          const gone = new Set<RuntimeElement>();
          for (const node of nodes) {
            const element = byNode.get(node);
            /** Without release() the sequence keeps every frame it decoded, forever. */
            if (element) { drop(element); gone.add(element); }
          }
          if (gone.size) elements = elements.filter((e) => !gone.has(e));
          /**
           * The diagnostics list holds nodes too, and a removed element that
           * never parsed is still a removed element. Pruned here rather than
           * only in destroy(), for the same reason `elements` is.
           */
          for (let i = dropped.length - 1; i >= 0; i--) {
            if (nodes.includes(dropped[i]!.node)) dropped.splice(i, 1);
          }

          /**
           * Removing one element of a stagger group shifts the index of every
           * element after it, and none of those mutated — so nothing else
           * would re-parse them and the cascade kept a gap where the deleted
           * element used to be. Re-parsing the survivors lets `applyChanges`
           * expand each back to its whole group.
           */
          for (const element of gone) {
            if (!element.parsed.stagger) continue;
            applyChanges(elements.filter((e) => e.parsed.stagger).map((e) => e.node));
            break;
          }
        },
    });
    watcher.observe(root as Node, observerOptions());
    watchers.set(root, watcher);
  };

  /** Stops watching one root. O(1), which is the whole reason for one each. */
  const unwatch = (root: ParentNode): void => {
    watchers.get(root)?.disconnect();
    watchers.delete(root);
  };

  const unwatchAll = (): void => {
    for (const watcher of watchers.values()) watcher.disconnect();
    watchers.clear();
    watching = false;
  };

  const destroy = (): void => {
    cancelTransitions();
    /**
     * And drop the canceller itself. It is a closure over the element list the
     * deferred write was built from, and `cancelTransitions` is instance state
     * — so a consumer keeping the instance handle after `destroy()`, which is
     * the ordinary way to hold one, kept every element reachable through it
     * long after `elements` was emptied. Found by a WeakRef churn probe with
     * gc controls (the suite deliberately never forces collection; the probe
     * lives in spikes/retention.mjs) — every removed node survived on exactly
     * this path and no other.
     */
    cancelTransitions = () => {};
    for (const off of teardown.splice(0)) off();
    visible = null;
    clear();
    /**
     * Only here, never on `disable()`. A module that rewrote the page puts it
     * back when the instance is finished with — but a toggle keeps it, so
     * enabling again is a re-style rather than a re-parse. That is what keeps
     * `run-once` latched and an editor toggle cheap.
     */
    /**
     * By root, so a module does not reach a second instance's state. Built here
     * rather than passed as `roots` so that what ownership *means* stays in
     * core — a module asks the question instead of answering it.
     */
    runInserts('teardown', inRoots);
    /**
     * Before `elements` is emptied, or the claims outlive the only thing that
     * knows which nodes they were on — and an `init()` / `destroy()` / `init()`
     * on one page would have the second instance accuse itself of fighting the
     * first. It did, until this line.
     */
    for (const element of elements) unclaim(element.node);
    elements = [];
    /** Holds element references, so it must not outlive the instance. */
    dropped.length = 0;
    byNode.clear();
    started = false;
    enabled = false;
    /**
     * Or the next instance inherits it. `enable()` collects only when nothing
     * was ever prepared, so a destroy/init pair under reduced motion left this
     * true from the *previous* run, `enable()` skipped the collect, and the
     * page was never split — where a freshly constructed instance in the same
     * situation split it.
     */
    prepared = false;
    reducedMotion = false;
    touchDisabled = false;

    /**
     * Last one out drops the page-level state — see the `forget` insert.
     *
     * After `teardown`, so a module's per-element work has already run, and
     * guarded by `counted` so a second `destroy()`, or one on an instance that
     * never started, cannot take the count below zero and fire this while
     * another instance is still animating.
     */
    if (counted) {
      counted = false;
      if (--liveInstances === 0) runInserts('forget');
    }
  };

  return {
    init,
    destroy,

    enable() {
      /**
       * Nothing to enable before `init()` or after `destroy()`. It used to
       * `start()` regardless, which after a `destroy()` meant re-collecting
       * and re-splitting the page from an instance that had already given
       * everything back.
       */
      if (!started) { wanted = true; return; }
      /**
       * Before the `enabled` guard, and symmetrically with `disable()`: the
       * call means "I want this on", which is an answer to the preference
       * whether or not it also changes the current state.
       */
      following = false;
      if (enabled) return;
      enabled = true;
      /**
       * disable() stripped the configuration styles and released the
       * on-demand resources; put both back. Without re-attaching, an image
       * sequence stopped drawing permanently after a single toggle.
       */
      for (const element of elements) {
        setElementStyles(element, runtimeSettings);
      }
      /**
       * Collect only if nothing was ever prepared — the reduced-motion case,
       * where `prepare` was skipped at init because nothing was going to
       * animate. An ordinary toggle kept the page as it was, so re-styling the
       * elements already held is both correct and cheap.
       */
      reprepare();
      /**
       * A fresh tracker, so every element announces its state again.
       *
       * `disable()` told each listener its element had gone idle; without this
       * the tracker's memory of having already reported means nothing is ever
       * told it came back, and a page that stopped a video on idle has no
       * signal to start it again. A new tracker has reported nothing, which is
       * the same position `init()` is in.
       */
      retrack();
      /**
       * start(), not update(): update() skips state-driven elements by design,
       * so re-enabling left every `data-vm-when` element with its styles
       * cleared and nothing to repaint them. start() forces both kinds.
       */
      start();
    },

    disable() {
      /**
       * **Remembered, not ignored.** Before `init()` this fell through to the
       * `enabled` guard below and did nothing at all — `enabled` is false until
       * `init()` sets it — so
       *
       *     const m = createMotion();
       *     if (!config.animate) m.disable();
       *     m.init();
       *
       * animated the page. The call was silent and the intent was plain.
       * `enable()`'s own early return is about a *destroyed* instance, not
       * about this, so recording the answer here contradicts nothing it says.
       */
      if (!started) { wanted = false; return; }
      following = false;
      if (!enabled) return;
      enabled = false;
      /** Natural state, not frozen mid-transform — configuration styles included. */
      clear();
    },

    setEnabled(next: boolean) {
      if (next) this.enable();
      else this.disable();
    },

    /**
     * Every attribute the runtime refused, with the element it was on.
     *
     * Covers elements that were dropped entirely, which is the case that
     * matters: `elements` only holds what parsed successfully, so an element
     * whose every animation failed was invisible to the documented
     * `elements.flatMap(e => e.parsed.rejected)` check — the exact element
     * someone is looking at when they ask why nothing animates.
     */
    get rejected(): readonly RejectedElement[] {
      const out: RejectedElement[] = [];
      /**
       * Parse-time reasons first, then whatever a module refused later.
       *
       * Both halves are needed and neither is a superset: a `<div>` carrying
       * `frame` parses perfectly — `frame` is a real property and the value is
       * valid — and is refused only when the sequence module is handed it and
       * finds it is not a canvas. Reading only `parsed.rejected` reported
       * nothing for exactly the element someone is staring at.
       */
      /** `Element`, not the nullable field type: the one entry with no node is pushed directly. */
      const add = (node: Element, parsed: readonly string[]): void => {
        const all = parsed.length ? [...parsed, ...rejectionsFor(node)] : rejectionsFor(node);
        if (all.length) out.push({ node, rejected: all });
      };
      /**
       * First, and at most one: a reader scanning the list sees the setup
       * problem before the symptoms.
       *
       * `pageProblems()` is read **here**, not snapshotted at construction.
       * Those are problems with no element to hang them on — a module handed to
       * `wireMotion`, an option handed to a module's factory — and this is the
       * list the GUI renders, so a page whose module never wired otherwise sees
       * an attribute reported as unknown and no reason why.
       *
       * It was a copy taken in `createMotion`, which silently made the channel
       * wiring-time-only: `@verajs/motion/paint` records its slot-table cap
       * when it parses a value, which is after every instance was constructed,
       * so the sentence explaining the cap reached the *next* instance and
       * never the one running. Element rejections are merged at read time two
       * lines below for the same reason.
       */
      const setup = [...pageProblems(), ...configProblems];
      if (setup.length) out.push({ node: null, rejected: setup });
      for (const entry of dropped) add(entry.node, entry.rejected);
      for (const element of elements) {
        /**
         * Merged at read time from the element's current state, so it appears
         * while it is true and stops appearing when the page grows enough for
         * the animation to finish.
         */
        /**
         * Both live answers, not one — an element can be pinned inside a
         * clipping wrapper *and* on a page too short to finish, and reporting
         * whichever was checked first would hide the other.
         */
        const live: string[] = [];
        if (element.unfinishable) {
          live.push(__DEV__ ? 'the page ends before this animation does; it stops part way through.' : 'unfinishable: page too short');
        }
        if (element.pinBlocked) live.push(element.pinBlocked);
        if (element.flatBlocked) live.push(element.flatBlocked);
        if (element.cascadeBlocked) live.push(element.cascadeBlocked);
        add(element.node, live.length ? [...element.parsed.rejected, ...live] : element.parsed.rejected);
      }
      /**
       * And the elements a module refused that this instance knows by no other
       * route.
       *
       * The two loops above are "what I adopted" and "what I dropped", and a
       * module refuses things about neither: `split` is keyed by the
       * **container**, whose bare marker is optional, so a paragraph written
       * `data-vm-split="words"` alone appears in no list here. Every
       * refusal about it — nested markup, an unknown mode, the piece cap — was
       * recorded and read by nobody, while the README said `rejected` holds
       * every refusal.
       *
       * Scoped to this instance's roots, because wiring is page-level and the
       * refusals are not: another instance's container is not this one's to
       * report. And deduped against `byNode`, or a node that *is* adopted
       * would be listed twice.
       */
      for (const node of rejectedNodes()) {
        if (!inRoots(node)) continue;
        /**
         * One guard, not two. This also asked `byNode.has(node)` first, which
         * is a second way of spelling the same question and the narrower of
         * the two: an element in `dropped` is not in `byNode` and still must
         * not be listed twice. The mutation suite said so by surviving the
         * removal of the narrow one — two guards for one invariant is one
         * guard nobody can prove.
         */
        if (out.some((entry) => entry.node === node)) continue;
        add(node, []);
      }
      return out;
    },

    get enabled() {
      return enabled;
    },

    get reducedMotion() {
      return reducedMotion;
    },

    get touchDisabled() {
      return touchDisabled;
    },

    collect() {
      if (!started) return;
      collect();
      retrack();
      paintNow();
      start();
    },

    refresh() {
      /**
       * Nothing to measure before `init()` — or where `init()` found no DOM
       * and returned. `collect()` carries the same guard; this one did not,
       * so `refresh()` on an inert instance read `document.documentElement`
       * through `getWindowSize` and threw out of an SSR render. Every other
       * method on this surface is a no-op there.
       */
      if (!started) return;
      measure();
      update();
      /**
       * State-driven elements too. `update()` returns immediately for them —
       * they are driven by their selector, not by scroll — so without this
       * `refresh()` brought everything up to date *except* them. With
       * `observeMutations: false` that left `data-vm-when` with no way to be
       * driven at all: the observer was the only thing that ever called it.
       *
       * Forced, for the reason the resize path gives: a re-measure can rebuild
       * the curve under a selector whose answer has not changed, and the
       * unforced path returns early on exactly that.
       */
      updateState(undefined, true);
    },

    observe(root: ParentNode) {
      if (!usableRoot(root)) {
        configProblems.push(__DEV__ ? 'observe() was given something that is not an element or document' : 'observe(): not an element');
        return;
      }
      if (roots.has(root)) return;
      roots.add(root);
      if (!started) return;
      watch(root);
      /**
       * **This root, and synchronously.** `prepare` first, because that is what
       * runs the modules that rewrite the DOM — parsing directly skipped them,
       * so a `data-vm-split` paragraph inside a newly observed shadow
       * root was adopted whole and animated as one block.
       *
       * Registering 400 closed shadow roots one at a time — which is what a
       * framework built on them does, one `observe()` per component — cost
       * **779ms** before the painting moved out of the call. It is the writes
       * that could not happen here, not the adoption: see `unpainted`.
       */
      runInserts('prepare', root, enabled);
      applyChanges(findElements(root));
    },

    unobserve(root: ParentNode) {
      if (!roots.delete(root)) return;
      /**
       * Stop watching it first. A `MutationObserver` has no per-target
       * unobserve, so disconnecting and re-observing what is left is the only
       * way — and it has to happen before anything below touches the DOM.
       *
       * Without it the runtime went on reacting to a root it had given up, and
       * gave it straight back: releasing the modules puts a split paragraph's
       * animation attributes back on the container, the observer read that as
       * an attribute change on a marked element, and re-adopted and animated
       * the element a frame later. The root came away carrying an inline
       * `filter` from an instance that no longer owned it.
       *
       * The cost is a batch of records queued and not yet delivered, for every
       * root, discarded by `disconnect()`. Those are mutations from earlier in
       * this same task; `unobserve` is a mount-time call, and the alternative
       * is re-entering the observer's own callback by hand.
       */
      unwatch(root);
      const gone = new Set<RuntimeElement>();
      for (const element of elements) {
        if (!root.contains(element.node)) continue;
        /**
         * Per adopted element, exactly as `clear()` does it — this is the
         * element-leaving half of the contract, and `unobserve` is the one
         * caller where it would otherwise be skipped.
         */
        runInserts('release', element.node);
        drop(element);
        clearElement(element, runtimeSettings);
        gone.add(element);
      }
      elements = elements.filter((e) => !gone.has(e));
      /**
       * And the same question `destroy()` asks, narrowed to this root.
       *
       * The loop above only reaches nodes this instance *adopted*, and a
       * module's own bookkeeping is not that set. `split` is keyed by the
       * *container*, which carries no animation of its own — splitting keys
       * off `data-vm-split` and the animation attributes move to the
       * pieces — so a container was missed here, and having been dropped from
       * `roots` it was then missed by `destroy()` as well. The paragraph
       * stayed in three pieces for the life of the page, with no instance left
       * that could put it back.
       *
       * This used to be a second pass first: a `querySelectorAll` for the bare
       * marker, released node by node. It was a net cast to catch the split
       * container, and it caught it — but so does this line, for every node
       * the root owns rather than only the marked ones, which is why it was
       * added. Two passes then did the same work, and removing the first one
       * changed nothing any test could see. Kept as the mutation that found
       * it: `modules: unobserve leaves a root rewritten`.
       *
       * Asking rather than netting: a module answers about what it holds, and
       * a node it does not know is a no-op. Calling it again from `destroy()`
       * is harmless for the same reason — by then it holds nothing here.
       */
      runInserts('teardown', (node: Node) => root === node || root.contains(node));
      /**
       * **No `retrack()`.** It rebuilds the tracker over every element and
       * reads the window to size the margin — a layout read, taken right after
       * `clearElement` above has written style, so every call forced a layout:
       * **478ms to give up 400 roots**, the same read-after-write shape as the
       * mount path.
       *
       * Nothing is left stale by leaving it. `drop()` already unobserves each
       * element from the tracker, so the margin is the only thing out of date —
       * and it can only be *larger* than it needs to be, which tracks more
       * elements than necessary rather than fewer. `measure()` rebuilds it
       * unconditionally on the next resize, mutation or `refresh()`.
       */
    },

    get elements() {
      return elements;
    },
  };
};

