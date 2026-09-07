/**
 * The single source of truth for the motion vocabulary.
 *
 * Everything that needs to know what is animatable derives from this file: the
 * object parser, GUI editor controls, and the docs. One definition, many
 * consumers, so they cannot drift.
 *
 * Ported from `@verajs/motion`'s schema in the phase-4 fold-in (design §16b).
 * What changed and what deliberately did not: the vocabulary now names object
 * KEYS rather than attributes — the whole animation lives in one
 * `data-vd-motion` value — so the attribute-prefix machinery is gone and
 * `parseKeyName` replaces `parseAttributeName` minus the prefix check. The
 * value grammar (keyframes, bands, positions, measures) is UNCHANGED — it
 * moved from attribute values to object values, byte for byte. `wireMotion`
 * is gone: vocabulary modules are engine CONNECTORS now, and they register
 * through `registerVocabulary` below, which keeps wireMotion's exact
 * flattening, factory, clash and shape-refusal behaviour.
 *
 * Key grammar, inside `data-vd-motion="{ … }"`:
 *
 *   <property>: '<value>'            end value (sugar)
 *   <property>: '<pos> <value>, …'   keyframes: position then value
 *   <property>: '… ; [a-b]: …'       a width band, merged over the base
 *   <property>-<name>: '…'           the same, at a registered breakpoint
 *   <property>: { frames: '…', ease: '…' }   per-property easing (nested form)
 *   <setting>: '<value>'             element-level setting
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
 * The category (transform / filter / …) is deliberately absent from the key:
 * `translate-y` is always a transform, so it is derived here rather than
 * repeated in every animation on the page.
 */

import type { Easing } from './timing.js';
/** Re-exported so a module names one import, not two. */
export type { Easing } from './timing.js';

/**
 * Page-level problems (a clash, a broken factory) reach the engine's
 * rejections through this seam rather than an import: the motion pack is an
 * ADDITIVE bundle and must import nothing from the engine, so the engine's
 * `reject` arrives through the connector's seams at wiring time. Before
 * wiring, the fallback still speaks — a problem is never dropped.
 */
let report: (code: string, args: readonly string[]) => void = (code, args) => {
  console.warn(`[vera] motion: ${code}${args.length ? ` (${args.join(', ')})` : ''}`);
};
export const setProblemReporter = (fn: typeof report): void => {
  report = fn;
};
/** A page-level problem — no element to hang it on. Codes, like everything else here. */
export const pageProblem = (code: string, args: readonly string[] = []): void => report(code, args);

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
 * unit strings are never passed through from an authored value.
 */
export const UNITS = ['px', 'deg', '%', 'rem', 'em', 'vh', 'vw', ''] as const;
export type Unit = (typeof UNITS)[number];

export interface PropertyDef {
  /** Key spelling, kebab-case: `translate-y`. */
  readonly key: string;
  readonly parse?: (raw: string) => number | null;
  /**
   * Writes the value. A returned string is a **refusal** — the reason reaches
   * the rejections registry, recorded once however many frames later call
   * this. Returning nothing is the ordinary case.
   *
   * Typed `void | string` rather than `void` on purpose: TypeScript lets a
   * value-returning function satisfy a `void` return type, so a module could
   * return a reason, typecheck cleanly, and have it silently dropped.
   */
  readonly apply?: (node: HTMLElement, value: number) => void | string;
  /**
   * Derived for built-ins, and free-form for a module — the union keeps
   * autocomplete for the known values while letting a module name its own
   * group for the GUI to render. Only transform, filter and image change
   * behaviour; everything else is a plain cssProperty write.
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
   * The import specifier of the module that contributes this key, and
   * **absent for core's own** — `getProperty('background')?.from` answers
   * `'@verajs/directives/motion'` (the paint export), `getProperty('opacity')
   * ?.from` answers nothing. A GUI editor is the reason it exists: a panel
   * iterating the vocabulary could describe a key completely and still not
   * tell an author what to wire to make it work.
   */
  readonly from?: string;
  /**
   * The values are not on a number line — each is a slot in the module's own
   * table, so the runtime holds one until the next keyframe rather than
   * interpolating towards it. Interpolating produced a value between two
   * slots, and `Math.floor` of that is somebody else's.
   */
  readonly discrete?: boolean;
  /**
   * Per-element wiring for a property that needs more than a write path —
   * `path` resolves its `<path>` into an `offset-path` here, `frame` owns its
   * drawer teardown. Runs at the motion directive's activation for every
   * element whose object carries this property; a returned function is the
   * teardown, and the engine's rebuild-on-edit is what replaced the whole
   * `prepare`-insert staleness machinery: an edited selector or frame-url
   * re-resolves because the element re-activates. The fold-in's replacement
   * for three of the five insert points.
   */
  readonly setup?: (
    node: HTMLElement,
    settings: Readonly<Record<string, string | number | boolean>>,
    reject: (code: string, args?: readonly string[]) => void
  ) => void | (() => void);
}

/**
 * A refusal, on its way to the engine's registry: a CODE and the runtime values its sentence needs.
 *
 * Motion used to pass composed sentences instead, which is why its prose shipped to production
 * while every other pack's folded away — and why no docs page or inspector row could address one
 * of its refusals, since they all arrived under a single `motion-refused` code. `where` is the key
 * path a nested refusal accumulates (`opacity`, then `opacity: 40%`), carried separately so the
 * table can render it without every caller composing the prefix itself.
 */
export type Refusal = {
  readonly code: string;
  readonly args: readonly string[];
  /** The key path a NESTED refusal accumulates — `opacity`, then `opacity: [0 50%]`. Carried apart
   *  from `args` so one place renders the prefix instead of every caller composing it. */
  readonly where?: string;
};

/** Prefix a nested refusal with the key that contained it. */
export const at = (key: string, r: Refusal): Refusal => ({ ...r, where: r.where ? `${key}: ${r.where}` : key });

const LENGTH_UNITS = ['px', 'rem', 'em', '%', 'vh', 'vw'] as const;
const NO_UNITS = [''] as const;

export const PROPERTIES = [
  // transform
  { key: 'translate-x', category: 'transform', cssFunction: 'translateX', defaultUnit: 'px', units: LENGTH_UNITS, initial: 0 },
  { key: 'translate-y', category: 'transform', cssFunction: 'translateY', defaultUnit: 'px', units: LENGTH_UNITS, initial: 0 },
  { key: 'translate-z', category: 'transform', cssFunction: 'translateZ', defaultUnit: 'px', units: LENGTH_UNITS, initial: 0 },
  { key: 'rotate',      category: 'transform', cssFunction: 'rotate',     defaultUnit: 'deg', units: ['deg'], initial: 0 },
  { key: 'rotate-x',    category: 'transform', cssFunction: 'rotateX',    defaultUnit: 'deg', units: ['deg'], initial: 0 },
  { key: 'rotate-y',    category: 'transform', cssFunction: 'rotateY',    defaultUnit: 'deg', units: ['deg'], initial: 0 },
  { key: 'scale',       category: 'transform', cssFunction: 'scale',      defaultUnit: '',   units: NO_UNITS, min: 0, initial: 1 },
  { key: 'scale-x',     category: 'transform', cssFunction: 'scaleX',     defaultUnit: '',   units: NO_UNITS, min: 0, initial: 1 },
  { key: 'scale-y',     category: 'transform', cssFunction: 'scaleY',     defaultUnit: '',   units: NO_UNITS, min: 0, initial: 1 },
  { key: 'skew-x',      category: 'transform', cssFunction: 'skewX',      defaultUnit: 'deg', units: ['deg'], initial: 0 },
  { key: 'skew-y',      category: 'transform', cssFunction: 'skewY',      defaultUnit: 'deg', units: ['deg'], initial: 0 },

  // filter
  { key: 'opacity',    category: 'filter', cssFunction: 'opacity',    defaultUnit: '',  units: NO_UNITS, min: 0, max: 1, initial: 1 },
  { key: 'blur',       category: 'filter', cssFunction: 'blur',       defaultUnit: 'px', units: ['px', 'rem', 'em'], min: 0, initial: 0 },
  { key: 'brightness', category: 'filter', cssFunction: 'brightness', defaultUnit: '',  units: NO_UNITS, min: 0, initial: 1 },
  { key: 'contrast',   category: 'filter', cssFunction: 'contrast',   defaultUnit: '',  units: NO_UNITS, min: 0, initial: 1 },
  { key: 'saturate',   category: 'filter', cssFunction: 'saturate',   defaultUnit: '',  units: NO_UNITS, min: 0, initial: 1 },
  { key: 'grayscale',  category: 'filter', cssFunction: 'grayscale',  defaultUnit: '',  units: NO_UNITS, min: 0, max: 1, initial: 0 },

  // border
  /**
   * All four corners at once. Declared *before* the individual corners on
   * purpose: apply order follows this table, so writing the shorthand first
   * lets a specific corner override it, which is the way round CSS itself
   * works and the way an author expects.
   */
  { key: 'radius',              category: 'border', cssProperty: 'border-radius',              defaultUnit: 'px', units: LENGTH_UNITS, min: 0, initial: 0 },
  { key: 'radius-top-left',     category: 'border', cssProperty: 'border-top-left-radius',     defaultUnit: 'px', units: LENGTH_UNITS, min: 0, initial: 0 },
  { key: 'radius-top-right',    category: 'border', cssProperty: 'border-top-right-radius',    defaultUnit: 'px', units: LENGTH_UNITS, min: 0, initial: 0 },
  { key: 'radius-bottom-left',  category: 'border', cssProperty: 'border-bottom-left-radius',  defaultUnit: 'px', units: LENGTH_UNITS, min: 0, initial: 0 },
  { key: 'radius-bottom-right', category: 'border', cssProperty: 'border-bottom-right-radius', defaultUnit: 'px', units: LENGTH_UNITS, min: 0, initial: 0 },
] as const satisfies readonly PropertyDef[];

/**
 * Every pre-fold capability is accounted for: what is not in this table ships
 * as a vocabulary module (`path`, `frame`, the paint keys). Nothing is listed
 * here without an apply path — a key that parses cleanly and then does
 * nothing is a worse failure than a clear rejection.
 */

export type PropertyName = (typeof PROPERTIES)[number]['key'];

const BY_KEY = new Map<string, PropertyDef>(
  PROPERTIES.map((p) => [p.key, p as PropertyDef])
);

/** The definition for a key name, or undefined if there is none. */
export const getProperty = (name: string): PropertyDef | undefined => BY_KEY.get(name);

/**
 * Declaration order, used to compose transform strings deterministically.
 *
 * CSS transform functions do not commute — `translate` then `rotate` is a
 * different result from `rotate` then `translate`. The table above is ordered
 * translate -> rotate -> scale -> skew, the usual convention, and this makes
 * that ordering authoritative regardless of the order keys appear in the
 * authored object.
 */
const ORDER = new Map<string, number>(PROPERTIES.map((p, index) => [p.key, index]));

/**
 * A property's index in `PROPERTIES`, which is the order it must be written to
 * the DOM in. CSS transform functions do not commute, so this is load-bearing
 * rather than cosmetic.
 */
export const propertyOrder = (property: PropertyDef): number =>
  ORDER.get(property.key) ?? Number.MAX_SAFE_INTEGER;

/**
 * Every property the runtime currently knows — built-ins and wired modules
 * alike. A function rather than an array because wiring happens at page load:
 * a value captured at import time would be the built-in table again, which is
 * the bug this exists to avoid.
 */
export const properties = (): readonly PropertyDef[] => [...BY_KEY.values()];

/** Whether a name is an animatable property. A type guard for GUI narrowing. */
export const isProperty = (name: string): name is PropertyName => BY_KEY.has(name);

/**
 * Element-level settings. Kept in a namespace disjoint from property names so
 * an object key resolves unambiguously; a test enforces that.
 */
export interface SettingDef {
  /**
   * A module's own validator, given the raw authored text. Returning null
   * rejects it, exactly as a built-in type would. This is what lets a module
   * own the settings that configure it without the runtime knowing their
   * shape — `frame-url` validates an origin policy the runtime does not carry.
   */
  readonly parse?: (raw: string) => string | number | boolean | null;
  /** The wiring specifier that contributes this setting; absent for core's own. */
  readonly from?: string;
  readonly key: string;
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
 * does: an authored value is untrusted, and a number with no ceiling reaches
 * the DOM as one. Measured, before they existed: `speed="99999999"` produced
 * `transition-duration: 1e+08s`, freezing the element's transform and filter
 * permanently; `frame-pad="10000000"` made `padStart` allocate a 10 MB string
 * for every frame drawn.
 */
export const SETTINGS = [
  /**
   * How much the element resists the scroll position it is told to be at, in
   * seconds. `0` tracks scroll exactly. **This concept has one name here:
   * inertia** — not momentum, damping, smoothing, `scrub` or `lerp`.
   * An hour is already absurd; beyond it is an attack.
   */
  { key: 'inertia', type: 'number', min: 0, max: 3600 },
  /**
   * Pin the element to the viewport while its animation runs, then release
   * it. The value is the distance from the leading edge of the scrollport;
   * which edge follows the region's axis. Implemented as `position: sticky`,
   * which is correct by construction — the element never leaves the layout
   * flow, so content after it neither jumps when it attaches nor collapses
   * when it releases.
   */
  { key: 'pin', type: 'length' },
  /**
   * Depth for the 3D transform properties, as a distance from the viewer.
   * Without it `translate-z` is **inert** — measured: `translateZ(200px)`
   * leaves a 100x100 box at exactly 100x100 with no perspective ancestor, and
   * doubles it with one. Applied as the `perspective()` transform *function*
   * on the element itself, so an author needs no cooperation from the
   * surrounding markup.
   */
  { key: 'perspective', type: 'length' },
  /** Per-category overrides, so one element can move fast and fade slowly. */
  { key: 'transform-inertia', type: 'number', min: 0, max: 3600 },
  { key: 'filter-inertia', type: 'number', min: 0, max: 3600 },
  /**
   * The shape of the *inertia* — the CSS timing function of the transition
   * that carries the element to where scroll says it should be. Compositor
   * side; nothing in JS evaluates it. Because the runtime rewrites that
   * transition's target every frame, only the first ~17% of the curve is ever
   * traversed, so what this really controls is how stiffly the element
   * chases. Measured at `inertia: 0.1`: `ease-in` trails by 113px mid-scroll,
   * the default by 8px.
   */
  { key: 'inertia-ease', type: 'easing' },
  /**
   * The shape of the *curve* — the relationship between scroll position and
   * value. `linear` by default. This cannot be handed to CSS: a transition
   * runs on a timer and has no way to ask where the scrollbar is, and the one
   * CSS mechanism that does know (`animation-timeline`) cannot be damped.
   * Applies per segment, as `@keyframes` does — and per PROPERTY when the
   * nested value form carries its own `ease`, which overrides this one for
   * that property alone (the fold-in's addition; the curve engine always
   * supported it).
   */
  { key: 'ease', type: 'easing' },
  { key: 'run-once', type: 'boolean' },
  /**
   * Drive this element from a selector match instead of from scroll. While
   * the element matches, the animation sits at its end; while it does not, at
   * its start. It replaces the driver rather than adding to it: an element is
   * scroll-driven or state-driven, never both. A list is allowed — `when` is
   * evaluated with `matches()`, where `a, b` means "either".
   */
  { key: 'when', type: 'selector', parse: (raw) => parseSelector(raw, true) },
  /**
   * Offsets each animated descendant's keyframes by `index x value`, so a row
   * of cards arrives one after another instead of in unison. It goes on the
   * **parent**, which is the only place it can: the whole point is the
   * relationship between siblings. `%` by default, and any position unit is
   * accepted — the offset is normalised against geometry exactly as a
   * keyframe position is.
   */
  { key: 'stagger', type: 'offset' },
  { key: 'will-change', type: 'boolean' },
  { key: 'transform-origin', type: 'origin' },
] as const satisfies readonly SettingDef[];

const BY_SETTING = new Map<string, SettingDef>(
  SETTINGS.map((setting) => [setting.key, setting as SettingDef])
);

/** Every setting the runtime currently knows, modules included. */
export const settings = (): readonly SettingDef[] => [...BY_SETTING.values()];

/** The definition for a setting name, or undefined. Includes anything wired. */
export const getSetting = (name: string): SettingDef | undefined => BY_SETTING.get(name);
/** Whether a name is an element-level setting rather than an animatable property. */
export const isSetting = (name: string): boolean => BY_SETTING.has(name);

export interface ParsedKey {
  readonly property: PropertyDef;
  /** The range a name suffix stood for, or null for the unsuffixed key. */
  readonly range: Range | null;
}

/**
 * Resolves an object KEY to its property, and any trailing name suffix to the
 * range that name was registered for. (`parseAttributeName` before the
 * fold-in, minus the attribute prefix — the logic is otherwise identical, and
 * the exact-match-first rule below is the part that must never change.)
 *
 * An exact property name wins over a band split, always. Load-bearing,
 * because several property names end in something that could be a breakpoint
 * alias: `rotate-x`, `path-rotate`, `frame-ext`. Without exact-match-first,
 * registering a breakpoint called `x` would turn `rotate-x` into "rotate, at
 * the x band" and the real property would become unreachable. The cost is the
 * mirror image, and it is the lesser one: a site that registers a breakpoint
 * named `x` cannot then write `rotate` at that band. Deterministic either
 * way, and this direction keeps every documented key writable.
 *
 * @param name e.g. `translate-y` or `translate-y-mobile`
 * @param breakpoints the registered aliases, if any
 */
export const parseKeyName = (
  name: string,
  breakpoints?: ReadonlyMap<string, Range>
): ParsedKey | null => {
  const direct = BY_KEY.get(name);
  if (direct) return { property: direct, range: null };

  const cut = name.lastIndexOf('-');
  if (cut < 0 || !breakpoints) return null;

  const range = breakpoints.get(name.slice(cut + 1));
  const property = BY_KEY.get(name.slice(0, cut));
  return range && property ? { property, range } : null;
};

/**
 * Says so when a registration replaces one that was already there.
 *
 * The registry is a `Map` keyed by name, so the last writer wins — and a
 * module registering `opacity` silently replaced the built-in page-wide.
 * Reported rather than refused: replacing a built-in deliberately is a thing
 * this vocabulary invites third parties to do, and a refusal would decide
 * that for them. What is not acceptable is doing it by accident and never
 * finding out.
 *
 * **Identity, not equality.** Wiring one module twice re-registers the *same*
 * descriptor objects, which is idempotent and not a clash. A factory called
 * twice makes new ones, and those do clash: two `sequence()` instances each
 * keep their own drawer state and only one of them is reachable.
 */
const clash = (prior: unknown, next: unknown, kind: string): void => {
  if (prior && prior !== next) {
    pageProblem('motion-vocabulary-replaced', [(next as { key: string }).key, kind]);
  }
};

/**
 * Installs vocabulary modules, first-party or third-party — the registration
 * half of what `wireMotion` used to be. The public door is `wireDirectives`:
 * each vocabulary module is an engine CONNECTOR whose body calls this, so
 * `wireDirectives([motion, paint, sequence({ allowedOrigins })])` reads like
 * every other wiring on the page. The flattening, the optional-call factory
 * allowance, the not-a-module refusal and the clash report are wireMotion's
 * own, kept exactly.
 */
export const registerVocabulary = (item: WirableTree): void => {
  for (const one of ([item] as unknown[]).flat(Infinity) as Wirable[]) {
    /**
     * A module that takes options is a factory, and calling it is optional.
     * A factory that throws — bad options, a bug in a third-party module —
     * costs the page that module, not the page.
     */
    if (typeof one === 'function') {
      try {
        registerVocabulary((one as WirableFactory)());
      } catch (error) {
        pageProblem('motion-vocabulary-factory-threw', [String(error)]);
      }
      continue;
    }

    /** Something that is not a descriptor at all — a default import of a named
     *  export is `undefined`, which is the ordinary way to get this wrong. */
    if (!one || typeof one !== 'object' || !('on' in one || 'key' in one)) {
      pageProblem('motion-not-a-module', [String(one)]);
      continue;
    }

    /**
     * A descriptor is anything that names an insert point, and that is tested
     * first — a module may one day be both, and testing the other way round
     * would silently install it as the wrong thing.
     */
    if ('on' in one) {
      const chain = INSERTS.get(one.on) ?? [];
      /** By identity, so wiring one module twice is a no-op here too. */
      if (!chain.includes(one.fn)) chain.push(one.fn);
      INSERTS.set(one.on, chain);
    }
    /**
     * A setting declares a `type`; a property declares a `category`. That is
     * the whole distinction, and it is checked rather than guessed. **Both is
     * not a third kind, it is a mistake**, and resolving it by which line
     * comes first is the worst of the three options.
     */
    else if ('type' in one && 'category' in one) {
      pageProblem('motion-setting-and-property', [one.key]);
    }
    else if ('type' in one) {
      clash(BY_SETTING.get(one.key), one, 'setting');
      BY_SETTING.set(one.key, one);
    }
    /**
     * And a property has to be able to write something. With no `cssProperty`,
     * no `cssFunction` and no `apply`, it parses values and puts them nowhere:
     * the key is accepted, nothing is reported, and nothing moves.
     */
    else if (!('cssProperty' in one) && !('cssFunction' in one) && !('apply' in one)) {
      pageProblem('motion-property-writes-nothing', [one.key]);
    }
    else {
      clash(BY_KEY.get(one.key), one, 'property');
      BY_KEY.set(one.key, one);
      if (!ORDER.has(one.key)) ORDER.set(one.key, ORDER.size);
    }
  }
};

/**
 * What an insert point is called, and what it must be. A typed map rather
 * than bare strings because a misspelled insert point that silently never
 * fires is the failure this mechanism is most likely to produce. These are
 * the MOTION PACK's internal seams — the engine's own inserts are a different
 * system; these fire from the motion directive's lifecycle.
 */
export interface InsertMap {
  /** Turns an `ease` value into a curve shaper. The easings module. */
  easing: (value: string) => Easing | null;
  /**
   * Runs over a root **before** its elements are collected, so a module can
   * change the DOM the runtime is about to read. `split` uses it: the pieces
   * it creates are then found by the ordinary scan, and nothing downstream
   * knows they were not written by hand. `enabled` says whether anything will
   * actually animate — false under reduced motion, or while disabled; a
   * module that rewrites the DOM should do nothing then.
   */
  prepare: (root: ParentNode, enabled: boolean) => void;
  /**
   * One element is leaving — removed from the page, or the region is being
   * cleared. A module holding anything keyed by that node releases it here.
   */
  release: (node: Element) => void;
  /**
   * A region is being torn down. `owns` says whether a node belongs to the
   * region doing the tearing down, and a module **must** consult it — wiring
   * is page-level while regions are not, so without it one region's teardown
   * reaches every other region's state.
   */
  teardown: (owns: (node: Node) => boolean) => void;
  /**
   * **Nothing is animating this page any more** — the last live region has
   * been torn down. A module holding state for the *page*, rather than for an
   * element or a region, drops it here. Fires *after* `teardown`, so a module
   * can rely on its per-element work having already run.
   */
  forget: () => void;
}

export type Insert = {
  [K in keyof InsertMap]: { readonly on: K; readonly fn: InsertMap[K] };
}[keyof InsertMap];

/** A module that takes options; calling it is optional. */
export type WirableFactory = () => WirableTree;

export type Wirable = PropertyDef | SettingDef | Insert | WirableFactory;

/**
 * What `registerVocabulary` accepts: a descriptor, a factory, or any nesting
 * of arrays of them. Recursive on purpose, because the nesting is real — a
 * module is usually itself a list.
 */
export type WirableTree = Wirable | readonly WirableTree[];

/**
 * A chain per insert point, not one function. Two modules commonly want the
 * same point — `split` and `sequence` both need a `teardown` — and a single
 * slot meant the second silently replaced the first.
 */
const INSERTS = new Map<keyof InsertMap, InsertMap[keyof InsertMap][]>();

/**
 * Everything wired into an insert point, in the order it was wired. A
 * notification point (`prepare`, `release`, `teardown`) runs every entry; a
 * resolver (`easing`) takes the first that answers.
 */
export const insert = <K extends keyof InsertMap>(name: K): InsertMap[K][] =>
  (INSERTS.get(name) ?? []) as InsertMap[K][];

/** Units a keyframe POSITION may use. All standard CSS — nothing to learn. */
export const POSITION_UNITS = ['%', 'vh', 'vw', 'px', 'rem'] as const;
export type PositionUnit = (typeof POSITION_UNITS)[number];

/** Absolute positions are capped so a typo cannot ask for a kilometre of scroll. */
const MAX_ABSOLUTE_POSITION = 100000;

/**
 * Caps on how many things one value may declare. Property *values* are
 * range-checked; the *counts* were once unbounded, which is the same hole one
 * level up: measured, 200,000 keyframes in a single value parse in 92 ms and
 * produce a curve `evaluate` then scans on every frame. Ten is a busy
 * animation; these are generous by two orders of magnitude and still bound
 * the work.
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
 * Parses a range prefix: `[200-500]` closed, `[500+]` open at the top. There
 * is no `[-500]` form — an open bottom is `[0-500]`, which is one character
 * longer and cannot be misread as negative five hundred.
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
  readonly rejected: readonly Refusal[];
}

/**
 * Parses a keyframe position — a number with a mandatory unit. The unit is
 * mandatory, and that single rule is what lets a bare number stay
 * unambiguously a *value*, so `opacity: '0'` can keep meaning "animate to 0"
 * alongside the list form.
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
 * Parses a stagger offset — a position whose unit may be left off. The unit
 * is optional here and mandatory on a keyframe position, and the difference
 * is deliberate: a keyframe entry has to stay unambiguous against a bare
 * *value* sharing the same key, and a stagger has nothing to be ambiguous
 * with. `stagger: '8'` is what someone writes first, and it means what they
 * expect.
 */
export const parseOffset = (raw: string): string | null => {
  const value = raw.trim();
  const parsed = parsePosition(/[a-z%]$/.test(value) ? value : `${value}%`);
  return parsed ? `${parsed.position}${parsed.positionUnit}` : null;
};

/**
 * Splits a value into its base keyframes and any banded overrides.
 *
 * ```
 *   "0% 0px, 100% 50px"                              base only
 *   "0% 0px, 100% 50px; [0-500]: 100% 20px"          base plus one band
 *   "0% 0px, 100% 50px; [900+]: 100% 200px"          open at the top
 * ```
 *
 * A value with no `[` takes the existing path untouched — one `indexOf`,
 * which measured at **3 ns** against the 475 ns the parse already costs.
 * Bands **merge** onto the base rather than replacing it: an override at a
 * position the base already has replaces that value, and one at a new
 * position is added. That is what makes `[0-500]: 100% 20px` mean "same
 * animation, less travel on a phone" rather than "throw away the start
 * keyframe".
 */
export const parseBandedList = (
  raw: string,
  property: PropertyDef
): { base: KeyframeList; bands: readonly Band[]; rejected: readonly Refusal[] } => {
  if (!raw.includes('[')) {
    /**
     * A trailing `;` is the band separator with no band after it — one
     * character of CSS muscle memory. It used to reach `parseKeyframeList`
     * attached to the last value, so `"0% 0px, 100% 40px;"` lost its end
     * keyframe and the element sat at `translateY(0px)` for good.
     */
    const base = parseKeyframeList(raw.trim().replace(/;+$/, ''), property);
    /** The base's own rejects travel with it, or a bad keyframe reports nothing. */
    return { base, bands: [], rejected: base.rejected };
  }

  const rejected: Refusal[] = [];
  const bands: Band[] = [];
  let base: KeyframeList | null = null;

  for (const chunk of raw.split(';')) {
    if (bands.length >= MAX_BANDS) {
      rejected.push({ code: 'motion-too-many-bands', args: [String(MAX_BANDS)] });
      break;
    }
    const trimmed = chunk.trim();
    if (trimmed === '') continue;

    if (!trimmed.startsWith('[')) {
      /** An unbracketed segment is the base. A second one is a mistake. */
      if (base) rejected.push({ code: 'motion-second-base', args: [trimmed] });
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
     * Anything between the `]` and the `:` is a segment the grammar has no
     * reading for — `[0-500]x: …` — and it used to vanish: the range parsed,
     * the junk was skipped, and the band applied as if the value were clean.
     * When in doubt, reject.
     */
    if (!range || trimmed.slice(close + 1, colon).trim() !== '') {
      rejected.push({ code: 'motion-band-bad', args: [trimmed] });
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
 * Splits on commas that are not inside parentheses. A numeric value never
 * contains a comma, but a property module supplying its own parser can be
 * handed anything CSS accepts — `linear-gradient(red, blue)` — and a plain
 * split tears those into pieces that parse as neither a position nor a
 * value. Depth-counting rather than a regex: nesting is unbounded and a
 * regex that matches balanced parens is not one worth maintaining here.
 * Capped here rather than only where the keyframes are counted, so the
 * allocation itself is bounded.
 */
const splitTopLevel = (raw: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
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
 * Why a keyframe entry was refused, in the words its own declaration
 * provides. **Derived from the property's own declarations, never
 * re-checked** — it reads `units`, `min` and `max`, the same fields
 * `parseMeasure` reads, so a bound that changes cannot leave a hint behind
 * saying the old one.
 */
/**
 * Why a measure was refused, as a CODE and its values — the words live in `diagnostics.ts` like
 * every other pack's. This returned a composed sentence with a `__DEV__` short form beside it,
 * which is the shape the table replaces: the short form still shipped, and neither form could be
 * addressed by a docs page.
 */
const whyRefused = (raw: string, property: PropertyDef): Refusal => {
  const measure = /^\s*(-?(?:\d+\.?\d*|\.\d+))(px|deg|%|rem|em|vh|vw)?\s*$/.exec(raw);
  const unit = (measure?.[2] ?? '') as Unit;
  if (measure && unit !== '' && !property.units.includes(unit)) {
    const takes = property.units.filter(Boolean);
    return { code: 'motion-bad-unit', args: [property.key, unit, takes.length ? takes.join(', ') : ''] };
  }
  const value = measure ? Number(measure[1]) : NaN;
  if (Number.isFinite(value) && (
    (property.min !== undefined && value < property.min) ||
    (property.max !== undefined && value > property.max))) {
    return { code: 'motion-out-of-range', args: [property.key, String(property.min ?? '\u2212\u221E'), String(property.max ?? '\u221E')] };
  }
  if (Number.isFinite(value) && Math.abs(value) > MAX_MEASURE) {
    return { code: 'motion-past-bound', args: [String(value), String(MAX_MEASURE)] };
  }
  return { code: 'motion-bad-value', args: [] };
};

/**
 * Parses one comma-separated keyframe list: `"-50% 0px, 30% 45px, 150% 400px"`.
 *
 * A lone token is the end value — the sugar that keeps the common case short.
 * Two tokens are a position and a value. A malformed entry drops only itself,
 * so the rest of the property still animates.
 */
export const parseKeyframeList = (raw: string, property: PropertyDef): KeyframeList => {
  const keyframes: RawKeyframe[] = [];
  const rejected: Refusal[] = [];
  let geometryDependent = false;

  /**
   * A value written with nothing in it is a mistake worth naming: someone
   * meant to say something and did not. Named, not echoed — pushing the raw
   * value reported the empty string, a complaint with no text in it.
   */
  if (raw.trim() === '') {
    return { keyframes, rejected: [{ code: 'motion-no-keyframes', args: [] }], geometryDependent };
  }

  for (const entry of splitTopLevel(raw)) {
    if (keyframes.length >= MAX_KEYFRAMES) {
      rejected.push({ code: 'motion-too-many-keyframes', args: [String(MAX_KEYFRAMES)] });
      break;
    }
    const trimmed = entry.trim();
    /**
     * An empty segment is a separator someone typed twice, or one left at the
     * end — `"0% 0px, 100% 40px,"`, which is what anyone used to CSS writes.
     * It carries no keyframe either way, so there is nothing to refuse and
     * nothing useful to say about it.
     */
    if (trimmed === '') continue;

    /**
     * Split at the **first** run of whitespace, not every run. A position
     * never contains a space, and everything after it is the value — which
     * for a numeric property is one token, and for a property module
     * supplying its own parser may be an entire CSS value: `linear-gradient(
     * red, blue)`, `0 2px 8px rgb(0 0 0 / 0.3)`.
     */
    const cut = trimmed.search(/\s/);
    const hasPosition = cut > 0;
    const rawValue = hasPosition ? trimmed.slice(cut + 1).trim() : trimmed;
    const measure = parseMeasure(rawValue, property);
    if (!measure) {
      /** The measure's own refusal, with the segment it came from carried alongside. */
      { const why = whyRefused(rawValue, property); rejected.push({ code: why.code, args: [trimmed, ...why.args] }); }
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
       * **The first token is not a position — so this is probably a MULTI-TOKEN VALUE.**
       *
       * The lone-value sugar ("animate TO this") only ever worked for single-token values,
       * because any whitespace commits the entry to the position branch. So
       * `shadow: '0 2px 8px rgba(0,0,0,.3)'` — the most natural way anyone writes a box-shadow —
       * was refused, and refused with a message about POSITIONS, which names the wrong half of
       * the value. Retrying the whole entry as a value restores the sugar for exactly the
       * properties that need it most (a module's own parser can accept any CSS value), and only
       * falls through to the position diagnostic when nothing reads the entry at all.
       */
      const whole = parseMeasure(trimmed, property);
      if (whole) {
        keyframes.push({ position: 100, positionUnit: '%', value: whole.value, unit: whole.unit });
        continue;
      }
      rejected.push({ code: 'motion-bad-position', args: [trimmed, String(MIN_PERCENT), String(MAX_PERCENT)] });
      continue;
    }
    if (position.positionUnit !== '%') geometryDependent = true;
    keyframes.push({ ...position, value, unit });
  }

  /**
   * A list whose every segment was empty is the empty-value mistake wearing a
   * separator: `translate-y: ','` carries no keyframe, refuses nothing, and
   * so reported nothing at all.
   */
  if (!keyframes.length && !rejected.length) rejected.push({ code: 'motion-no-keyframes', args: [] });

  return { keyframes, geometryDependent, rejected };
};

/** The largest magnitude any authored value may have — see `parseMeasure`. */
const MAX_MEASURE = 1e9;

/**
 * Parses and validates an authored VALUE, returning both the number and the
 * unit it was written in. This is the function a GUI validates a control's
 * input with.
 *
 * Authored values are untrusted input — in a CMS anyone who can edit a block
 * can set them. The pattern is deliberately strict so nothing resembling
 * `calc()`, `url()`, or a CSS function can reach a style property. An
 * unparseable or out-of-range value returns null and the caller drops the
 * animation, leaving content in its natural state.
 */
export const parseMeasure = (
  raw: string,
  property: PropertyDef
): { value: number; unit: Unit } | null => {
  if (property.parse) {
    /**
     * A module wrote this, and a throw here is the same answer as `null`.
     * A finite number or a refusal — nothing else crosses: a module
     * returning NaN, Infinity or (from JavaScript) a string produced three
     * silent shapes, every one a style write the CSSOM drops or corrupts.
     */
    let slot: number | null = null;
    try { slot = property.parse(raw); } catch { /* refused, like any bad value */ }
    return typeof slot === 'number' && Number.isFinite(slot) ? { value: slot, unit: '' } : null;
  }
  const match = /^\s*(-?(?:\d+\.?\d*|\.\d+))(px|deg|%|rem|em|vh|vw)?\s*$/.exec(raw);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  /**
   * A magnitude past anything this library can write *meaningfully*. What
   * breaks past the bound is arithmetic and saturation: `format()` multiplies
   * by 1000 before rounding, which exceeds 2^53 above ~9e12, and Chromium
   * clamps a transform's translation near 3.36e7px. A billion leaves twelve
   * orders of magnitude of headroom for an overshooting curve, and no layout
   * is a billion pixels.
   */
  if (Math.abs(value) > MAX_MEASURE) return null;

  const authored = (match[2] ?? '') as Unit;
  if (authored !== '' && !property.units.includes(authored)) return null;

  if (property.min !== undefined && value < property.min) return null;
  if (property.max !== undefined && value > property.max) return null;

  return { value, unit: authored === '' ? property.defaultUnit : authored };
};

/**
 * Validates a CSS selector from an authored value.
 *
 * A selector reaching `matches()` or `querySelector()` is **parsed, not
 * evaluated** — it is not an injection sink. The two things that genuinely
 * matter are that it parses at all (a malformed one throws) and that it is
 * not pathological. So validation is: ask the browser's own parser, and
 * refuse the two shapes that cause trouble — selector lists where the caller
 * is `querySelector` (first-match-of-any is not what `a, b` reads as), and
 * `:has()`, which can be genuinely expensive and may run on every mutation.
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
 * Exported so the easings module can be tested against the exact list the
 * pack accepts. The two are separate concerns: the pack validates the
 * vocabulary and the module implements it, so a keyword added here and not
 * there passes validation and then silently animates linear.
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
 * This one matters more than it looks. The value is interpolated into the
 * `transition` shorthand — `transform 0.1s <ease>` — and the shorthand takes
 * a comma-separated list, so an unvalidated value can append a whole second
 * entry. Measured, before this existed: `ease="linear, all 9999s linear"`
 * produced a computed `transition-property: filter, all` at `9999s`, which
 * freezes every animatable property on the element against any later change,
 * by anyone. So: an allowlist of the keywords, plus the two functional
 * forms, and nothing else.
 */
export const parseEasing = (raw: string): string | null => {
  const value = raw.trim();
  if ((EASING_KEYWORDS as readonly string[]).includes(value)) return value;
  if (CUBIC_BEZIER.test(value)) {
    /**
     * The **x** co-ordinates, which CSS bounds to 0-1. `cubic-bezier(2, 0,
     * 3, 1)` passed the shape test and was handed to `inertia-ease`
     * verbatim, where it builds a shorthand the CSSOM refuses whole, leaving
     * **no transition at all** and inertia silently off. `y` is deliberately
     * not bounded: a control point above 1 or below 0 is legal and is
     * exactly how a springy curve overshoots and settles back.
     */
    const [x1, , x2] = value.slice(13, -1).split(',').map(Number);
    if (x1! < 0 || x1! > 1 || x2! < 0 || x2! > 1) return null;
    return value;
  }

  /**
   * A step count is a positive integer, and `jump-none` spreads its jumps
   * across `count - 1` intervals — so a single step leaves nothing to divide
   * by. Chromium, Firefox and WebKit all reject `steps(0)` and `steps(1,
   * jump-none)`; measured rather than read off the spec.
   */
  const stepped = STEPS.exec(value);
  if (stepped) return stepped[2] === 'jump-none' && stepped[1] === '1' ? null : value;
  return null;
};

/**
 * Validates a CSS `transform-origin` — and the real grammar, not "one to
 * three keywords or lengths": CSS has two two-value forms — `[left|center|
 * right|<len>] [top|center|bottom|<len>]`, or two keywords in *either* order
 * with one per axis — and a third value that must be a length. Verified
 * against `CSS.supports` in a browser, form by form: `10px top` is legal and
 * `top 10px` is not, which is the kind of asymmetry a summary loses.
 */
const ORIGIN_KEYWORDS = ['left', 'center', 'right', 'top', 'bottom'];
const ORIGIN_LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(px|rem|em|%|vh|vw)?$/;

export const parseOrigin = (raw: string): string | null => {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 1 || parts.length > 3 || parts[0] === '') return null;
  for (const part of parts) {
    if (!ORIGIN_KEYWORDS.includes(part) && !ORIGIN_LENGTH.test(part)) return null;
  }

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
 * Presets. These exist because a named effect is the fastest thing for a
 * person or a model to reach for — `data-vd-motion="fade-up"` is the
 * everyday spelling. Each value is exactly what an author would write in the
 * object, so a preset is never a special case downstream: it expands into
 * precisely what the hand-authored equivalent would produce.
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
