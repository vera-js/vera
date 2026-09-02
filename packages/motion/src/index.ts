/**
 * Public entry point for the animation runtime. Wiring only — no feature logic.
 *
 * The smooth-scroll module ships separately (`src/scroll-to.ts`). It is
 * imperative navigation rather than scroll-driven rendering, shares no state
 * with this, and most pages want one without the other.
 */
export { createMotion } from './modules/createMotion.js';
export type { MotionOptions, MotionInstance } from './modules/createMotion.js';
/**
 * Named because `MotionInstance` returns them. `rejected` and `elements` are
 * both part of the public shape, and a consumer could not write a function
 * taking either without these.
 */
export type { RejectedElement } from './modules/parse.js';
export type { MotionElement } from './modules/runtime.js';

/**
 * The events the runtime dispatches. Exported as names rather than string
 * literals so a consumer cannot drift from the namespace they are built from.
 */
export { EVENTS } from './modules/events.js';
export type { MotionEventDetail } from './modules/events.js';

/**
 * The attribute vocabulary, so a GUI can generate controls from the same
 * definition.
 *
 * `properties()` and `settings()` are the ones to build controls from, not
 * `PROPERTIES` and `SETTINGS`. The arrays are the built-in tables and stop
 * there; the functions include whatever `wireMotion` has been given, which is
 * where `background`, `color`, `frame` and the rest live. The arrays stay
 * exported because they are the *built-ins*, which is a question worth being
 * able to ask, and because the types are derived from them.
 *
 * `parseMeasure` is what a GUI validates a control's input with — the same
 * function the runtime parses markup with, so a control cannot accept a value
 * the page would then reject (principle #7).
 */
export {
  NAMESPACE, ATTRIBUTE_PREFIX, PROPERTIES, SETTINGS, PRESETS,
  CATEGORIES, UNITS, MIN_PERCENT, MAX_PERCENT,
  properties, settings, parseMeasure, parseSelector,
  getProperty, isProperty, isSetting, isPreset, wireMotion,
} from './modules/schema.js';
export type { PropertyDef, SettingDef, Category, Unit, Range, Band } from './modules/schema.js';
/**
 * The module-authoring surface. Type-only, so none of this costs a byte.
 *
 * `wireMotion` has always taken these and the README has always invited a
 * third party to wire their own — but the names were reachable only through
 * `./modules/schema.js`, which is not an exported subpath. So the shape every
 * first-party module is written in (`export const split: readonly Wirable[]`,
 * `export const easings: Insert`) was one a consumer could not write down.
 * Inference still worked for a literal passed straight to `wireMotion`; naming
 * the type of an exported const did not, which is exactly what a module is.
 */
export type {
  Wirable, WirableTree, WirableFactory, Insert, InsertMap, Easing,
} from './modules/schema.js';
/**
 * And the runtime half of that surface: where a module says *why* it refused.
 *
 * These are the one thing a module cannot carry its own copy of. The registry
 * is module-level state that `createMotion` reads, so a module bundling
 * `rejections.js` gets a private `WeakMap` nobody reads — which is exactly what
 * every built module was doing. `dist/split.js` opened with its own
 * `new WeakMap`, and a page that wired the *built* `@verajs/motion/split` and
 * misspelled `split="sentences"` got `["data-vm-split"]` in
 * `instance.rejected` and the sentence explaining it in the console, which the
 * GUI editor cannot read. Against `src/` the two resolved to one module and
 * the nineteen tests in the two files named for this all passed.
 *
 * Exported here so a module imports them from the package — `external` in each
 * module's build, the way `@verajs/motion/vera` already takes the runtime — and
 * a third-party module reaches the same channel the first-party ones do.
 */
export { reject, pageProblem } from './modules/rejections.js';
