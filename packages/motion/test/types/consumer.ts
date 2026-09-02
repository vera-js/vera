import {
  createMotion, EVENTS, PROPERTIES, SETTINGS, PRESETS,
  ATTRIBUTE_PREFIX, NAMESPACE, getProperty, isProperty, isSetting, isPreset,
} from '@verajs/motion';
import type { MotionOptions, MotionInstance, MotionEventDetail, PropertyDef, Unit, Range } from '@verajs/motion';
import type {
  Wirable, WirableTree, WirableFactory, Insert, InsertMap, Easing,
} from '@verajs/motion';
import { motion as veraMotion } from '@verajs/motion/vera';
import type { VeraMotion } from '@verajs/motion/vera';
import { createScrollTo } from '@verajs/motion/scroll-to';
import type { ScrollToOptions, ScrollToInstance } from '@verajs/motion/scroll-to';

/**
 * The modules, which this fixture did not import at all — so their published
 * declarations were the one part of the public surface no consumer-shaped
 * check ever compiled. They are also the newest part, and the part a page has
 * to reach for by name.
 */
import { wireMotion, properties, settings, parseMeasure, parseSelector } from '@verajs/motion';
import { reject, pageProblem } from '@verajs/motion';
import { paint } from '@verajs/motion/paint';
import { path, parsePathData } from '@verajs/motion/path';
import { easings } from '@verajs/motion/easings';
import { sequence } from '@verajs/motion/sequence';
import type { SequenceOptions } from '@verajs/motion/sequence';
import { split } from '@verajs/motion/split';

/** Every shape `wireMotion` advertises: a descriptor, an array, and a factory. */
wireMotion(easings);
wireMotion(paint);
wireMotion(split);
wireMotion(sequence);
wireMotion(sequence());
const sequenceOptions: SequenceOptions = { allowedOrigins: ['https://cdn.example'] };
wireMotion(sequence(sequenceOptions));
wireMotion([paint, easings, split, path]);

/** The live vocabulary a GUI builds controls from. */
const everyProperty: readonly PropertyDef[] = properties();
const everySetting = settings();
void everyProperty;
void everySetting;
const measured = parseMeasure('40px', getProperty('translate-y')!);
const selected: string | null = parseSelector('#curve');
const pathData: string | null = parsePathData('M0 0 L10 10');
void measured;
void selected;
void pathData;

const options: MotionOptions = {
  inertia: 0.2,
  respectReducedMotion: false,
  breakpoints: { phone: [0, 640] },
  onProgress: (node: HTMLElement, progress: number) => { void node; void progress; },
};
const motion: MotionInstance = createMotion(options);
motion.init();
motion.enable();
motion.disable();
motion.refresh();
motion.observe(document.body);
motion.unobserve(document.body);
const on: boolean = motion.enabled;
const reduced: boolean = motion.reducedMotion;
const rejected = motion.rejected;
motion.destroy();

document.addEventListener(EVENTS.active, (event) => {
  const detail = (event as CustomEvent<MotionEventDetail>).detail;
  const el: HTMLElement = detail.element;
  const p: number = detail.progress;
  void el; void p;
});

const prop: PropertyDef | undefined = getProperty('translate-y');
const unit: Unit = 'px';
const range: Range = { min: 0, max: 640 };
void [PROPERTIES, SETTINGS, PRESETS, ATTRIBUTE_PREFIX, NAMESPACE, isProperty, isSetting, isPreset,
      prop, unit, range, on, reduced, rejected];

/**
 * Authoring a property, which is what the README tells a module author to do
 * and what nothing here compiled. The file read a `PropertyDef` and never
 * wrote one, so the shape a third party actually types was checked only by the
 * library's own modules — which are compiled from source, against the internal
 * declaration rather than the shipped one.
 */
wireMotion({
  attribute: 'tracking',
  category: 'text',
  cssProperty: 'letter-spacing',
  defaultUnit: 'px',
  units: ['px', 'rem', 'em'],
  initial: 0,
});

/**
 * And the non-numeric form: its own `parse` and `apply`, and `discrete` for
 * values that are slots in a table rather than quantities. `apply` returning a
 * string is a refusal, which is the part a module author is most likely to get
 * wrong and the reason the return type is `void | string` rather than `void`.
 */
const slots: string[] = [];
wireMotion({
  attribute: 'tint',
  category: 'paint',
  cssProperty: 'color',
  defaultUnit: '',
  units: [''],
  initial: 0,
  discrete: true,
  parse: (raw: string): number | null => {
    if (!raw.trim()) return null;
    slots.push(raw);
    return slots.length - 1;
  },
  apply: (node: HTMLElement, value: number): void | string => {
    const picked = slots[Math.floor(value)];
    if (picked === undefined) return 'tint: no such slot.';
    node.style.setProperty('color', picked);
  },
});

/**
 * A whole module, written the way the first-party ones are.
 *
 * This is the shape that was unwriteable: `wireMotion` accepted it, but naming
 * the type of an exported const needed `Wirable`, `Insert` and friends, and
 * none of them were re-exported from the package. Inference covered a literal
 * passed straight in; it does not cover the thing a module actually is.
 */
const tintTeardown: Insert = {
  on: 'teardown',
  fn: (owns: (node: Element) => boolean) => { void owns; },
};

const tintPrepare: Insert = {
  on: 'prepare',
  fn: (root: ParentNode, enabled: boolean) => { void root; void enabled; },
};

/** The `easing` point, whose `fn` returns the one type a curve shaper can be. */
const noCurves: Insert = {
  on: 'easing',
  fn: (value: string): Easing | null => (value === 'linear' ? null : (p: number) => p),
};

const tintModule: readonly Wirable[] = [tintTeardown, tintPrepare, noCurves];
wireMotion(tintModule);

/** Configurable, which is why `wireMotion` takes a factory at all. */
const tintFactory: WirableFactory = () => tintModule;
wireMotion(tintFactory);

/** And the recursive array form, which is what `WirableTree` names. */
const nested: WirableTree = [tintModule, [tintTeardown], tintFactory];
wireMotion(nested);

/** `InsertMap` is where each point's signature is declared. */
const onTeardown: InsertMap['teardown'] = (owns) => { void owns; };
void onTeardown;

const scrollOptions: ScrollToOptions = { duration: 600, offset: 80 };
const scroller: ScrollToInstance = createScrollTo(scrollOptions);
scroller.init();
scroller.toElement(document.body, { duration: 300 });
scroller.toPosition(0);
scroller.collect();
scroller.destroy();

/**
 * The rest of the surface, which was here by absence: eleven exported names
 * that no strict consumer compiled, because this file is a hand-written list
 * of imports and the package's exports are not. The diagnostics types are the
 * ones that matter — `motion.rejected` and `scroller.rejected` are how a
 * consumer finds out an attribute was refused, and their element type was the
 * one thing about them nothing checked.
 */
import {
  CATEGORIES, UNITS, MIN_PERCENT, MAX_PERCENT,
} from '@verajs/motion';
import type {
  RejectedElement, MotionElement, SettingDef, Category, Band,
} from '@verajs/motion';
import { resolveEasing } from '@verajs/motion/easings';
import type { ScrollToProblem } from '@verajs/motion/scroll-to';

/** Diagnostics, read the way a consumer reads them. */
const refusals: readonly RejectedElement[] = motion.rejected;
for (const entry of refusals) {
  /**
   * Nullable, and a strict consumer has to say so. `node` is `null` for a
   * problem with the configuration rather than with an element — the same
   * shape `ScrollToProblem` has always had. Writing `const node: Element =
   * entry.node` is what this file said before, and it is exactly the line that
   * stops compiling for anyone who upgrades, which is the point of compiling
   * it here.
   */
  const node: Element | null = entry.node;
  const reasons: readonly string[] = entry.rejected;
  if (node) void node.tagName;
  void reasons;
}
const scrollRefusals: readonly ScrollToProblem[] = scroller.rejected;
for (const problem of scrollRefusals) {
  const why: string = problem.reason;
  void why;
}

/** The vocabulary a GUI enumerates, and the bounds it clamps to. */
const category: Category = CATEGORIES[0];
const everyUnit: readonly Unit[] = UNITS;
const bounds: readonly [number, number] = [MIN_PERCENT, MAX_PERCENT];
const setting: SettingDef | undefined = settings()[0];
void [category, everyUnit, bounds, setting];

/** `resolveEasing` is what `easings` is built from, and is exported beside it. */
const curve = resolveEasing('cubic-bezier(0.33, 1, 0.68, 1)');
void curve;

/** Structural only — a consumer never constructs one, but it is in the surface.
    Exported so the monorepo's unused-locals sweep sees a use; nothing imports them. */
export type _MotionElementIsExported = MotionElement;
/** The two promised fields, read the way the README teaches. */
const publicElement = (e: MotionElement): [HTMLElement, number] => [e.node, e.timelinePosition];
void publicElement;
export type _BandIsExported = Band;

/**
 * The Vera integration, which is an entry point rather than a property module:
 * it hands shadow roots to `observe()` and registers nothing. A Vera app is the
 * consumer, and what it compiles against is the descriptor's shape.
 */
const veraModule: VeraMotion = veraMotion;
const insertPoint: 'init' = veraModule.on;
const insertPriority: number = veraModule.priority;
/** Both shapes: wired bare, and called to configure. */
const configured: VeraMotion = veraMotion({ inertia: 0.3 }, 90);
const wired: MotionInstance | null = configured.instance;
veraModule.fn(document.createElement('my-component'));
void [insertPoint, insertPriority, configured, wired];

/**
 * The runtime half of the module-authoring surface: where a third-party module
 * says why it refused. Exported from the package rather than reached by
 * relative path, so a built module shares the registry `createMotion` reads
 * instead of bundling its own — see `scripts/check-wiring.js`.
 */
const refuse: (node: Element, reason: string) => void = reject;
const refusePage: (reason: string) => void = pageProblem;
void [refuse, refusePage];
