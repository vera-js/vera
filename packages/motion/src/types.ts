/**
 * The motion pack's shared types — the import-graph ROOT.
 *
 * This module imports nothing from inside the pack (CODE-PRINCIPLES §1, Types): every arrow points
 * in, none point out, so no import cycle can pass through here. Cross-file and public types belong
 * in this file; a type one file uses stays in that file, unexported.
 *
 * Seeded by the write-path build (registry first); the vocabulary types spread across `schema.ts`,
 * `parse.ts`, `runtime.ts` and `region.ts` migrate here stage by stage as the rewrite reshapes
 * them — each moves once, when it changes anyway, rather than twice.
 */

/** A tree generated rules are delivered into. Keyframe names resolve per tree scope (measured:
 *  `tests/browser/keyframes-tree-scope.test.js`), so this is the registry's unit of adoption. */
export type SheetRoot = Document | ShadowRoot;

/**
 * One generated element's variable, as the driver sees it — the NARROW slice, deliberately: the
 * driver ticks potentially every frame, and handing it the whole runtime element would couple the
 * hot loop to everything. Mutated in place, one allocation per element for its whole life.
 *
 * `written` is null until the first write, which is how "paint the initial state immediately"
 * and "chase from where you are" stay distinguishable without a flag.
 */
export interface Driven {
  readonly node: HTMLElement;
  /** The custom property this element's animation seeks by — `--vm-p`, or the author's rename. */
  readonly varName: string;
  written: number | null;
  target: number;
  /** `idle` writes land immediately; `chase` eases toward target; `ramp` is a play's clock. */
  mode: 'idle' | 'chase' | 'ramp';
  /** Chase time-constant, seconds — derived from `inertia` (≈settled at 3τ). */
  tau: number;
  rampFrom: number;
  rampStart: number;
  rampDuration: number;
  /**
   * The element's contained tick closure, or null — called with every value this slice writes,
   * so a tick sees exactly the number CSS sees, at the same moment, post-chase and post-ramp.
   * Pre-bound by the runtime (containment and reporting live there); the loop just calls it.
   */
  readonly run: ((progress: number) => void) | null;
}

/** Value units the grammar accepts — LITERAL here (types.ts imports nothing); the runtime
 *  arrays in schema are pinned to these unions in both directions by satisfies + an
 *  exhaustiveness assertion, so drift is a compile error. */
export type Unit = 'px' | 'deg' | '%' | 'rem' | 'em' | 'vh' | 'vw' | '';

export type PositionUnit = '%' | 'vh' | 'vw' | 'px' | 'rem';

export type Category = 'transform' | 'filter' | 'border';

export interface RawKeyframe {
  /** In `positionUnit`, NOT yet normalised to a timeline fraction. */
  readonly position: number;
  readonly positionUnit: PositionUnit;
  readonly value: number;
  /** The value's own unit, from the property's allowlist. */
  readonly unit: Unit;
  /**
   * A TEXT-valued keyframe (8c): the validated CSS text of a `parseText` property — a colour, a
   * gradient, a shadow. Present only for those; `value`/`unit` are 0/'' placeholders then. Text
   * values are declared at their AUTHORED stops only and the browser interpolates between them —
   * which is the entire point: the slot-and-step machinery this replaces existed because numeric
   * curves could not carry a string, not because stepping was wanted.
   */
  readonly text?: string;
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

export interface PropertyDef {
  /** Key spelling, kebab-case: `translate-y`. */
  readonly key: string;
  readonly parse?: (raw: string) => number | null;
  /**
   * A TEXT property's validator (8c): the authored value in, the validated CSS text out (or null,
   * refused). The text lands in generated keyframes at its authored stops and the BROWSER
   * interpolates — which retired both imperative writers this slot has held: `apply(node, value)`
   * (stage 6) and the `css(value)` slot-formatter that briefly replaced it. Text properties ride
   * the generated path only; the inline path refuses them by name.
   */
  readonly parseText?: (raw: string) => string | null;
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
  /** A built-in `parse` setting's OWN refusal code. Without one, a parse refusal falls to
   *  `motion-setting-module-refused` — right for a third-party module, wrong for a setting this
   *  pack ships: "the module that owns it" is us, and the author deserves the actual grammar. */
  readonly code?: string;
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
    | 'offset'
    /** `"<edge> <viewport position>"` — one end of the range percentages are measured across. */
    | 'alignment'
    /** One or two alignments, comma-separated: the span a scrub crosses, or a play's two events. */
    | 'range';
  /** Bounds for `number`. A setting without them is unbounded, which is a bug. */
  readonly min?: number;
  readonly max?: number;
  readonly allowed?: readonly string[];
}

export type Wirable = PropertyDef | SettingDef | Insert | WirableFactory;

/** A module that takes options; calling it is optional. */
export type WirableFactory = () => WirableTree;

/**
 * What `registerVocabulary` accepts: a descriptor, a factory, or any nesting
 * of arrays of them. Recursive on purpose, because the nesting is real — a
 * module is usually itself a list.
 */
export type WirableTree = Wirable | readonly WirableTree[];

/**
 * One preset, shaped exactly like the value it stands for: animated properties under `keyframes`,
 * settings beside it. The index signature is the settings half — it cannot be narrower without
 * restating the settings table here, which a wired pack may have extended anyway.
 */
export interface Preset {
  readonly keyframes?: Readonly<Record<string, string>>;
  readonly [setting: string]: unknown;
}

/**
 * The preset pack — ten named motion values, wired like any other vocabulary.
 *
 * **These are AN example, not THE list.** A preset is the most project-specific thing in this
 * package: a site's house reveal is not ours to guess, and the ten below are a starting vocabulary
 * rather than a standard.
 *
 *   wireDirectives([motion, presets]);            // the shipped ten
 *   wireDirectives([motion, presets(house)]);     // yours, MERGED over ours
 *
 * **A preset is a motion value with a name**, and that is the whole design: the entries below are
 * the same shape as the attribute they expand into, so anything writable in markup is writable in a
 * preset and there is no second format to learn or keep in step. That includes SETTINGS, which is
 * what makes a pack worth shipping rather than a snippet worth copying — one word can carry a
 * project's whole motion character.
 *
 * **`presets(table)` merges rather than replaces**, key by key, yours winning. Two reasons, and the
 * second is the one that decided it:
 *
 * Overriding one preset is the common intent — `presets({ 'fade-up': … })` means "these ten, with
 * fade-up changed", and replace-by-default would silently lose the other nine.
 *
 * And chaining two packs instead would have reintroduced an ordering rule at the wiring level:
 * `[motion, presets, presets(house)]` and `[motion, presets(house), presets]` would resolve a
 * collision differently with nothing on the page saying which won. That is the same invisible
 * order-dependence the expansion pass exists to remove one level down, and removing it there while
 * adding it here would have been silly. Explicit beats inherited, key by key, at BOTH levels — one
 * rule, stated once.
 *
 * To inherit nothing, use the function that means that: `motionExtension({ on: 'preset', fn })`
 * never references this table, so it also drops out of the bundle. A pack declares its intent by
 * which function it calls rather than by a flag.
 */


export type PresetTable = Readonly<Record<string, Preset>>;

/**
 * What an insert point is called, and what it must be. A typed map rather
 * than bare strings because a misspelled insert point that silently never
 * fires is the failure this mechanism is most likely to produce. These are
 * the MOTION PACK's internal seams — the engine's own inserts are a different
 * system; these fire from the motion directive's lifecycle.
 */
export interface InsertMap {
  /**
   * Turns a preset NAME into the motion value it stands for, or null if this pack does not know it.
   * The presets module — and, deliberately, anyone else's: the shipped table is one registration on
   * this point and carries no privilege over a third party's.
   *
   * Unlike the four below, this chain's links RETURN a value, so a resolver that
   * throws or answers nonsense has to be contained per link rather than per page.
   */
  preset: (name: string) => Readonly<Record<string, unknown>> | null;
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

export interface ElementMotion {
  readonly property: PropertyDef;
  readonly unit: Unit;
  /**
   * Positions are still in their authored units. Normalising them needs the
   * element's size and the viewport, which parse has no business knowing —
   * so the curve is built by the runtime and rebuilt on resize when any
   * position depends on geometry.
   */
  readonly keyframes: readonly RawKeyframe[];
  /**
   * Width-ranged overrides that merge onto the base. From an inline
   * `[0-500]: …` or from a `-name` key suffix whose range was registered on
   * the region — both resolve to a range here, so the runtime only ever
   * deals in ranges and never in names.
   */
  readonly bands: readonly Band[];
  /** True when a position uses anything but `%`, so the curve must be rebuilt on resize. */
  readonly geometryDependent: boolean;
  /**
   * This property's own curve shaper, from the nested value form —
   * `opacity: { frames: '…', ease: 'ease-in' }` — overriding the element's
   * `ease` for this property alone. The fold-in's addition: the curve engine
   * always took an ease per curve; the old attribute grammar had nowhere to
   * write one. Resolved by the runtime through the easings module, exactly
   * as the element-level value is; carried here as the validated STRING.
   */
  readonly ease?: string;
}

export interface ParseContext {
  /**
   * Named width ranges, so `opacity-mobile` can mean whatever this site
   * calls mobile. A name is only ever an alias for a range.
   */
  readonly breakpoints?: ReadonlyMap<string, Range>;
  /**
   * Where diagnostics go for an element that is dropped entirely. An element
   * whose *every* animation failed to validate has no `ParsedElement` to
   * carry its `rejected` list, so the reasons used to be discarded — and
   * that is precisely the element someone is debugging when they ask why
   * nothing is animating.
   */
  readonly dropped?: DroppedElement[];
  /**
   * The region's own `inertia`, for the one refusal that cannot be decided
   * from an element's value alone: `inertia-ease` with nothing to ease. An
   * element that writes neither `inertia` nor a category override inherits
   * this, and at 0 there is no transition for the easing to shape.
   */
  readonly inertia?: number;
}

/**
 * One element's diagnostics. `node` is `null` for a problem with the
 * *configuration* rather than with an element — a region option the runtime
 * refused and fell back on. Consumers iterating this must expect the null;
 * there is at most one such entry, and it sorts first.
 */
export interface RejectedElement {
  readonly node: Element | null;
  readonly rejected: readonly Refusal[];
}

/** The same, for an element rather than for the configuration. */
export interface DroppedElement extends RejectedElement {
  readonly node: Element;
}

export interface ParsedElement {
  readonly node: Element;
  readonly animations: readonly ElementMotion[];
  readonly settings: Readonly<Record<string, string | number | boolean>>;
  /**
   * How far this element's keyframes shift, from a `stagger` on an ancestor.
   * Left in its authored unit rather than resolved here, for the same reason
   * keyframe positions are: `40px` of stagger and a `50%` keyframe normalise
   * against different quantities, so they can only be added once both are
   * timeline fractions. The runtime does that.
   */
  readonly stagger?: { readonly position: number; readonly positionUnit: PositionUnit };
  /** Values the schema could not accept, for diagnostics. Empty on a clean parse. */
  readonly rejected: readonly Refusal[];
}

/**
 * Geometry: every reading the runtime takes from the page.
 *
 * Two rules hold across the file. Readings are **transform-immune by construction** — layout
 * metrics (`offsetTop`, `offsetWidth`), never visual boxes, so an element's own animation can
 * never feed back into its own timeline. And anything sticky is **stood down for the length of a
 * reading and put back** — both `offsetTop` and a rect follow sticky positioning, which turns a
 * question about the element's slot into one about where the page happens to be scrolled.
 */
export interface WindowSize {
  /** Scroll offset at the leading edge of the viewport. */
  readonly start: number;
  readonly end: number;
  /** Viewport extent along the scroll axis. */
  readonly size: number;
  readonly width: number;
  readonly height: number;
  /**
   * The furthest `end` can ever get: the scrollport's extent added to how far
   * this container can scroll. What an element's timeline is compared against
   * to know whether the page is long enough to finish it.
   */
  readonly reach: number;
}

/**
 * The element's measured geometry, for values whose keyframe POSITIONS are lengths (vh/px/rem) —
 * those normalise against the scroll window, so their rules are PER-GEOMETRY-BUCKET: the hash
 * covers the normalised text, identical geometries still share, and a re-measure regenerates.
 * Absent (the SSR pass, the test door), geometry-position values answer null and wait for the
 * client's first measure — frame 0 is the natural state there, honestly.
 */
export interface GeometryContext {
  readonly scrollWindow: number;
  readonly win: WindowSize;
  readonly root: number;
}

/** One easing group: the animations sharing one timing function and one seek variable, emitted
 *  as one `@keyframes` rule and one entry in the element's `animation` list. */
export interface GeneratedGroup {
  /** Content hash of this group's base body — the registry key its rule is acquired under. */
  readonly hash: string;
  /** The animation name, `vm-<hash>` — derived, carried so no caller re-derives it differently. */
  readonly name: string;
  /** The complete `@keyframes` rule, ready for `acquire`. */
  readonly rule: string;
  /** The effective timing function, verbatim — the authored per-property ease, else the element's. */
  readonly ease: string;
  /** The variable THIS group seeks by — the base variable, or a per-category one. */
  readonly varName: string;
}

/** What generation hands the caller: the rules to acquire, and the declarations the element carries. */
export interface Generated {
  /** The MARKER — content hash over the whole identity (groups × segments), the `data-vm-motion` value. */
  readonly hash: string;
  /**
   * How this element is DRIVEN. `seek`: the paused-animation delay-seek, one number per frame
   * (scrub, and play's ramp fallback). `transition`: play emission as CSS transitions — base
   * declarations plus an active state toggled by ONE attribute flip, the compositor owning the
   * clock and reversal following the platform's reversing algorithm (ratified: retimed,
   * curve-mirrored, may reverse-overshoot). Dispatch is compile-time with no authoring surface.
   */
  readonly mode: 'seek' | 'transition';
  /** Transition mode only: the ACTIVE state's declarations, empty otherwise. Enters the sheet
   *  AFTER the base rule — they tie on specificity, and order is the tiebreak. */
  readonly activeRule: string;
  /**
   * Transition mode only: the transition LONGHANDS, under the ARMED marker (`data-vm-armed`) —
   * separate from the base on purpose, measured: rules injected at ACTIVATION time arrive as a
   * style change, so longhands living on the base rule animate every element in from its
   * natural state (0.91 sampled en route to a 0.1 base). The runtime arms one frame after base
   * paints; the server pre-arms in markup, where first paint already has base and no change
   * ever fires.
   */
  readonly armedRule: string;
  /**
   * Transition mode only: active values under `@media (scripting: none)` with `transition:
   * none` — the no-JS story INVERTED for transitions (omni's shape, mirrored): the base state
   * is the hidden one, no JS ever flips the marker, so a no-JS visitor gets the END state
   * statically and the content is readable.
   */
  readonly noJsRule: string;
  /** Transition mode only: the END state under `@media (prefers-reduced-motion: reduce)` with
   *  `transition: none` — the no-JS inversion reused a third time, because the base state is
   *  the hidden one and reduced-motion visitors get the designed page, journey skipped. */
  readonly reducedRule: string;
  /**
   * Easing groups, author order. One group is the common case; a value whose properties carry
   * their own `ease`, or whose categories smooth at their own `inertia`, splits — `animation-name`
   * takes a list, and each group is one entry with its own timing function and seek variable.
   * The split is bounded by CSS itself: two entries cannot write one property, so a split that
   * would collide (two eases inside `filter`, say) answers null and keeps the old path.
   */
  readonly groups: readonly GeneratedGroup[];
  /**
   * Width-band segments beyond the base: per interval, the keyframes rules to acquire (deduped by
   * content hash — a group a band never touches re-hashes to its base rule) and the `@media` block
   * that switches the element's whole `animation-name` list. Base applies outside every band.
   */
  readonly segments: readonly { readonly min: number; readonly max: number;
    readonly rules: readonly { readonly hash: string; readonly rule: string }[];
    readonly media: string }[];
  /**
   * The distinct seek variables, each named with the setting that times it — what the runtime
   * registers and builds one driver slice per. Per-category variables exist only when their
   * override does; the common case is one entry carrying `inertia`.
   */
  readonly vars: readonly { readonly name: string;
    readonly inertiaKey: 'inertia' | 'transform-inertia' | 'filter-inertia' }[];
  /** The base variable — `--vm-p`, or the author's `progress` rename. The author-visible one. */
  readonly varName: string;
  /**
   * TIER N — the endgame rule, shipped UNCONDITIONALLY inside @supports: on engines with native
   * scroll-driven animations, an element the runtime opts in (`data-vm-native`) swaps the delay-seek
   * for `animation-timeline: view()` with `animation-range: cover 0%→100%` — which IS our default
   * scroll window, keyframe percentages mapping 1:1. Zero per-frame JS, and from SSR markup zero
   * JS at all. Engines without support ignore the block and the element rides tier C; the tiers
   * keep LAYERING (this rule only overrides the timing longhands, later in the sheet).
   */
  readonly nativeRule: string;
  /** The element's own declarations: the paused animation list, seeked by the progress properties. */
  readonly elementStyle: string;
  /**
   * The same declarations as a SHEET RULE on the doubled-attribute selector — 0-2-0, beating an
   * author's single-class tie for free — which is what lets bands and easing groups switch
   * `animation-name` under `@media`. `elementStyle` stays for consumers that inline (the parity
   * twin); the runtime delivers THIS.
   */
  readonly elementRule: string;
}

/** What a tick receives: the element and how far through its range it is. Nothing else — no
 *  scroll position (the framework's business), no curve (there is none), no return value. */
export type MotionFunction = (node: HTMLElement, progress: number) => void;

/**
 * A tick with a lifecycle — for consumers holding per-element resources (a canvas decoder, an
 * audio node). `setup` runs once at the element's activation with its parsed settings and its
 * refusal channel, and the teardown it returns runs when the element leaves or its value is
 * edited — the engine's rebuild-on-edit is the staleness story, exactly as it was for property
 * modules. A bare function is the common case; the descriptor is the one shape richer.
 */
export interface MotionFunctionModule {
  readonly run: MotionFunction;
  readonly setup?: (
    node: HTMLElement,
    settings: Readonly<Record<string, string | number | boolean>>,
    reject: (code: string, args?: readonly string[]) => void
  ) => (() => void) | void;
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
  /** `false` = the cache-escape hatch: generated CSS delivered as a style CHILD of each
   *  animated element instead of the shared registry sheet. Default true (hoisted). */
  readonly hoist?: boolean;
  readonly translateZFix?: boolean;
  readonly transformOrigin?: string;
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
    /** Inline (hoist: false) delivery — rules live in the element's own style child. */
    readonly inline?: boolean;
    /** Transition-mode play: the write is ONE attribute flip and the compositor owns the
     *  clock; no drives run and no variable exists. */
    readonly transition: boolean;
    /**
     * Tier C: the CASCADE computes this element's progress from the scroller's one written
     * number — no per-frame JS write at all. True for the plain scrub (no inertia anywhere, no
     * tick, no play, no gate, no run-once latch, no renamed progress, one variable); everything
     * else drives inline, which beats the rule. JS still computes the number per pass for
     * events and onProgress — CSS drives, JS observes.
     */
    readonly cascade: boolean;
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

/** What the parse layer needs from a region — see `ParseContext`. */
export interface RegionParseContext {
  readonly breakpoints: ReadonlyMap<string, Range>;
  readonly dropped: DroppedElement[];
  readonly inertia: number;
}

export interface Region {
  add(parsed: ParsedElement, rejectFor: (reason: string) => void): RuntimeElement | null;
  remove(node: Element): void;
  /** Re-measure geometry after an external layout change — the old `refresh()`. */
  refresh(): void;
  /** Re-evaluate one `when`-driven element (the lazy observer's callback). */
  updateWhen(node: Element): void;
  /** Refresh a stagger group's curves after membership churn — cheap, no re-parse. */
  refreshGroup(host: Element): void;
  readonly parseContext: RegionParseContext;
  readonly settings: RuntimeSettings;
  destroy(): void;
  /** @internal preference plumbing */
  _setEnabled(on: boolean): void;
}

export interface MotionEventDetail {
  /** Timeline position at the moment it fired: 0 entering, 1 fully left. */
  readonly progress: number;
  /**
   * The element the notification is about.
   *
   * Redundant with `event.target` on an ordinary page, and not redundant at
   * all inside a shadow root: a composed event crossing the boundary is
   * **retargeted** to the host, so a listener on `document` sees the host and
   * cannot tell which inner element fired. Measured in Chromium. Carrying the
   * element here means one way to read it that is right in both places, rather
   * than a `composedPath()[0]` incantation the docs would have to teach.
   */
  readonly element: HTMLElement;
}

export interface RenderMotionOptions {
  /**
   * The SAME array the page hands `wireDirectives` — `[motion, presets, paint, sequence]` — so a
   * preset name or a pack property resolves on the server exactly as it will on the client. Only
   * the vocabulary registrations take effect here; directive registration and expression seams
   * are accepted and ignored, which is what lets ONE array serve both calls.
   */
  readonly wire?: readonly unknown[];
  /**
   * INLINE delivery — the cache-escape hatch's server half: each rendered element carries its
   * own `<style data-vm-sheet="inline">` child instead of one per-tree sheet, so a cached or
   * replayed FRAGMENT arrives complete. No document-level sheet is written at all, and
   * `@property` cannot ride inline (registration is document-global — measured); the client
   * registers via JS at wire, and a no-JS page's seek is correct untyped. Pair with the
   * client's `motion({ hoist: false })` so hydration takes the children over in place.
   */
  readonly inline?: boolean;
}

/** What one pass did — counts for the caller's logs, problems for its diagnostics. */
export interface RenderMotionReport {
  /** Elements marked and covered by emitted CSS. */
  readonly rendered: number;
  /**
   * Elements left for the client: out-of-scope values (stagger groups and anything else
   * `generateSimple` declines) and tick-only elements, whose first frame is JavaScript by
   * definition. These keep the pre-stage-7 behaviour — natural state until activation.
   */
  readonly skipped: number;
  /** Distinct CSS rules emitted across every sheet. */
  readonly rules: number;
  /** Everything refused along the way, in the same code+args shape the client reports. */
  readonly problems: readonly { readonly code: string; readonly args: readonly string[] }[];
}
