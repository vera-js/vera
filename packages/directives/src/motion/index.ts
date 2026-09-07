/**
 * The MOTION PACK — `data-vd-motion` and `data-vd-motion-config`, riding the
 * directives engine. Design §16b: motion is a directive set, not a parallel
 * system; this file is the whole of its structural existence.
 *
 * `wireDirectives([motion])` uses the defaults; `wireDirectives([motion({
 * inertia: 0.2, breakpoints })])` configures. The dual dispatches on the
 * engine's sigiled seams mark — implemented HERE rather than imported,
 * because this pack is an additive bundle that imports nothing from the
 * engine: the mark is the contract, the helper is ten lines.
 *
 * Security boundary, kept from the design pass: `breakpoints` registration
 * and everything policy-shaped stay FACTORY-ONLY. An attribute is untrusted
 * input — `data-vd-motion-config` may set an axis or an inertia, never widen
 * an allowlist.
 */
import { parseMotion, forgetStagger, staggerHost, MOTION_ATTR } from './parse.js';
import type { ParsedElement } from './parse.js';
import {
  createRegion, enableMotion, disableMotion, configurePreferences, runInserts,
} from './region.js';
import type { Region, RegionOptions } from './region.js';
import {
  registerVocabulary, setProblemReporter, parseEasing, parseSelector, parseOrigin,
  properties, settings as vocabulary, parseMeasure, pageProblem,
} from './schema.js';
import type { Range, WirableTree } from './schema.js';
import { parseValue, isObject } from '../parse.js';
import type { Parsed, ParsedObject } from '../parse.js';

const CONFIG_ATTR = 'data-vd-motion-config';

/* ── the directive contract, structurally (no engine import — additive rule) ── */
type Ctx = {
  reject: (code: string, message: string, fix?: string) => void;
  selection: unknown;
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  run: (assignments: object) => void;
  runAttr: (attr: string) => void;
  eval: (value: unknown) => unknown;
};
type Directive = {
  name: string | { match: (suffix: string) => unknown | null };
  value: 'literal' | 'expression' | 'object' | 'none';
  setup?: (el: Element, ctx: Ctx) => void | (() => void) | { apply?: unknown; teardown?: () => void };
  apply?: (el: Element, value: unknown, ctx: Ctx) => void | (() => void);
  priority?: number;
  docs?: { summary: string; example: string };
};
type EngineSeams = {
  _$seams$: true;
  directive: (d: Directive) => void;
  reject: (element: Element | null, directive: string, code: string, message: string, fix?: string) => void;
};
type EngineConnector = (seams: EngineSeams) => void;

/* ── factory options and page defaults ────────────────────────────────────── */

export interface MotionOptions {
  /** Seconds the element takes to reach the position scroll says it should be at. */
  inertia?: number;
  /** Timing function of that catch-up. Handed to CSS. */
  inertiaEase?: string;
  /** Timing function of the curve itself. Evaluated here; needs the easings module past linear. */
  ease?: string;
  /**
   * Named width ranges: `{ phone: [0, 500], wide: [1200, null] }`. FACTORY
   * ONLY, deliberately — a name is registered by the page's own JavaScript,
   * never by an attribute.
   */
  breakpoints?: Readonly<Record<string, readonly [number, number | null]>>;
  respectReducedMotion?: boolean;
  disableOnTouch?: boolean;
  willChange?: boolean;
  translateZFix?: boolean;
  transformOrigin?: string;
  /** Per-frame progress callback — a callback rather than an event; see events.ts. */
  onProgress?: (node: HTMLElement, progress: number) => void;
}

const DEFAULTS = {
  inertia: 0.1,
  inertiaEase: 'cubic-bezier(0.33, 1, 0.68, 1)',
  ease: 'linear',
  breakpoints: { mobile: [0, 640], tablet: [641, 1024] } as Readonly<Record<string, readonly [number, number | null]>>,
  respectReducedMotion: true,
  disableOnTouch: false,
  willChange: false,
  translateZFix: false,
  transformOrigin: '',
} as const;

const KNOWN_OPTIONS = new Set([...Object.keys(DEFAULTS), 'onProgress']);

/**
 * The `breakpoints` option, checked the way an attribute's value already is.
 * A bad entry is dropped rather than the whole map, and a key naming the
 * dropped one is then reported as unknown, which is the right thing to say.
 */
const usableBreakpoints = (
  table: Readonly<Record<string, readonly [number, number | null]>> | undefined
): Map<string, Range> => {
  const out = new Map<string, Range>();
  for (const [name, range] of Object.entries(table ?? {})) {
    const pair = Array.isArray(range) ? (range as readonly unknown[]) : null;
    const min = pair ? Number(pair[0]) : NaN;
    const max = pair && pair[1] !== null && pair[1] !== undefined ? Number(pair[1]) : Infinity;
    if (!pair || !Number.isFinite(min) || Number.isNaN(max) || min > max) {
      pageProblem('breakpoint-unusable', __DEV__ ? `breakpoint ${JSON.stringify(name)} is not a usable [min, max]; ignoring it.` : `breakpoint ${JSON.stringify(name)}: not [min, max]`);
      continue;
    }
    out.set(name, { min, max });
  }
  return out;
};

/** Wraps `onProgress` so a consumer's exception cannot take the pack down —
 *  dropped on the first throw, because a callback that threw once will throw
 *  sixty times a second. */
const guarded = (
  fn: ((node: HTMLElement, progress: number) => void) | undefined
): ((node: HTMLElement, progress: number) => void) | undefined => {
  if (typeof fn !== 'function') {
    if (fn !== undefined) pageProblem('onprogress-not-fn', 'onProgress is not a function; ignoring it.');
    return undefined;
  }
  let live = true;
  return (node, progress) => {
    if (!live) return;
    try {
      fn(node, progress);
    } catch (error) {
      live = false;
      pageProblem('onprogress-threw', 'onProgress threw, so it is being ignored from here on.');
      console.warn('[vera] motion: the onProgress exception was:', error);
    }
  };
};

/** The resolved page defaults; the connector fills these before any region exists. */
let defaults = { ...DEFAULTS };
let breakpoints: Map<string, Range> = usableBreakpoints(DEFAULTS.breakpoints);
let onProgress: ((node: HTMLElement, progress: number) => void) | undefined;

const resolveOptions = (options: MotionOptions): void => {
  /** `undefined` means NOT GIVEN, not "off" — the GUI-generated-object rule. */
  const merged = { ...DEFAULTS, ...options } as typeof defaults & MotionOptions;
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined && key in DEFAULTS) {
      (merged as unknown as Record<string, unknown>)[key] = (DEFAULTS as Record<string, unknown>)[key];
    }
  }
  for (const key of Object.keys(options)) {
    if (!KNOWN_OPTIONS.has(key)) {
      pageProblem('unknown-option', __DEV__ ? `motion() was given "${key}", which is not an option this pack has.` : `"${key}": unknown option`);
    }
  }
  /** Boolean options that are not booleans invert accessibility switches silently. */
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (typeof fallback !== 'boolean') continue;
    const given = (options as Record<string, unknown>)[key];
    if (given === undefined || typeof given === 'boolean') continue;
    pageProblem('option-not-boolean', __DEV__ ? `${key} must be true or false, not ${JSON.stringify(given)}; using ${fallback}.` : `${key}: not a boolean`);
    (merged as unknown as Record<string, unknown>)[key] = fallback;
  }
  /** The same checks the object keys of the same names get. */
  for (const name of ['ease', 'inertiaEase'] as const) {
    if (parseEasing(String(merged[name])) === null) {
      pageProblem('option-unusable', `${name} ${JSON.stringify(merged[name])} is not usable; using ${DEFAULTS[name]}.`);
      (merged as unknown as Record<string, unknown>)[name] = DEFAULTS[name];
    }
  }
  if (!Number.isFinite(merged.inertia) || merged.inertia < 0 || merged.inertia > 3600) {
    pageProblem('option-unusable', `inertia ${String(merged.inertia)} is not usable; using ${DEFAULTS.inertia}.`);
    merged.inertia = DEFAULTS.inertia;
  }
  if (merged.transformOrigin && parseOrigin(merged.transformOrigin) === null) {
    pageProblem('option-unusable', `transformOrigin ${JSON.stringify(merged.transformOrigin)} is not usable; ignoring it.`);
    merged.transformOrigin = '';
  }
  defaults = merged;
  breakpoints = usableBreakpoints(options.breakpoints ?? DEFAULTS.breakpoints);
  onProgress = guarded(options.onProgress);
  configurePreferences(merged.respectReducedMotion, merged.disableOnTouch);
};

/* ── regions ──────────────────────────────────────────────────────────────── */

/** Config-element → its region, created lazily by the first member to ask. */
const regions = new WeakMap<Element, Region>();
let pageRegion: Region | null = null;

const regionOptions = (config: Readonly<Record<string, unknown>>, reportKey: (key: string, why: string) => void): RegionOptions => {
  let axis: 'vertical' | 'horizontal' = 'vertical';
  const axisGiven = config['axis'];
  if (axisGiven !== undefined) {
    if (axisGiven === 'vertical' || axisGiven === 'horizontal') axis = axisGiven;
    else reportKey('axis', "is 'vertical' or 'horizontal'");
  }
  let scrollElement: Window | HTMLElement = window;
  const scrollerGiven = config['scroller'];
  if (scrollerGiven !== undefined) {
    const selector = typeof scrollerGiven === 'string' ? parseSelector(scrollerGiven) : null;
    const found = selector ? document.querySelector(selector) : null;
    if (found instanceof HTMLElement) scrollElement = found;
    else reportKey('scroller', 'is a selector matching one element on the page');
  }
  const number = (key: 'inertia', fallback: number): number => {
    const given = config[key];
    if (given === undefined) return fallback;
    const n = Number(given);
    if (Number.isFinite(n) && n >= 0 && n <= 3600) return n;
    reportKey(key, 'must be a number from 0 to 3600');
    return fallback;
  };
  const easing = (key: 'inertia-ease' | 'ease', fallback: string): string => {
    const given = config[key];
    if (given === undefined) return fallback;
    const valid = typeof given === 'string' ? parseEasing(given) : null;
    if (valid !== null) return valid;
    reportKey(key, 'is not an easing name or a cubic-bezier()');
    return fallback;
  };
  return {
    axis,
    scrollElement,
    inertia: number('inertia', defaults.inertia),
    inertiaEase: easing('inertia-ease', defaults.inertiaEase),
    ease: easing('ease', defaults.ease),
    willChange: typeof config['will-change'] === 'boolean' ? (config['will-change'] as boolean) : defaults.willChange,
    translateZFix: typeof config['translate-z-fix'] === 'boolean' ? (config['translate-z-fix'] as boolean) : defaults.translateZFix,
    transformOrigin: defaults.transformOrigin,
    onProgress,
  };
};

/**
 * The region an element animates in: the nearest `data-vd-motion-config`
 * ancestor's, else the page's. Members create their region lazily, so
 * activation order between a config container and its descendants never
 * matters. The config text is parsed through the base grammar's cache, so
 * asking per member re-parses nothing.
 */
const regionFor = (el: Element, reject: (code: string, message: string) => void): Region => {
  const host = el.closest(`[${CONFIG_ATTR}]`);
  if (!host || host === el) {
    if (host === el) reject('config-on-member', 'motion-config configures a REGION for descendants; the element carrying it animates in the region above.');
    return (pageRegion ??= createRegion(regionOptions({}, () => {}), breakpoints));
  }
  const existing = regions.get(host);
  if (existing) return existing;

  let config: Record<string, unknown> = {};
  const raw = (host.getAttribute(CONFIG_ATTR) ?? '').trim();
  if (raw !== '') {
    try {
      const parsed = parseValue(raw) as Parsed;
      if (isObject(parsed)) config = parsed as ParsedObject;
      else reject('config-not-object', 'motion-config takes a braced object.');
    } catch (error) {
      reject('config-bad-parse', `motion-config could not parse: ${String((error as Error).message ?? error)}`);
    }
  }
  const region = createRegion(
    regionOptions(config, (key, why) => reject('config-refused', `motion-config ${key}: ${why}`)),
    breakpoints
  );
  regions.set(host, region);
  return region;
};

/* ── the run-once latch, carried across engine rebuilds ───────────────────── */
/**
 * `run-once` means once EVER, and an attribute edit rebuilds the whole
 * directive instance — so the latch travels outside it, exactly as the old
 * reparse path carried it. WeakMap: an element leaving the page takes its
 * latch with it, which is the one legitimate reset.
 */
const latched = new WeakMap<Element, number>();

/* ── the shared lazy `when` observer ──────────────────────────────────────── */
/**
 * `when` re-matches its selector when the element's OTHER attributes change
 * — a class toggle, typically — which the engine's filtered observer cannot
 * see. One shared observer, created at the first `when` element and
 * observing exactly those elements: a page without `when` never creates it,
 * and one with it pays for its own elements' mutations and nothing else.
 */
let whenObserver: MutationObserver | null = null;
const whenElements = new WeakMap<Element, Region>();

const observeWhen = (el: Element, region: Region): void => {
  whenElements.set(el, region);
  if (typeof MutationObserver !== 'function') return;
  whenObserver ??= new MutationObserver((records) => {
    const seen = new Set<Element>();
    for (const record of records) {
      const node = record.target as Element;
      if (seen.has(node)) continue;
      seen.add(node);
      whenElements.get(node)?.updateWhen(node);
    }
  });
  whenObserver.observe(el, { attributes: true });
};

/* ── the directives ───────────────────────────────────────────────────────── */

const motionDirective: Directive = {
  name: 'motion',
  /**
   * LITERAL, deliberately: the raw text arrives untouched and this pack
   * parses it with the BASE grammar — a preset name or a braced object —
   * so `data-vd-motion="fade-up"` means the same thing whether or not the
   * expressions tier is wired.
   */
  value: 'literal',
  priority: 45,
  docs: {
    summary: 'Scroll-driven (or selector-driven) animation: a preset name, or an object of properties and settings.',
    example: 'data-vd-motion="{ opacity: \'0% 0, 100% 1\', translate-y: \'0% 40px, 100% 0px\', inertia: 0.2 }"',
  },
  setup(el, ctx) {
    const raw = el.getAttribute(MOTION_ATTR) ?? '';
    const rejectFor = (reason: string): void => ctx.reject('motion-refused', reason);
    const region = regionFor(el, (code, message) => ctx.reject(code, message));

    forgetStagger();
    const parsed: ParsedElement | null = parseMotion(el, raw, region.parseContext);
    /** Parse-time reasons flow to the engine's registry — dropped elements' too. */
    if (parsed) for (const reason of parsed.rejected) rejectFor(reason);
    else {
      for (const entry of region.parseContext.dropped) {
        if (entry.node === el) for (const reason of entry.rejected) rejectFor(reason);
      }
      return;
    }

    const element = region.add(parsed, rejectFor);
    if (!element) return;

    /** The latch travels — see `latched`. */
    const was = latched.get(el);
    if (was !== undefined && element.runOnce) {
      element.runOnceRan = true;
      element.timelinePosition = was;
    }

    if (element.when) observeWhen(el, region);

    /** A member joining shifts its group's indices; refresh is a curve refill. */
    const group = staggerHost(el);
    if (group) region.refreshGroup(group);

    return () => {
      if (element.runOnceRan) latched.set(el, element.timelinePosition);
      whenElements.delete(el);
      region.remove(el);
      const host = staggerHost(el);
      if (host) region.refreshGroup(host);
    };
  },
};

const configDirective: Directive = {
  name: 'motion-config',
  value: 'literal',
  priority: 20,
  docs: {
    summary: 'Configures a motion REGION for this container\'s descendants: axis, scroller, defaults.',
    example: 'data-vd-motion-config="{ axis: \'horizontal\', scroller: \'#pane\', inertia: 0 }"',
  },
  setup(el) {
    /**
     * Regions are member-driven — the first descendant to activate creates
     * it, parsing this attribute through the shared cache — so setup here
     * only owns the teardown: the container leaving destroys its region.
     * (Members are descendants; the same removal tears them down first.)
     * LIVE EDITS of this attribute rebuild this instance and destroy the
     * region; members re-attach on their own next rebuild — the edge-case
     * ledger carries the honest limitation.
     */
    return () => {
      const region = regions.get(el);
      if (region) {
        regions.delete(el);
        region.destroy();
      }
    };
  },
};

/* ── the pack ─────────────────────────────────────────────────────────────── */

const connect = (options?: MotionOptions): EngineConnector => (seams) => {
  /** Page problems land in the engine's registry like every other refusal. */
  setProblemReporter((code, message) => seams.reject(null, 'motion', code, message));
  resolveOptions(options ?? {});
  seams.directive(motionDirective);
  seams.directive(configDirective);
};

/**
 * `wireDirectives([motion])` — defaults; `wireDirectives([motion({ … })])` —
 * configured. The engine calls what it is handed with the sigiled seams
 * object; an author calls it with options. Ten lines, no engine import.
 */
export const motion: ((options?: MotionOptions) => EngineConnector) & EngineConnector = ((arg?: unknown) =>
  arg && (arg as { _$seams$?: true })._$seams$ === true
    ? connect()(arg as EngineSeams)
    : connect(arg as MotionOptions | undefined)) as ((options?: MotionOptions) => EngineConnector) & EngineConnector;

/**
 * A vocabulary module's registrar, for add-on packs written outside this
 * file: `wireDirectives([motion, paint])` — each module is a connector whose
 * body registers its rows. Exported so third parties write the same shape.
 */
export const vocabularyConnector = (rows: WirableTree): EngineConnector => (seams) => {
  setProblemReporter((code, message) => seams.reject(null, 'motion', code, message));
  registerVocabulary(rows);
};

export { enableMotion, disableMotion, runInserts };
export { MOTION_ATTR } from './parse.js';
export type { MotionEventDetail } from './events.js';
export { EVENTS } from './events.js';
/** The GUI surface: the live vocabulary, and the validator controls share with the runtime. */
export { properties, vocabulary as settings, parseMeasure };
export type { ParsedElement } from './parse.js';
