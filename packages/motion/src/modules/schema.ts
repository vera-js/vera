/**
 * The single source of truth for the attribute API.
 *
 * Everything that needs to know what is animatable derives from this file:
 * the runtime parser, GUI editor controls, and the docs. One definition,
 * many consumers, so they cannot drift (principles #5 and #7).
 *
 * Attribute grammar:
 *
 *   data-vera-motion                                marker, or a preset name
 *   data-vera-motion-<property>="<value>"           end value (sugar)
 *   data-vera-motion-<property>="<pos> <value>, …"  keyframes
 *   data-vera-motion-<property>-<breakpoint>="…"    tablet / mobile override
 *
 * A position always carries a unit; a value may or may not. That one rule is
 * what keeps a lone number unambiguously a value, so the sugar and the list
 * form can coexist.
 *
 * Positions use standard CSS units — `%` `vh` `vw` `px` `rem`. `%` is a
 * percentage of the scroll window (element size + viewport), which is what
 * CSS's own `animation-range` means by a percentage of `cover`. Values outside
 * 0-100 extrapolate, bounded by MIN_PERCENT / MAX_PERCENT.
 *
 * The category (transform / filter / …) is deliberately absent from the
 * attribute: `translate-y` is always a transform, so it is derived here
 * rather than repeated in every attribute on the page.
 */

/**
 * Re-exported so every consumer still has one place to import from, while the
 * definitions live in a module `scroll-to` can take without the tables below.
 * See namespace.ts for why that split exists.
 */
export { NAMESPACE, ATTRIBUTE_PREFIX, SUB_PREFIX, SCROLL_TARGET_ATTRIBUTE } from './namespace.js';
import { SUB_PREFIX } from './namespace.js';
import { pageProblem } from './rejections.js';
import type { Easing } from './timing.js';
/** Re-exported so a module names one import, not two. */
export type { Easing } from './timing.js';

/** Timeline bounds, as percentages. */
export const MIN_PERCENT = -300;
export const MAX_PERCENT = 300;


export const CATEGORIES = [
  'transform',
  'filter',
  'border',
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Unit allowlist. A fixed list is a security boundary, not a convenience:
 * unit strings are never passed through from an attribute (principle #8).
 */
export const UNITS = ['px', 'deg', '%', 'rem', 'em', 'vh', 'vw', ''] as const;
export type Unit = (typeof UNITS)[number];

export interface PropertyDef {
  /** Attribute spelling, kebab-case: `translate-y`. */
  readonly attribute: string;
  readonly parse?: (raw: string) => number | null;
  /**
   * Writes the value. A returned string is a **refusal** — the reason reaches
   * `MotionInstance.rejected`, recorded once however many frames later call
   * this. Returning nothing is the ordinary case.
   *
   * Typed `void | string` rather than `void` on purpose: TypeScript lets a
   * value-returning function satisfy a `void` return type, so a module could
   * return a reason, typecheck cleanly, and have it silently dropped.
   */
  readonly apply?: (node: HTMLElement, value: number) => void | string;
  /** Derived, never authored. */
  /**
   * Derived for built-ins, and free-form for a module — the union keeps
   * autocomplete for the known values while letting a module name its own group
   * for the GUI to render. Only transform, filter and image change behaviour;
   * everything else is a plain cssProperty write.
   */
  readonly category: Category | (string & {});
  /** For transform/filter functions: `translateY`, `blur`. */
  readonly cssFunction?: string;
  /** For plain CSS properties: `border-top-left-radius`. */
  readonly cssProperty?: string;
  readonly defaultUnit: Unit;
  readonly units: readonly Unit[];
  readonly min?: number;
  readonly max?: number;
  /** Value when the element is not animating — its resting state. */
  readonly initial: number;
  /**
   * The import specifier of the module that contributes this attribute, and
   * **absent for core's own** — `getProperty('background')?.from` answers
   * `'@verajs/motion/paint'`, `getProperty('opacity')?.from` answers nothing.
   *
   * A GUI editor is the reason it exists. A panel iterating the vocabulary
   * could describe an attribute completely and still not tell an author what
   * to import to make it work, which is the one sentence they need when a
   * module is not wired — and the runtime's own refusal for that case names
   * the module, so the information existed everywhere except the API. Both
   * `scripts/generate-reference.js` and `scripts/check-examples.js` had
   * already grown the same workaround, wiring one module at a time and
   * diffing the registry to recover what the definitions never said; a
   * workaround appearing twice in a repo's own tools is the argument for the
   * field.
   *
   * Absent rather than `'core'` so the 22 built-in definitions carry no
   * string at all, and a module names its specifier once through a shared
   * constant rather than per property. Audit rule 29 holds a module to
   * declaring it.
   */
  readonly from?: string;
  /**
   * The values are not on a number line — each is a slot in the module's own
   * table, so the runtime holds one until the next keyframe rather than
   * interpolating towards it. Interpolating produced a value between two
   * slots, and `Math.floor` of that is somebody else's.
   */
  readonly discrete?: boolean;
}

const LENGTH_UNITS = ['px', 'rem', 'em', '%', 'vh', 'vw'] as const;
const NO_UNITS = [''] as const;

export const PROPERTIES = [
  // transform
  { attribute: 'translate-x', category: 'transform', cssFunction: 'translateX', defaultUnit: 'px', units: LENGTH_UNITS, initial: 0 },
  { attribute: 'translate-y', category: 'transform', cssFunction: 'translateY', defaultUnit: 'px', units: LENGTH_UNITS, initial: 0 },
  { attribute: 'translate-z', category: 'transform', cssFunction: 'translateZ', defaultUnit: 'px', units: LENGTH_UNITS, initial: 0 },
  { attribute: 'rotate',      category: 'transform', cssFunction: 'rotate',     defaultUnit: 'deg', units: ['deg'], initial: 0 },
  { attribute: 'rotate-x',    category: 'transform', cssFunction: 'rotateX',    defaultUnit: 'deg', units: ['deg'], initial: 0 },
  { attribute: 'rotate-y',    category: 'transform', cssFunction: 'rotateY',    defaultUnit: 'deg', units: ['deg'], initial: 0 },
  { attribute: 'scale',       category: 'transform', cssFunction: 'scale',      defaultUnit: '',   units: NO_UNITS, min: 0, initial: 1 },
  { attribute: 'scale-x',     category: 'transform', cssFunction: 'scaleX',     defaultUnit: '',   units: NO_UNITS, min: 0, initial: 1 },
  { attribute: 'scale-y',     category: 'transform', cssFunction: 'scaleY',     defaultUnit: '',   units: NO_UNITS, min: 0, initial: 1 },
  { attribute: 'skew-x',      category: 'transform', cssFunction: 'skewX',      defaultUnit: 'deg', units: ['deg'], initial: 0 },
  { attribute: 'skew-y',      category: 'transform', cssFunction: 'skewY',      defaultUnit: 'deg', units: ['deg'], initial: 0 },

  // filter
  { attribute: 'opacity',    category: 'filter', cssFunction: 'opacity',    defaultUnit: '',  units: NO_UNITS, min: 0, max: 1, initial: 1 },
  { attribute: 'blur',       category: 'filter', cssFunction: 'blur',       defaultUnit: 'px', units: ['px', 'rem', 'em'], min: 0, initial: 0 },
  { attribute: 'brightness', category: 'filter', cssFunction: 'brightness', defaultUnit: '',  units: NO_UNITS, min: 0, initial: 1 },
  { attribute: 'contrast',   category: 'filter', cssFunction: 'contrast',   defaultUnit: '',  units: NO_UNITS, min: 0, initial: 1 },
  { attribute: 'saturate',   category: 'filter', cssFunction: 'saturate',   defaultUnit: '',  units: NO_UNITS, min: 0, initial: 1 },
  { attribute: 'grayscale',  category: 'filter', cssFunction: 'grayscale',  defaultUnit: '',  units: NO_UNITS, min: 0, max: 1, initial: 0 },

  // border
  /**
   * All four corners at once. Declared *before* the individual corners on
   * purpose: apply order follows this table, so writing the shorthand first
   * lets a specific corner override it, which is the way round CSS itself
   * works and the way an author expects.
   */
  { attribute: 'radius',              category: 'border', cssProperty: 'border-radius',              defaultUnit: 'px', units: LENGTH_UNITS, min: 0, initial: 0 },
  { attribute: 'radius-top-left',     category: 'border', cssProperty: 'border-top-left-radius',     defaultUnit: 'px', units: LENGTH_UNITS, min: 0, initial: 0 },
  { attribute: 'radius-top-right',    category: 'border', cssProperty: 'border-top-right-radius',    defaultUnit: 'px', units: LENGTH_UNITS, min: 0, initial: 0 },
  { attribute: 'radius-bottom-left',  category: 'border', cssProperty: 'border-bottom-left-radius',  defaultUnit: 'px', units: LENGTH_UNITS, min: 0, initial: 0 },
  { attribute: 'radius-bottom-right', category: 'border', cssProperty: 'border-bottom-right-radius', defaultUnit: 'px', units: LENGTH_UNITS, min: 0, initial: 0 },
] as const satisfies readonly PropertyDef[];

/**
 * Every pre-rewrite capability is accounted for: what is not in this table
 * ships as a module (`path`, `frame`, the paint properties). Nothing is listed
 * here without an apply path — an attribute that parses cleanly and then does
 * nothing is a worse failure than a clear rejection (principle #8).
 */

export type PropertyName = (typeof PROPERTIES)[number]['attribute'];

const BY_ATTRIBUTE = new Map<string, PropertyDef>(
  PROPERTIES.map((p) => [p.attribute, p as PropertyDef])
);

/**
 * The definition for an attribute name, or undefined if there is none.
 *
 * @param name the attribute spelling, e.g. `translate-y`
 */
export const getProperty = (name: string): PropertyDef | undefined =>
  BY_ATTRIBUTE.get(name);

/**
 * Declaration order, used to compose transform strings deterministically.
 *
 * CSS transform functions do not commute — `translate` then `rotate` is a
 * different result from `rotate` then `translate`. The old parser appended in
 * whatever order the attributes happened to be read, so the same animation
 * could render differently depending on attribute order in the markup. The
 * array above is ordered translate -> rotate -> scale -> skew, the usual
 * convention, and this makes that ordering authoritative.
 */
const ORDER = new Map<string, number>(
  PROPERTIES.map((p, index) => [p.attribute, index])
);

/**
 * A property's index in `PROPERTIES`, which is the order it must be written to
 * the DOM in. CSS transform functions do not commute, so this is load-bearing
 * rather than cosmetic.
 *
 * @returns the declaration index; lower is applied first
 */
export const propertyOrder = (property: PropertyDef): number =>
  ORDER.get(property.attribute) ?? Number.MAX_SAFE_INTEGER;

/**
 * Every property the runtime currently knows — built-ins and wired modules alike.
 *
 * `PROPERTIES` is the built-in table and nothing else, so a GUI generating
 * controls by iterating it silently omits everything a module contributed:
 * `background`, `color`, `border-color`, `shadow`, `text-shadow`, `frame`.
 * Modules are how the vocabulary grows, which makes that most of the point of
 * publishing the vocabulary at all — and the omission is silent, because every
 * one of those attributes still parses and animates perfectly well when
 * written by hand.
 *
 * A function rather than an array because wiring happens at page load: a value
 * captured at import time would be the built-in table again, which is the bug
 * this exists to avoid.
 */
export const properties = (): readonly PropertyDef[] => [...BY_ATTRIBUTE.values()];

/**
 * Whether a name is an animatable property. A type guard, so a GUI can narrow
 * a string it read from markup.
 */
export const isProperty = (name: string): name is PropertyName =>
  BY_ATTRIBUTE.has(name);

/**
 * Element-level settings. Kept in a namespace disjoint from property names so
 * `data-vera-motion-<name>` resolves unambiguously; a test enforces that.
 */
export interface SettingDef {
  /**
   * A module's own validator, given the raw attribute text. Returning null
   * rejects it, exactly as a built-in type would. This is what lets a module own
   * the settings that configure it without the runtime knowing their shape —
   * `frame-url` validates an origin policy the runtime no longer carries.
   */
  readonly parse?: (raw: string) => string | number | boolean | null;
  /**
   * The import specifier of the module that contributes this setting, and
   * **absent for core's own** — `getProperty('background')?.from` answers
   * `'@verajs/motion/paint'`, `getProperty('opacity')?.from` answers nothing.
   *
   * A GUI editor is the reason it exists. A panel iterating the vocabulary
   * could describe an attribute completely and still not tell an author what
   * to import to make it work, which is the one sentence they need when a
   * module is not wired — and the runtime's own refusal for that case names
   * the module, so the information existed everywhere except the API. Both
   * `scripts/generate-reference.js` and `scripts/check-examples.js` had
   * already grown the same workaround, wiring one module at a time and
   * diffing the registry to recover what the definitions never said; a
   * workaround appearing twice in a repo's own tools is the argument for the
   * field.
   *
   * Absent rather than `'core'` so the 22 built-in definitions carry no
   * string at all, and a module names its specifier once through a shared
   * constant rather than per property. Audit rule 29 holds a module to
   * declaring it.
   */
  readonly from?: string;
  readonly attribute: string;
  readonly type:
    | 'number' | 'boolean' | 'string' | 'url' | 'selector' | 'length'
    /** A CSS timing function. Validated by grammar, not passed through. */
    | 'easing'
    /** A CSS transform-origin. Validated by grammar, not passed through. */
    | 'origin'
    /** A keyframe-position offset: a number with an optional unit, `%` by default. */
    | 'offset';
  /** Bounds for `number`. A setting without them is unbounded, which is a bug. */
  readonly min?: number;
  readonly max?: number;
  readonly allowed?: readonly string[];
}

/**
 * Every numeric setting carries bounds, for the same reason every property
 * does: an attribute value is untrusted, and a number with no ceiling reaches
 * the DOM as one.
 *
 * These are not defensive decoration. Measured, before they existed:
 * `speed="99999999"` produced `transition-duration: 1e+08s`, freezing the
 * element's transform and filter permanently; `frame-pad="10000000"` made
 * `padStart` allocate a 10 MB string for every frame drawn.
 */
export const SETTINGS = [
  /**
   * How much the element resists the scroll position it is told to be at,
   * in seconds. `0` tracks scroll exactly.
   *
   * **This concept has one name here: inertia.** The same idea is called
   * momentum, damping, smoothing, `scrub` (GSAP) and `lerp` (Lenis) elsewhere;
   * none of those are attributes in this library. Inertia is the physically
   * apt one — it is a property you set that governs resistance to a change in
   * motion, where momentum is an instantaneous quantity you could not set as a
   * constant. `inertia-ease` shapes it.
   *
   * An hour is already absurd; beyond it is an attack.
   */
  { attribute: 'inertia', type: 'number', min: 0, max: 3600 },
  /**
   * Pin the element to the viewport while its animation runs, then release it.
   *
   * The value is the distance from the leading edge of the scrollport to hold
   * it at: `data-vera-motion-pin="120px"`. Which edge follows
   * `scrollDirection` — `top` for a vertical instance, `inset-inline-start` for a horizontal
   * one, since pinning against an edge nothing is moving past does nothing.
   * Implemented as `position: sticky`, which is correct by construction — the
   * element never leaves the layout flow, so content after it neither jumps
   * when it attaches nor collapses when it releases. How long it stays pinned
   * is the extent of its containing block along that axis, exactly as CSS
   * sticky behaves.
   *
   * The pre-rewrite code did this by switching to `position: fixed` and
   * computing a `top` and a compensating `margin-top` by hand. That worked
   * only for the specific numbers it was written against; sticky needs none
   * of the arithmetic.
   */
  { attribute: 'pin', type: 'length' },
  /**
   * Depth for the 3D transform properties, as a distance from the viewer.
   *
   * Without it `translate-z` is **inert** — measured: `translateZ(200px)` leaves
   * a 100x100 box at exactly 100x100 with no perspective ancestor, and doubles
   * it with one. `rotate-x` and `rotate-y` work either way but read as flat
   * squashing rather than rotation.
   *
   * Applied as the `perspective()` transform *function* on the element itself,
   * not the `perspective` property on its parent, so an author needs no
   * cooperation from the surrounding markup. It rides the existing transform
   * prefix — the same mechanism `translateZFix` uses.
   */
  { attribute: 'perspective', type: 'length' },
  /** Per-category overrides, so one element can move fast and fade slowly. */
  { attribute: 'transform-inertia', type: 'number', min: 0, max: 3600 },
  { attribute: 'filter-inertia', type: 'number', min: 0, max: 3600 },
  /**
   * The shape of the *inertia* — the CSS timing function of the transition
   * that carries the element to where scroll says it should be. Compositor
   * side; nothing in JS evaluates it.
   *
   * Because the runtime rewrites that transition's target every frame, only
   * the first ~17% of the curve is ever traversed, so what this really
   * controls is how stiffly the element chases. Measured at `inertia: 0.1`:
   * `ease-in` trails by 113px mid-scroll, the default by 8px.
   */
  { attribute: 'inertia-ease', type: 'easing' },
  /**
   * The shape of the *curve* — the relationship between scroll position and
   * value. `linear` by default, which is what the library has always done.
   *
   * This cannot be handed to CSS. A transition runs on a timer and has no way
   * to ask where the scrollbar is, and the one CSS mechanism that does know
   * (`animation-timeline`) cannot be damped: an animation overrides a
   * transition, so it would mean giving up inertia entirely. Measured in
   * Chromium and WebKit; Firefox has no `animation-timeline` at all.
   *
   * Applies per segment, as `@keyframes` does.
   */
  { attribute: 'ease', type: 'easing' },
  { attribute: 'run-once', type: 'boolean' },
  /**
   * Drive this element from a selector match instead of from scroll.
   *
   * While the element matches, the animation sits at its end; while it does
   * not, at its start. `data-vera-motion-when=".is-open"` — any selector, so classes,
   * ids, attributes and combinations all work.
   *
   * It replaces the driver rather than adding to it: an element is scroll-driven
   * or state-driven, never both. Everything downstream is unchanged, which is
   * the point — keyframes, breakpoints and the damping behave identically, and
   * `run-once` still means "play through once and latch".
   */
  /**
   * Its own parser only to say that a list is allowed: `when` is evaluated
   * with `matches()`, where `a, b` means "either", and the shared validator
   * defaults to refusing lists for `querySelector` callers' sake —
   * `@verajs/motion/path` hands it one.
   */
  { attribute: 'when', type: 'selector', parse: (raw) => parseSelector(raw, true) },
  /**
   * Offsets each animated descendant's keyframes by `index x value`, so a row
   * of cards arrives one after another instead of in unison.
   *
   * It goes on the **parent**, which is the only place it can: the whole point
   * is the relationship between siblings, and siblings that share a Y position
   * share a scroll window and therefore animate identically. That is right for
   * a hero and wrong for a list.
   *
   * `%` by default, and any position unit is accepted — the offset is
   * normalised against geometry exactly as a keyframe position is, which is
   * why `stagger="40px"` composes correctly with `translate-y="0% ..."` even
   * though the two units resolve differently.
   */
  { attribute: 'stagger', type: 'offset' },
  { attribute: 'will-change', type: 'boolean' },
  { attribute: 'transform-origin', type: 'origin' },
] as const satisfies readonly SettingDef[];

const BY_SETTING = new Map<string, SettingDef>(
  SETTINGS.map((setting) => [setting.attribute, setting as SettingDef])
);

/**
 * Every setting the runtime currently knows, modules included — the companion to
 * `properties()`, and omitted for the same reason: `sequence` owns `frame-url`,
 * `frame-count`, `frame-pad` and `frame-ext`, and `split` owns `split`. A GUI
 * reading `SETTINGS` alone offers none of them.
 */
export const settings = (): readonly SettingDef[] => [...BY_SETTING.values()];

/** The definition for a setting name, or undefined. Includes anything wired. */
export const getSetting = (name: string): SettingDef | undefined => BY_SETTING.get(name);
/** Whether a name is an element-level setting rather than an animatable property. */
export const isSetting = (name: string): boolean => BY_SETTING.has(name);

export interface ParsedAttribute {
  readonly property: PropertyDef;
  /** The range a name suffix stood for, or null for the unsuffixed attribute. */
  readonly range: Range | null;
}

/**
 * Resolves an attribute NAME to its property, and any trailing name suffix to
 * the range that name was registered for.
 *
 * The suffix set is **not** fixed. `tablet` and `mobile` used to be baked in
 * here with two width options beside them, which meant a site could have
 * exactly those two bands at exactly those two names. A name is now an alias a
 * site registers, and it resolves to a range right here — so nothing
 * downstream ever sees a name.
 *
 * @param name e.g. `data-vera-motion-translate-y` or `data-vera-motion-translate-y-mobile`
 * @param breakpoints the registered aliases, if any
 */
export const parseAttributeName = (
  name: string,
  breakpoints?: ReadonlyMap<string, Range>
): ParsedAttribute | null => {
  if (!name.startsWith(SUB_PREFIX)) return null;

  const rest = name.slice(SUB_PREFIX.length);

  /**
   * An exact property name wins over a band split, always.
   *
   * Load-bearing, because several property names end in something that could
   * be a breakpoint alias: `rotate-x`, `path-rotate`, `frame-ext`. Without
   * exact-match-first, registering a breakpoint called `x` would turn
   * `rotate-x` into "rotate, at the x band" and the real property would become
   * unreachable.
   *
   * The cost is the mirror image, and it is the lesser one: a site that does
   * register a breakpoint named `x` cannot then write `rotate` at that band,
   * because `rotate-x` is already a property. Deterministic either way, and
   * this direction keeps every documented attribute writable.
   */
  const direct = BY_ATTRIBUTE.get(rest);
  if (direct) return { property: direct, range: null };

  const cut = rest.lastIndexOf('-');
  if (cut < 0 || !breakpoints) return null;

  const range = breakpoints.get(rest.slice(cut + 1));
  const property = BY_ATTRIBUTE.get(rest.slice(0, cut));
  return range && property ? { property, range } : null;
};

/**
 * Says so when a registration replaces one that was already there.
 *
 * The registry is a `Map` keyed by attribute, so the last writer wins — and
 * `wireMotion({ attribute: 'opacity', … })` silently replaced the built-in
 * `opacity` page-wide, for every element and every instance. A module author
 * who picks a name core already has takes it from every page that wires them,
 * and nothing anywhere said so.
 *
 * Reported rather than refused: replacing a built-in deliberately is a thing
 * this library invites third parties to do — the README's whole custom-property
 * section — and a refusal would decide that for them. What is not acceptable is
 * doing it by accident and never finding out.
 *
 * **Identity, not equality.** Wiring one module twice re-registers the *same*
 * descriptor objects, which is idempotent and not a clash — `wireMotion(paint)`
 * twice must stay quiet. A factory called twice makes new ones, and those do
 * clash: two `sequence()` instances each keep their own drawer state and only
 * one of them is reachable.
 */
const clash = (prior: unknown, next: unknown, kind: string): void => {
  if (prior && prior !== next) {
    pageProblem(
      __DEV__
        ? `wireMotion replaced the "${(next as { attribute: string }).attribute}" ${kind}, which was ` +
          'already registered. The earlier one is gone, for every element on the page.'
        : `wireMotion replaced "${(next as { attribute: string }).attribute}"`
    );
  }
};

/**
 * Installs property modules, first-party or third-party.
 *
 * ```js
 * import { createMotion, wireMotion } from '@verajs/motion';
 * import { paint } from '@verajs/motion/paint';
 *
 * wireMotion(paint);
 * createMotion().init();
 * ```
 *
 * The shape follows Vera's `wire`: what you hand it is
 * named for the thing, a module exports a descriptor and never registers itself,
 * and there is no positional form — an object cannot be misordered and
 * documents its own keys.
 *
 * **Take `wireMotion` from `@verajs/motion`, never from a submodule.** This is the
 * same rule, and the same hazard, as core's: the two entry points are
 * self-contained artifacts that inline what they use, so a module registering
 * through its own copy of the schema would write to a table the runtime never
 * reads. It would not throw. It would simply never animate.
 *
 * A wired property is an ordinary row — the apply path is already generic over
 * `cssFunction` and `cssProperty`, so nothing else has to know it arrived
 * late. Transform order follows registration order, so a wired transform
 * composes after every built-in one, which is the only order that can be
 * stable when modules do not know about each other.
 *
 * @param item one property definition, or an array of them
 */
export const wireMotion = (item: WirableTree): void => {
  /**
   * Flattened, because a module is often itself a list — `paint` is five
   * properties — and `wireMotion([paint, easings])` is the way anyone would
   * write it. Without this the inner array was treated as one property
   * definition, registered under `undefined`, and every property in it
   * silently never appeared. The preview page found it.
   */
  /**
   * Widened before flattening. `Array.flat(Infinity)` on a recursive element
   * type sends the checker into `Type instantiation is excessively deep`,
   * because it tries to compute the fully-flattened type — which for
   * `WirableTree` has no bottom. The runtime behaviour is what matters here
   * and the result is asserted on the next line.
   */
  for (const one of ([item] as unknown[]).flat(Infinity) as Wirable[]) {
    /**
     * A module that takes options is a factory, and calling it should be
     * optional: `wireMotion(sequence)` uses the defaults,
     * `wireMotion(sequence({ allowedOrigins }))` configures it. Vera makes the
     * same allowance — a module can be both a function and a descriptor — and
     * without it every module would have to be called even when there was
     * nothing to say.
     */
    if (typeof one === 'function') {
      /**
       * The same posture as the not-a-module guard below: a factory that throws — bad options,
       * a bug in a third-party module — should cost the page that module, not the page. Unguarded,
       * it threw at module scope, before `init()`, taking the page's own script down.
       */
      try {
        wireMotion((one as WirableFactory)());
      } catch (error) {
        pageProblem(`a module factory threw while wiring: ${String(error)}`);
      }
      continue;
    }

    /**
     * Something that is not a descriptor at all.
     *
     * `wireMotion` is a public export and the documented call is
     * `wireMotion(split)`. A default import of a named export is `undefined`,
     * which is the ordinary way to get this wrong, and it threw `Cannot use
     * 'in' operator to search for 'on' in undefined` **at module scope** —
     * before `init()`, taking the page's own script down with it. A module that
     * cannot be wired should cost the page that module, not the page.
     */
    if (!one || typeof one !== 'object' || !('on' in one || 'attribute' in one)) {
      pageProblem(__DEV__ ? `wireMotion was given something that is not a module: ${String(one)}` : `not a module: ${String(one)}`);
      continue;
    }

    /**
     * A descriptor is anything that names an insert point, and that is tested
     * first — the same order core uses, and for the same reason: a module may
     * one day be both, and testing the other way round would silently install
     * it as the wrong thing.
     */
    if ('on' in one) {
      const chain = INSERTS.get(one.on) ?? [];
      /**
       * By identity, so wiring one module twice is a no-op here too. The Map-keyed rows always
       * had that (same descriptor, same slot); the chains did not — `wireMotion(split)` twice ran
       * every `prepare` and `teardown` twice, while the clash docblock above promised idempotence
       * for exactly this gesture.
       */
      if (!chain.includes(one.fn)) chain.push(one.fn);
      INSERTS.set(one.on, chain);
    }
    /**
     * A setting declares a `type`; a property declares a `category`. That is
     * the whole distinction, and it is checked rather than guessed — a module
     * that owns a behaviour usually owns the settings that configure it, and
     * without this those settings would be reported as unknown attributes on
     * every element that used them.
     *
     * **Both is not a third kind, it is a mistake**, and resolving it by which
     * line comes first is the worst of the three options. A descriptor written
     * `{ attribute: 'nudge', type: 'length', category: 'transform', … }` was
     * installed as a setting, so the property never existed; every element
     * using it had the attribute refused, with the attribute's own name as the
     * whole of the reason. TypeScript refuses that literal, which is why this
     * only reaches an author writing JavaScript — which is a GUI editor, the demo
     * pages, and every hand-written page. It cost an afternoon here, in a test
     * that had therefore never had an adopted element and passed anyway.
     */
    else if ('type' in one && 'category' in one) {
      pageProblem(
        __DEV__
          ? `wireMotion was given "${one.attribute}" with both a type and a category. A setting ` +
            'declares a type and a property declares a category; one descriptor cannot be both.'
          : `"${one.attribute}": type and category`
      );
    }
    else if ('type' in one) {
      clash(BY_SETTING.get(one.attribute), one, 'setting');
      BY_SETTING.set(one.attribute, one);
    }
    /**
     * And a property has to be able to write something. With no `cssProperty`,
     * no `cssFunction` and no `apply`, it parses values and puts them nowhere:
     * the attribute is accepted, nothing is reported, and nothing moves —
     * which is the silent-inert shape `no-silent-pair.test.js` exists for, one
     * level up at the descriptor.
     */
    else if (!('cssProperty' in one) && !('cssFunction' in one) && !('apply' in one)) {
      pageProblem(
        __DEV__
          ? `wireMotion was given the property "${one.attribute}" with no cssProperty, cssFunction or ` +
            'apply, so it has no way to write anything.'
          : `"${one.attribute}": nothing to write`
      );
    }
    else {
      clash(BY_ATTRIBUTE.get(one.attribute), one, 'property');
      BY_ATTRIBUTE.set(one.attribute, one);
      if (!ORDER.has(one.attribute)) ORDER.set(one.attribute, ORDER.size);
    }
  }
};

/**
 * What an insert point is called, and what it must be.
 *
 * A typed map rather than bare strings because a misspelled insert point that
 * silently never fires is the failure this whole mechanism is most likely to
 * produce.
 */
export interface InsertMap {
  /** Turns an `ease` value into a curve shaper. `@verajs/motion/easings`. */
  easing: (value: string) => Easing | null;
  /**
   * Runs over a root **before** its elements are collected, so a module can
   * change the DOM the runtime is about to read. `@verajs/motion/split` uses
   * it: the pieces it creates are then found by the ordinary scan, and nothing
   * downstream knows they were not written by hand.
   *
   * `enabled` says whether anything will actually animate — false under
   * reduced motion, or while disabled. A module that rewrites the DOM should do
   * nothing then: `aria-hidden` spans for an animation that will not run are
   * pure cost. `enable()` re-collects, so the work happens if it is ever
   * wanted.
   */
  prepare: (root: ParentNode, enabled: boolean) => void;
  /**
   * One element is leaving — removed from the page, or the instance is being
   * cleared. A module holding anything keyed by that node releases it here.
   */
  release: (node: Element) => void;
  /**
   * The instance is being torn down, or one root is being handed back by
   * `unobserve` — `owns` is what distinguishes them. A module that changed the
   * page puts it back; a module holding page-wide state drops it.
   *
   * `owns` says whether a node belongs to the instance doing the tearing down,
   * and a module **must** consult it. Wiring is page-level while instances are
   * not, so without it one instance's `destroy()` reaches every other
   * instance's state: `@verajs/motion/split` put back paragraphs a second,
   * still-live instance was animating, leaving it holding pieces that were no
   * longer in the document.
   *
   * Ownership is by root, which is exact for instances with disjoint roots —
   * the case `observe(shadowRoot)` exists for. Two instances sharing the
   * default `document` root own each other's nodes and cannot be told apart
   * here; that configuration registers every element twice and is not
   * supported regardless.
   */
  teardown: (owns: (node: Node) => boolean) => void;
  /**
   * **No instance is animating this page any more** — the last live one has
   * been destroyed. A module holding state for the *page*, rather than for an
   * element or an instance, drops it here.
   *
   * The third and widest of the three lifetimes, and the one nothing could
   * express before. `release` is one element leaving; `teardown` is one
   * instance finishing, which is why it takes `owns`; this is the page having
   * no runtime on it at all, so there is nothing to own and no argument to
   * take. Core counts live instances and fires it on the transition to zero,
   * so a module never has to guess whether a second instance is still running
   * — the question it structurally cannot answer for itself.
   *
   * `@verajs/motion/paint` is the case that argued for it. Its slot table can
   * never reclaim a slot while a curve might hold the number, so it only ever
   * grew: an editor session minted one per colour-picker frame and, past the
   * bound, refused every later colour **for the life of the page** — measured,
   * with `destroy()` and a fresh instance both leaving it full, because module
   * state outlives every instance. When no instance is live no curve exists,
   * so no slot is referenced, and the table is safe to empty. An editor's
   * ordinary destroy-and-rebuild now recovers on its own.
   *
   * Fires *after* `teardown`, so a module can rely on its per-element work
   * having already run. Not fired by `disable()`: a toggle keeps parsed state
   * on purpose, and an instance that can be re-enabled is still live.
   */
  forget: () => void;
}

export type Insert = {
  [K in keyof InsertMap]: { readonly on: K; readonly fn: InsertMap[K] };
}[keyof InsertMap];

/** Anything `wireMotion` accepts: a property, or a descriptor naming an insert point. */
/** A module that takes options; calling it is optional. */
export type WirableFactory = () => WirableTree;

export type Wirable = PropertyDef | SettingDef | Insert | WirableFactory;

/**
 * What `wireMotion` accepts: a descriptor, a factory, or any nesting of arrays
 * of them.
 *
 * Recursive on purpose, because the nesting is real. A module is usually itself
 * a list — `paint` is five properties, `sequence()` returns a property plus
 * four settings plus three inserts — so `wireMotion([paint, easings])` is an
 * array *of arrays*, which is exactly what the docblock below tells people to
 * write and what the runtime flattens.
 *
 * The parameter used to be `Wirable | readonly Wirable[]`, one level deep. The
 * runtime flattened infinitely and the type did not, so the documented call
 * worked and did not compile — invisible here, because nothing type-checked a
 * consumer against the modules until one did.
 */
export type WirableTree = Wirable | readonly WirableTree[];

/**
 * A chain per insert point, not one function.
 *
 * Two modules commonly want the same point — `split` and `sequence` both need a
 * `teardown` — and a single slot meant the second silently replaced the first.
 * Nothing threw; one module simply stopped working, which is the failure Vera's
 * own chains exist to prevent.
 */
const INSERTS = new Map<keyof InsertMap, InsertMap[keyof InsertMap][]>();



/**
 * Everything wired into an insert point, in the order it was wired.
 *
 * A notification point (`prepare`, `release`, `teardown`) runs every entry; a
 * resolver (`easing`) takes the first that answers.
 *
 * @param name the insert point
 */
export const insert = <K extends keyof InsertMap>(name: K): InsertMap[K][] =>
  (INSERTS.get(name) ?? []) as InsertMap[K][];

/** Units a keyframe POSITION may use. All standard CSS — nothing to learn. */
export const POSITION_UNITS = ['%', 'vh', 'vw', 'px', 'rem'] as const;
export type PositionUnit = (typeof POSITION_UNITS)[number];

/** Absolute positions are capped so a typo cannot ask for a kilometre of scroll. */
const MAX_ABSOLUTE_POSITION = 100000;

/**
 * Caps on how many things one attribute may declare.
 *
 * Property *values* have been range-checked since the settings audit, but the
 * *counts* were unbounded, which is the same hole one level up: measured,
 * 200,000 keyframes in a single attribute parse in 92 ms and produce a curve
 * `evaluate` then scans on every frame. Ten is a busy animation; these are
 * generous by two orders of magnitude and still bound the work.
 */
/**
 * Exported so the generated reference can name them rather than restate them.
 *
 * It said "**Any number of keyframes.** There is no midpoint limit" — the
 * second half true and the first not, for as long as the cap has existed. The
 * sentence was written when `curve.ts` removed the LUT's hard cap of two
 * midpoints, and outlived the thing it was contrasting with.
 */
export const MAX_KEYFRAMES = 256;
export const MAX_BANDS = 32;

export interface RawKeyframe {
  /** In `positionUnit`, NOT yet normalised to a timeline fraction. */
  readonly position: number;
  readonly positionUnit: PositionUnit;
  readonly value: number;
  /** The value's own unit, from the property's allowlist. */
  readonly unit: Unit;
}

/**
 * A viewport-width range, in CSS pixels. `max` is `Infinity` for an open end.
 *
 * **The range is the primitive.** A registered name like `mobile` is an alias
 * that resolves to one of these at parse time, so the runtime only ever deals
 * in ranges and a name costs nothing once parsed.
 */
export interface Range {
  readonly min: number;
  readonly max: number;
}

/** Keyframes that apply only inside a range. */
export interface Band extends Range {
  readonly keyframes: readonly RawKeyframe[];
  readonly geometryDependent: boolean;
}

/**
 * Parses a range prefix: `[200-500]` closed, `[500+]` open at the top.
 *
 * There is no `[-500]` form. An open bottom is `[0-500]`, which is one
 * character longer and cannot be misread as negative five hundred.
 */
export const parseRange = (raw: string): Range | null => {
  const closed = /^\[\s*(\d+)\s*-\s*(\d+)\s*\]$/.exec(raw);
  if (closed) {
    const min = Number(closed[1]);
    const max = Number(closed[2]);
    return max >= min ? { min, max } : null;
  }
  const open = /^\[\s*(\d+)\s*\+\s*\]$/.exec(raw);
  return open ? { min: Number(open[1]), max: Infinity } : null;
};

export interface KeyframeList {
  readonly keyframes: readonly RawKeyframe[];
  /** True if any position uses a unit that depends on geometry (anything but `%`). */
  readonly geometryDependent: boolean;
  /** Entries that failed validation, for diagnostics. */
  readonly rejected: readonly string[];
}

/**
 * Parses a keyframe position — a number with a mandatory unit.
 *
 * The unit is mandatory, and that single rule is what lets a bare number stay
 * unambiguously a *value*, so `data-vera-motion-opacity="0"` can keep meaning
 * "animate to 0" alongside the list form.
 */
export const parsePosition = (
  raw: string
): { position: number; positionUnit: PositionUnit } | null => {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))(%|vh|vw|px|rem)$/.exec(raw);
  if (!match) return null;

  const position = Number(match[1]);
  const positionUnit = match[2] as PositionUnit;
  if (!Number.isFinite(position)) return null;

  if (positionUnit === '%') {
    return position >= MIN_PERCENT && position <= MAX_PERCENT
      ? { position, positionUnit }
      : null;
  }
  return Math.abs(position) <= MAX_ABSOLUTE_POSITION ? { position, positionUnit } : null;
};

/**
 * Parses a stagger offset — a position whose unit may be left off.
 *
 * The unit is optional here and mandatory on a keyframe position, and the
 * difference is deliberate: a keyframe entry has to stay unambiguous against a
 * bare *value* sharing the same attribute, and a stagger has nothing to be
 * ambiguous with. `data-vera-motion-stagger="8"` is what someone writes first, and it
 * means what they expect.
 *
 * @returns the canonical string with its unit, or null
 */
export const parseOffset = (raw: string): string | null => {
  const value = raw.trim();
  const parsed = parsePosition(/[a-z%]$/.test(value) ? value : `${value}%`);
  return parsed ? `${parsed.position}${parsed.positionUnit}` : null;
};

/**
 * Parses a whole keyframe list: `"-50% 0px, 30% 45px, 150% 400px"`.
 *
 * A lone token is the end value — the sugar that keeps the common case short.
 * Two tokens are a position and a value.
 *
 * A malformed entry drops only itself. The rest of the property still animates,
 * which is the same posture as everywhere else here: degrade to something
 * readable rather than fail whole (principle #8).
 */
/**
 * Splits an attribute value into its base keyframes and any banded overrides.
 *
 * ```
 *   "0% 0px, 100% 50px"                              base only
 *   "0% 0px, 100% 50px; [0-500]: 100% 20px"          base plus one band
 *   "0% 0px, 100% 50px; [900+]: 100% 200px"          open at the top
 * ```
 *
 * A value with no `[` takes the existing path untouched — one `indexOf`, which
 * measured at **3 ns** against the 475 ns the parse already costs. That is the
 * whole compatibility story: markup written before bands behaves identically,
 * and pays nothing for their existence.
 *
 * Bands **merge** onto the base rather than replacing it: an override at a
 * position the base already has replaces that value, and one at a new position
 * is added. That is what makes `[0-500]: 100% 20px` mean "same animation, less
 * travel on a phone" rather than "throw away the start keyframe".
 */
export const parseBandedList = (
  raw: string,
  property: PropertyDef
): { base: KeyframeList; bands: readonly Band[]; rejected: readonly string[] } => {
  if (!raw.includes('[')) {
    /**
     * A trailing `;` is the band separator with no band after it. With no
     * bands at all it is pure habit — and it used to reach `parseKeyframeList`
     * attached to the last value, so `"0% 0px, 100% 40px;"` lost its end
     * keyframe and the element sat at `translateY(0px)` for good. One
     * character of CSS muscle memory, and the animation was a third of what
     * was written.
     */
    const base = parseKeyframeList(raw.trim().replace(/;+$/, ''), property);
    /** The base's own rejects travel with it, or a bad keyframe reports nothing. */
    return { base, bands: [], rejected: base.rejected };
  }

  const rejected: string[] = [];
  const bands: Band[] = [];
  let base: KeyframeList | null = null;

  for (const chunk of raw.split(';')) {
    if (bands.length >= MAX_BANDS) {
      rejected.push(`more than ${MAX_BANDS} bands`);
      break;
    }
    const trimmed = chunk.trim();
    if (trimmed === '') continue;

    if (!trimmed.startsWith('[')) {
      /** An unbracketed segment is the base. A second one is a mistake. */
      if (base) rejected.push(trimmed);
      else {
        base = parseKeyframeList(trimmed, property);
        rejected.push(...base.rejected);
      }
      continue;
    }

    const close = trimmed.indexOf(']');
    const colon = trimmed.indexOf(':', close);
    const range = close < 0 || colon < 0 ? null : parseRange(trimmed.slice(0, close + 1));
    /**
     * Anything between the `]` and the `:` is a segment the grammar has no reading for —
     * `[0-500]x: …` — and it used to vanish: the range parsed, the junk was skipped, and the
     * band applied as if the attribute were clean. When in doubt, reject (#8).
     */
    if (!range || trimmed.slice(close + 1, colon).trim() !== '') {
      rejected.push(trimmed);
      continue;
    }

    const list = parseKeyframeList(trimmed.slice(colon + 1), property);
    rejected.push(...list.rejected);
    if (list.keyframes.length) {
      bands.push({ ...range, keyframes: list.keyframes, geometryDependent: list.geometryDependent });
    }
  }

  return {
    base: base ?? { keyframes: [], geometryDependent: false, rejected: [] },
    bands,
    rejected,
  };
};

/**
 * Splits on commas that are not inside parentheses.
 *
 * A numeric value never contains a comma, so `split(',')` was right for as long
 * as every value was numeric. A property module supplying its own parser can be
 * handed anything CSS accepts — `linear-gradient(red, blue)`, `rgb(0, 0, 0)` —
 * and a plain split tears those into pieces that parse as neither a position
 * nor a value.
 *
 * Depth-counting rather than a regex: nesting is unbounded and a regex that
 * matches balanced parens is not one worth maintaining here.
 */
const splitTopLevel = (raw: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    /**
     * Capped here rather than only where the keyframes are counted. The
     * previous `raw.split(',')` allocated every piece of a huge attribute
     * before the loop that caps them ever ran; stopping at the limit bounds
     * the allocation itself (audit rule 4).
     */
    if (out.length > MAX_KEYFRAMES) break;
    const c = raw[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  out.push(raw.slice(start));
  return out;
};

/**
 * Why a keyframe entry was refused, in the words its own declaration provides.
 *
 * `parseMeasure` has five distinct reasons to refuse and returns `null` for
 * all of them, so the two call sites below could only echo what the author
 * wrote: `opacity="0% 2"` was reported as `opacity: 0% 2` — the value handed
 * back with no hint that opacity stops at 1 — sitting in `rejected` beside a
 * misspelt attribute that gets a full sentence. The empty-attribute case a few
 * lines up already learned this ("Named, not echoed"); this is the same lesson
 * at the site an author actually hits, and the one a GUI editor renders.
 *
 * **Derived from the property's own declarations, never re-checked.** It reads
 * `units`, `min` and `max` — the same fields `parseMeasure` reads — so a bound
 * that changes cannot leave a hint behind saying the old one. Where the reason
 * is neither a unit nor a range (junk, `1e2px`, past the billion bound) it
 * says only that the value was not usable, rather than guessing.
 */
const whyRefused = (raw: string, property: PropertyDef): string => {
  const measure = /^\s*(-?(?:\d+\.?\d*|\.\d+))(px|deg|%|rem|em|vh|vw)?\s*$/.exec(raw);
  const unit = (measure?.[2] ?? '') as Unit;
  if (measure && unit !== '' && !property.units.includes(unit)) {
    const takes = property.units.filter(Boolean);
    return __DEV__
      ? `${property.attribute} does not take ${unit} — it takes ${takes.length ? takes.join(', ') : 'a plain number'}`
      : `bad unit ${unit}`;
  }
  const value = measure ? Number(measure[1]) : NaN;
  if (Number.isFinite(value) && (
    (property.min !== undefined && value < property.min) ||
    (property.max !== undefined && value > property.max))) {
    const low = property.min ?? '\u2212\u221e';
    const high = property.max ?? '\u221e';
    return __DEV__ ? `${property.attribute} takes ${low} to ${high}` : 'out of range';
  }
  if (Number.isFinite(value) && Math.abs(value) > MAX_MEASURE) {
    return __DEV__
      ? `${value} is past the bound this library writes — values stop at ${MAX_MEASURE}`
      : 'too large';
  }
  return __DEV__ ? 'is not a value this property can use' : 'bad value';
};

/**
 * Parses one comma-separated keyframe list: `"-50% 0px, 30% 45px, 150% 400px"`.
 *
 * A lone token is the end value — the sugar that keeps the common case short.
 * Two tokens are a position and a value. A malformed entry drops only itself,
 * so the rest of the property still animates (principle #8).
 *
 * @param raw one band's worth of keyframes, with no range prefix
 * @returns the keyframes, whether any position depends on geometry, and the
 * entries that failed validation
 */
export const parseKeyframeList = (raw: string, property: PropertyDef): KeyframeList => {
  const keyframes: RawKeyframe[] = [];
  const rejected: string[] = [];
  let geometryDependent = false;

  /**
   * An attribute written with nothing in it is a mistake worth naming: someone
   * meant to say something and did not. That is a different thing from an
   * empty *segment* inside a list, which is a separator typed twice or left at
   * the end and carries no intent at all — see the skip below.
   *
   * Both used to take the same path, so making trailing separators silent made
   * `translate-y=""` silent too, and it says nothing and does nothing.
   */
  if (raw.trim() === '') {
    /**
     * Named, not echoed. Pushing the raw value reported the empty string, so
     * `translate-y=""` and a band written `[0-700]:` both produced a complaint
     * with no text in it — which is what the trailing-separator fix was for,
     * arriving by the other door.
     */
    return { keyframes, rejected: ['no keyframes'], geometryDependent };
  }

  for (const entry of splitTopLevel(raw)) {
    if (keyframes.length >= MAX_KEYFRAMES) {
      rejected.push(`more than ${MAX_KEYFRAMES} keyframes`);
      break;
    }
    const trimmed = entry.trim();
    /**
     * An empty segment is a separator someone typed twice, or one left at the
     * end — `"0% 0px, 100% 40px,"`, which is what anyone used to CSS writes.
     * It carries no keyframe either way, so there is nothing to refuse and
     * nothing useful to say about it.
     *
     * It used to be pushed to `rejected` as itself, which is the empty string:
     * the animation ran perfectly and the GUI showed a complaint with no text
     * in it. Skipped, so a trailing separator costs nothing and says nothing.
     */
    if (trimmed === '') continue;

    /**
     * Split at the **first** run of whitespace, not every run.
     *
     * A position never contains a space, and everything after it is the value —
     * which for a numeric property is one token, and for a property module
     * supplying its own parser may be an entire CSS value: `linear-gradient(red,
     * blue)`, `0 2px 8px rgb(0 0 0 / 0.3)`. Splitting on every run rejected
     * those as "more than two tokens" before any parser saw them.
     *
     * Nothing is lost by not counting tokens here. A numeric value with a stray
     * space — `0% 10 20` — is now handed to `parseMeasure` as `10 20`, which
     * refuses it and reports the whole entry, exactly as before.
     */
    const cut = trimmed.search(/\s/);
    const hasPosition = cut > 0;
    const rawValue = hasPosition ? trimmed.slice(cut + 1).trim() : trimmed;
    const measure = parseMeasure(rawValue, property);
    if (!measure) {
      rejected.push(`${trimmed} \u2014 ${whyRefused(rawValue, property)}`);
      continue;
    }
    const { value, unit } = measure;

    if (!hasPosition) {
      keyframes.push({ position: 100, positionUnit: '%', value, unit });
      continue;
    }

    const position = parsePosition(trimmed.slice(0, cut));
    if (!position) {
      /**
       * A position, not a value — its rules are the library's rather than the
       * property's, so the reason names them instead of the declaration.
       */
      rejected.push(__DEV__
        ? `${trimmed} \u2014 the position must be ${MIN_PERCENT} to ${MAX_PERCENT}% or a length in vh, vw, px or rem`
        : `${trimmed} \u2014 bad position`);
      continue;
    }
    if (position.positionUnit !== '%') geometryDependent = true;
    keyframes.push({ ...position, value, unit });
  }

  /**
   * A list whose every segment was empty is the empty-value mistake wearing a
   * separator: `translate-y=","` carries no keyframe, refuses nothing, and so
   * reported nothing at all — the animation simply did not exist and the
   * channel the README sends people to was empty.
   *
   * The skip above is still right for what it is for. A trailing or doubled
   * separator among real keyframes carries no intent and needs no complaint;
   * a value made of *nothing but* separators is someone meaning to say
   * something and not saying it, which is what `raw.trim() === ''` above
   * already calls out.
   */
  if (!keyframes.length && !rejected.length) rejected.push('no keyframes');

  return { keyframes, geometryDependent, rejected };
};

/**
 * The largest magnitude any authored value may have — see `parseMeasure`.
 */
const MAX_MEASURE = 1e9;

/**
 * Parses and validates an attribute VALUE, returning both the number and the
 * unit it was written in.
 *
 * One regex, read once. Two thin wrappers used to run their own over the same
 * token, so every keyframe was matched twice; they were deleted once nothing
 * called them. This is the function a GUI validates a control's input with, and
 * it is exported from the package entry for exactly that (principle #7) — which it was
 * not, for as long as this comment had been claiming it.
 *
 * Attribute values are untrusted input — in a CMS anyone who can edit a
 * block can set them. The pattern is deliberately strict so nothing resembling
 * `calc()`, `url()`, or a CSS function can reach a style property. An
 * unparseable or out-of-range value returns null and the caller drops the
 * animation, leaving content in its natural state (principle #8).
 */
export const parseMeasure = (
  raw: string,
  property: PropertyDef
): { value: number; unit: Unit } | null => {
  if (property.parse) {
    /**
     * A module wrote this, and a throw here is the same answer as `null`: the
     * value is not usable. Left to escape it took `init()` down with **zero**
     * elements adopted — and this function is also what a GUI validates a
     * control's input with, so it took the editor with it.
     */
    let slot: number | null = null;
    try { slot = property.parse(raw); } catch { /* refused, like any bad value */ }
    /**
     * A finite number or a refusal — nothing else crosses. The contract says
     * `number | null`, and a module returning NaN, Infinity or (from
     * JavaScript) a string produced three silent shapes: NaN through the
     * curve into a style write the CSSOM drops, a literal `NaN` token in a
     * custom property (which real engines *accept* and hand to `var()`
     * consumers), and a string coerced to NaN by the plan's Float64Array.
     * Every other module edge already converts a broken return into the
     * standard refusal; this is the one that trusted.
     */
    return typeof slot === 'number' && Number.isFinite(slot) ? { value: slot, unit: '' } : null;
  }
  const match = /^\s*(-?(?:\d+\.?\d*|\.\d+))(px|deg|%|rem|em|vh|vw)?\s*$/.exec(raw);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  /**
   * A magnitude past anything this library can write *meaningfully*.
   *
   * The original premise here — that `String(n)` goes exponential at 1e21 and
   * the engine drops `translateY(1e+21px)` whole — was re-measured 2026-09-01
   * and is **false in all three engines**: each accepts the exponential
   * spelling (CSS numbers take exponents per Syntax L3). What actually breaks
   * past the bound is arithmetic and saturation: `format()` multiplies by
   * 1000 before rounding, which exceeds 2^53 above ~9e12 and makes the
   * rounding meaningless, and Chromium clamps a transform's translation near
   * 3.36e7px, so a huge value renders as a number nobody wrote. Nothing else
   * bounded it: the measure pattern has no exponent form, so the only way in
   * is to type the digits, and no length property declares a `max`.
   *
   * A billion rather than 1e21, for two reasons. It leaves twelve orders of
   * magnitude of headroom, which an overshooting `cubic-bezier` needs — a curve
   * with a control point above 1 exceeds its own keyframe, so a bound set at
   * exactly where formatting breaks does not hold after interpolation. And no
   * layout is a billion pixels or a billion degrees; a bound has to be a number
   * someone can defend, not the largest one that happens to work.
   */
  if (Math.abs(value) > MAX_MEASURE) return null;

  const authored = (match[2] ?? '') as Unit;
  if (authored !== '' && !property.units.includes(authored)) return null;

  if (property.min !== undefined && value < property.min) return null;
  if (property.max !== undefined && value > property.max) return null;

  return { value, unit: authored === '' ? property.defaultUnit : authored };
};


/**
 * Validates a CSS selector from an attribute.
 *
 * Worth being precise about the threat, because an earlier version of this was
 * stricter than the risk warranted and rejected `.a.b` and `[aria-expanded]` —
 * both things an author would reasonably write.
 *
 * A selector reaching `matches()` or `querySelector()` is **parsed, not
 * evaluated**. It is not an injection sink; nothing in it can become code. The
 * two things that genuinely matter are that it parses at all — a malformed one
 * throws and would take the whole parse down — and that it is not pathological.
 * So validation is: ask the browser's own parser, and refuse the two shapes
 * that cause trouble.
 *
 * - **Selector lists depend on the caller.** `path-selector` is handed to
 *   `querySelector`, which returns the first match of *any* of them — not what
 *   anyone writing `a, b` expects, so it is refused there. `when` is handed to
 *   `element.matches()`, where a list means exactly what it looks like: any one
 *   of these. It was refused for both, on the `querySelector` reasoning, so
 *   `when=".menu-open, .search-open"` — while either is open — was turned down
 *   for a reason that was not true of it.
 * - **No `:has()`.** It can be genuinely expensive on a large document, and this
 *   may run on every mutation.
 *
 * @param lists whether a comma-separated list is meaningful for this caller
 */
export const parseSelector = (raw: string, lists = false): string | null => {
  const value = raw.trim();
  if (value === '' || value.length > 200) return null;
  if (!lists && value.includes(',')) return null;
  if (/:has\(/i.test(value)) return null;

  try {
    document.createDocumentFragment().querySelector(value);
  } catch {
    return null;
  }
  return value;
};

/**
 * Validates a CSS timing function.
 *
 * This one matters more than it looks. The value is interpolated into the
 * `transition` shorthand — `transform 0.1s <ease>` — and the shorthand takes a
 * comma-separated list, so an unvalidated value can append a whole second
 * entry. Measured, before this existed: `ease="linear, all 9999s linear"`
 * produced a computed `transition-property: filter, all` at `9999s`, which
 * freezes every animatable property on the element against any later change,
 * by anyone. A semicolon cannot escape the declaration — the CSSOM setter
 * parses one property's grammar — but a comma does not need to.
 *
 * So: an allowlist of the keywords, plus the two functional forms, and nothing
 * else (principle #8 — no string-built CSS from user values).
 */
/**
 * Exported so `@verajs/motion/easings` can be tested against the exact list
 * core accepts. The two are separate packages now: core validates the
 * vocabulary and the module implements it, so a keyword added here and not there
 * passes validation and then silently animates linear.
 */
export const EASING_KEYWORDS = [
  'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end',
] as const;

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)`;
const CUBIC_BEZIER = new RegExp(`^cubic-bezier\\(\\s*${NUM}\\s*(?:,\\s*${NUM}\\s*){3}\\)$`);
const STEPS = /^steps\(\s*([1-9]\d*)\s*(?:,\s*(jump-(?:start|end|none|both)|start|end)\s*)?\)$/;

/**
 * Validates a CSS timing function, for either easing slot.
 *
 * @param raw the authored value
 * @returns the value unchanged if it is one of the keywords, a `cubic-bezier()`
 * or a `steps()`; null otherwise
 */
export const parseEasing = (raw: string): string | null => {
  const value = raw.trim();
  if ((EASING_KEYWORDS as readonly string[]).includes(value)) return value;
  if (CUBIC_BEZIER.test(value)) {
    /**
     * The **x** co-ordinates, which CSS bounds to 0-1 and this did not.
     *
     * `cubic-bezier(2, 0, 3, 1)` passed the shape test and was handed to
     * `inertia-ease` verbatim, where it builds `transform 0.1s cubic-bezier(2,
     * 0, 3, 1)` — a shorthand the CSSOM refuses whole, leaving **no transition
     * at all** and inertia silently off. That is the failure the README already
     * describes for `inertiaEase: 'wobble'`, reached by a value that looks
     * entirely reasonable.
     *
     * `y` is deliberately not bounded: a control point above 1 or below 0 is
     * legal and is exactly how a springy curve overshoots and settles back.
     * Confirmed in all three engines by `spikes/steps-validity.mjs`, which
     * compares what this accepts against what `CSS.supports` does and which now
     * carries these cases — it is how this was found.
     */
    const [x1, , x2] = value.slice(13, -1).split(',').map(Number);
    if (x1! < 0 || x1! > 1 || x2! < 0 || x2! > 1) return null;
    return value;
  }

  /**
   * A step count is a positive integer, and `jump-none` spreads its jumps
   * across `count - 1` intervals — so a single step leaves nothing to divide
   * by. Chromium, Firefox and WebKit all reject `steps(0)` and
   * `steps(1, jump-none)`; measured in `spikes/steps-validity.mjs` rather than
   * read off the spec, because what the engines do is what matters here.
   *
   * Both used to pass. An `ease` value is handed to CSS verbatim for
   * `inertia-ease`, so accepting one meant the browser silently dropped the
   * declaration, and `rejected` — the diagnostic a GUI renders from — said
   * the value was fine.
   */
  const stepped = STEPS.exec(value);
  if (stepped) return stepped[2] === 'jump-none' && stepped[1] === '1' ? null : value;
  return null;
};

/**
 * Validates a CSS `transform-origin`.
 *
 * One to three components, each a keyword or a length. The browser's own
 * setter already refuses anything malformed, so nothing invalid ever reached
 * the DOM — but it reached `parsed.settings`, which is what a GUI renders from
 * and what `rejected` is supposed to flag. Validating here is what makes the
 * diagnostic honest.
 */
const ORIGIN_KEYWORDS = ['left', 'center', 'right', 'top', 'bottom'];
const ORIGIN_LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(px|rem|em|%|vh|vw)?$/;

/**
 * Validates a CSS `transform-origin`: one to three keywords or lengths.
 *
 * @returns the value with whitespace normalised, or null
 */
export const parseOrigin = (raw: string): string | null => {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 1 || parts.length > 3 || parts[0] === '') return null;
  for (const part of parts) {
    if (!ORIGIN_KEYWORDS.includes(part) && !ORIGIN_LENGTH.test(part)) return null;
  }

  /**
   * **The axes, which "one to three keywords or lengths" is not.**
   *
   * Every component being individually legal is not the grammar. CSS has two
   * two-value forms — `[left|center|right|<len>] [top|center|bottom|<len>]`, or
   * two keywords in *either* order with one per axis — and a third value that
   * must be a length. So `top bottom`, `left right`, `top top`, `top 10px`,
   * `10px left`, `left top top` and `center center center` are all refused by
   * every engine, and every one of them was accepted here.
   *
   * That mattered because of what this function is *for*: the docblock above
   * says the browser's setter refuses anything malformed anyway, and this
   * exists so the value does not reach `parsed.settings` looking valid. An
   * accepted-then-dropped origin is the silent case it was written to prevent,
   * and it let seven forms through.
   *
   * Verified against `CSS.supports` in a browser, form by form, rather than
   * read off the specification — `10px top` is legal and `top 10px` is not,
   * which is the kind of asymmetry a summary loses.
   */
  const isLength = (part: string): boolean => ORIGIN_LENGTH.test(part);
  const horizontal = (part: string): boolean =>
    isLength(part) || part === 'center' || part === 'left' || part === 'right';
  const vertical = (part: string): boolean =>
    isLength(part) || part === 'center' || part === 'top' || part === 'bottom';

  if (parts.length > 1) {
    const [a, b, c] = parts as [string, string, string?];
    const positional = horizontal(a) && vertical(b);
    /** Keywords only, one per axis, in either order. */
    const named =
      !isLength(a) && !isLength(b) &&
      ((horizontal(a) && vertical(b)) || (vertical(a) && horizontal(b)));
    if (!positional && !named) return null;
    if (c !== undefined && !isLength(c)) return null;
  }

  return parts.join(' ');
};

/**
 * Presets. These exist so the required marker attribute carries meaning
 * instead of being dead weight, and because a named effect is the fastest
 * thing for a person or a model to reach for.
 *
 * Each value is exactly what an author would write in the attribute, so a
 * preset is never a special case downstream — it expands into precisely what
 * the hand-authored equivalent would produce.
 */
export type PresetKeyframes = Readonly<Record<string, string>>;

export const PRESETS: Readonly<Record<string, PresetKeyframes>> = {
  'fade': { opacity: '0% 0, 100% 1' },
  'fade-up': { opacity: '0% 0, 100% 1', 'translate-y': '0% 40px, 100% 0px' },
  'fade-down': { opacity: '0% 0, 100% 1', 'translate-y': '0% -40px, 100% 0px' },
  'fade-left': { opacity: '0% 0, 100% 1', 'translate-x': '0% 40px, 100% 0px' },
  'fade-right': { opacity: '0% 0, 100% 1', 'translate-x': '0% -40px, 100% 0px' },
  'zoom-in': { opacity: '0% 0, 100% 1', scale: '0% 0.8, 100% 1' },
  'zoom-out': { opacity: '0% 0, 100% 1', scale: '0% 1.2, 100% 1' },
  'slide-up': { 'translate-y': '0% 100px, 100% 0px' },
  'slide-down': { 'translate-y': '0% -100px, 100% 0px' },
  'blur-in': { opacity: '0% 0, 100% 1', blur: '0% 12px, 100% 0px' },
};

/**
 * Whether a name is a preset. Uses `hasOwnProperty` rather than a lookup, so
 * `constructor` and other prototype keys cannot masquerade as one.
 */
export const isPreset = (name: string): boolean =>
  Object.prototype.hasOwnProperty.call(PRESETS, name);
