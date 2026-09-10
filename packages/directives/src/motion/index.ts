/**
 * The MOTION PACK — `data-vd-motion` and `data-vd-motion-region`, riding the
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
 * input — `data-vd-motion-region` may set an axis or an inertia, never widen
 * an allowlist.
 */
import { dual } from '../dual.js';
import { parseMotion, forgetStagger, staggerHost, MOTION_ATTR } from './parse.js';

import {
  createRegion, enableMotion, disableMotion, configurePreferences, runInserts,
} from './region.js';
import type { RegionOptions } from './region.js';
import {
  registerVocabulary, setProblemReporter, parseEasing, parseSelector, parseOrigin,
  properties, settings as vocabulary, parseMeasure, pageProblem,
} from './schema.js';
import { parseValue, isObject } from '../parse.js';
import type { Parsed, ParsedObject } from '../parse.js';
import type { Ctx, Directive, EngineConnector } from '../types.js';
import { paintRows } from './paint.js';

import { pathRows } from './path.js';

import { sequenceRows, sequenceModule } from './sequence.js';

import { wireTicks } from './ticks.js';

import type { SequenceOptions } from './sequence.js';
import { splitDirective } from './split.js';


const CONFIG_ATTR = 'data-vd-motion-region';


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
  disableOnTouch?: boolean;
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
  disableOnTouch: false,
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
      pageProblem('motion-breakpoint-unusable', [JSON.stringify(name)]);
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
    if (fn !== undefined) pageProblem('motion-onprogress-not-fn');
    return undefined;
  }
  let live = true;
  return (node, progress) => {
    if (!live) return;
    try {
      fn(node, progress);
    } catch (error) {
      live = false;
      pageProblem('motion-onprogress-threw');
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
      pageProblem('motion-unknown-option', [key]);
    }
  }
  /** Boolean options that are not booleans invert accessibility switches silently. */
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (typeof fallback !== 'boolean') continue;
    const given = (options as Record<string, unknown>)[key];
    if (given === undefined || typeof given === 'boolean') continue;
    pageProblem('motion-option-not-boolean', [key, JSON.stringify(given)]);
    (merged as unknown as Record<string, unknown>)[key] = fallback;
  }
  /** The same checks the object keys of the same names get. */
  for (const name of ['ease', 'inertiaEase'] as const) {
    if (parseEasing(String(merged[name])) === null) {
      pageProblem('motion-option-unusable', [name, JSON.stringify(merged[name]), String(DEFAULTS[name])]);
      (merged as unknown as Record<string, unknown>)[name] = DEFAULTS[name];
    }
  }
  if (!Number.isFinite(merged.inertia) || merged.inertia < 0 || merged.inertia > 3600) {
    pageProblem('motion-option-unusable', ['inertia', String(merged.inertia), String(DEFAULTS.inertia)]);
    merged.inertia = DEFAULTS.inertia;
  }
  if (merged.transformOrigin && parseOrigin(merged.transformOrigin) === null) {
    pageProblem('motion-option-unusable', ['transformOrigin', JSON.stringify(merged.transformOrigin), '']);
    merged.transformOrigin = '';
  }
  defaults = merged;
  breakpoints = usableBreakpoints(options.breakpoints ?? DEFAULTS.breakpoints);
  onProgress = guarded(options.onProgress);
  configurePreferences(merged.disableOnTouch);
};

/* ── regions ──────────────────────────────────────────────────────────────── */

/** Config-element → its region, created lazily by the first member to ask. */
const regions = new WeakMap<Element, Region>();
let pageRegion: Region | null = null;

const regionOptions = (config: Readonly<Record<string, unknown>>, reportKey: (key: string, code: string) => void): RegionOptions => {
  let axis: 'vertical' | 'horizontal' = 'vertical';
  const axisGiven = config['axis'];
  if (axisGiven !== undefined) {
    if (axisGiven === 'vertical' || axisGiven === 'horizontal') axis = axisGiven;
    else reportKey('axis', 'motion-region-axis');
  }
  let scrollElement: Window | HTMLElement = window;
  const scrollerGiven = config['scroller'];
  if (scrollerGiven !== undefined) {
    const selector = typeof scrollerGiven === 'string' ? parseSelector(scrollerGiven) : null;
    const found = selector ? document.querySelector(selector) : null;
    /** The node's own realm's class — a portaled or second-document scroller must qualify. */
    if (found && found.nodeType === 1 && 'offsetTop' in found) scrollElement = found as HTMLElement;
    else reportKey('scroller', 'motion-region-scroller');
  }
  const number = (key: 'inertia', fallback: number): number => {
    const given = config[key];
    if (given === undefined) return fallback;
    const n = Number(given);
    if (Number.isFinite(n) && n >= 0 && n <= 3600) return n;
    reportKey(key, 'motion-region-duration');
    return fallback;
  };
  const easing = (key: 'inertia-ease' | 'ease', fallback: string): string => {
    const given = config[key];
    if (given === undefined) return fallback;
    const valid = typeof given === 'string' ? parseEasing(given) : null;
    if (valid !== null) return valid;
    reportKey(key, 'motion-setting-easing');
    return fallback;
  };
  return {
    axis,
    scrollElement,
    inertia: number('inertia', defaults.inertia),
    inertiaEase: easing('inertia-ease', defaults.inertiaEase),
    ease: easing('ease', defaults.ease),
    translateZFix: typeof config['translate-z-fix'] === 'boolean' ? (config['translate-z-fix'] as boolean) : defaults.translateZFix,
    transformOrigin: defaults.transformOrigin,
    onProgress,
  };
};

/**
 * The region an element animates in: the nearest `data-vd-motion-region`
 * ancestor's, else the page's. Members create their region lazily, so
 * activation order between a config container and its descendants never
 * matters. The config text is parsed through the base grammar's cache, so
 * asking per member re-parses nothing.
 */
const regionFor = (el: Element, reject: (code: string, args?: readonly string[]) => void): Region => {
  const host = el.closest(`[${CONFIG_ATTR}]`);
  if (!host || host === el) {
    if (host === el) reject('motion-region-on-member');
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
      else reject('motion-region-not-object');
    } catch (error) {
      reject('motion-region-parse-failed', [String((error as Error).message ?? error)]);
    }
  }
  const region = createRegion(
    regionOptions(config, (key, code) => reject(code, [key])),
    breakpoints
  );
  regions.set(host, region);
  return region;
};

/**
 * Per-element reason dedup — the old rejections registry's Set-per-node
 * semantics, kept because a refusal returned from a per-frame `apply` (a
 * refused canvas, scrolling) would otherwise append to the engine's
 * registry once per changed value.
 */
const said = new WeakMap<Element, Set<string>>();
/**
 * **Codes, like every other pack.** This funnelled every motion refusal through one
 * `motion-refused` code carrying a composed sentence, which meant its words shipped to production
 * and neither a docs page nor Studio's inspector could address any of them individually. Each
 * refusal now names itself and its prose lives in `diagnostics.ts`.
 *
 * Deduplicated on the code AND its arguments, so a per-property refusal still reports once per
 * property rather than once per element — the same grain the composed sentence gave for free.
 */
const dedupedReject = (el: Element, ctx: Ctx) => (code: string, args: readonly string[] = []): void => {
  let seen = said.get(el);
  if (!seen) said.set(el, (seen = new Set()));
  const key = args.length ? `${code}\u0000${args.join('\u0000')}` : code;
  if (seen.has(key)) return;
  seen.add(key);
  ctx.reject(code, args);
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
    /**
     * A split container's motion value is the pieces' TEMPLATE, not its own
     * animation — the split directive (priority 40, before this) rewrites
     * the subtree and each piece activates with the filtered value. The
     * container still hosts `stagger` through the raw-attribute walk.
     */
    if (el.hasAttribute('data-vd-split')) return;
    const raw = el.getAttribute(MOTION_ATTR) ?? '';
    const rejectFor = dedupedReject(el, ctx);
    const region = regionFor(el, (code, args) => ctx.reject(code, args ?? []));

    forgetStagger();
    const parsed: ParsedElement | null = parseMotion(el, raw, region.parseContext);
    /** Parse-time reasons flow to the engine's registry — dropped elements' too. */
    if (parsed) for (const r of parsed.rejected) rejectFor(r.code, [r.where ?? '', ...r.args]);
    else {
      for (const entry of region.parseContext.dropped) {
        if (entry.node === el) for (const r of entry.rejected) rejectFor(r.code, [r.where ?? '', ...r.args]);
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

    /**
     * Properties that need more than a write path wire here — `path`
     * resolves its offset-path, `frame` owns its drawer teardown. The
     * engine's rebuild-on-edit is their staleness story.
     */
    const propertyTeardowns: Array<() => void> = [];
    for (const animation of parsed.animations) {
      const wire = animation.property.setup;
      if (!wire) continue;
      const out = wire(el as HTMLElement, parsed.settings, rejectFor);
      if (typeof out === 'function') propertyTeardowns.push(out);
    }

    /** A member joining shifts its group's indices; refresh is a curve refill. */
    const group = staggerHost(el);
    if (group) region.refreshGroup(group);

    return () => {
      if (element.runOnceRan) latched.set(el, element.timelinePosition);
      whenElements.delete(el);
      said.delete(el);
      for (const off of propertyTeardowns) off();
      region.remove(el);
      const host = staggerHost(el);
      if (host) region.refreshGroup(host);
    };
  },
};

const configDirective: Directive = {
  name: 'motion-region',
  value: 'literal',
  priority: 20,
  docs: {
    summary: 'Configures a motion REGION for this container\'s descendants: axis, scroller, defaults.',
    example: 'data-vd-motion-region="{ axis: \'horizontal\', scroller: \'#pane\', inertia: 0 }"',
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
  setProblemReporter((code, args) => seams.reject(null, 'motion', code, args));
  resolveOptions(options ?? {});
  seams.directive(motionDirective);
  seams.directive(configDirective);
};

/**
 * `wireDirectives([motion])` — defaults; `wireDirectives([motion({ … })])` —
 * configured. The engine calls what it is handed with the sigiled seams
 * object; an author calls it with options. Ten lines, no engine import.
 */
export const motion = dual<MotionOptions>(connect);

/**
 * A vocabulary module's registrar, for add-on packs written outside this
 * file: `wireDirectives([motion, paint])` — each module is a connector whose
 * body registers its rows. Exported so third parties write the same shape.
 */
export const motionExtension = (rows: WirableTree): EngineConnector => (seams) => {
  setProblemReporter((code, args) => seams.reject(null, 'motion', code, args));
  registerVocabulary(rows);
};

/**
 * The add-on vocabulary, each a connector: `wireDirectives([motion, paint,
 * easings, path, sequence({ allowedOrigins }), split])`. `sequence` is a
 * factory whose call is optional, the same dual `motion` is; `split` is a
 * DIRECTIVE — it rewrites DOM rather than adding keys.
 */
/** `easings` (the JS curve solver pack) is RETIRED with the inline write path: the browser is
 *  the easing solver on every path now, so `ease` simply works unwired. The name is in the
 *  removed-APIs pin so no doc resurrects it. */
/**
 * The preset pack, usable bare or called — the dual shape CLAUDE.md's wireable rule prescribes for
 * OPTIONAL options, and the same one `motion` and `sequence` already take.
 *
 *   wireDirectives([motion, presets]);          // the shipped ten
 *   wireDirectives([motion, presets(house)]);   // yours, merged over ours
 *
 * One name rather than two, deliberately: a separate factory would have put `presets` and something
 * near-identically named side by side in the same array, one a module and one a call, which is a
 * reader's problem for no gain.
 *
 * Declared here rather than in `presets.ts` to keep that module free of an import cycle — building
 * the connector beside the table read `motionExtension` before initialisation and took the bundle
 * down at import time.
 */
let presetsWired = false;
export const presets = dual<PresetTable>((table) => {
  const connect = motionExtension({ on: 'preset', fn: table ? lookUpMerged(table) : lookUpPreset });
  return (seams) => {
    /**
     * **Wiring this twice is redundant AND silently wrong**, which is why it is refused rather than
     * tolerated. `presets(house)` already includes the shipped ten, so `[motion, presets,
     * presets(house)]` adds nothing — and worse, the chain answers from the FIRST resolver, so every
     * override in `house` quietly does not apply. The author sees their preset ignored with no
     * refusal anywhere, which is the exact failure shape this package keeps paying for.
     *
     * Reported rather than thrown, and the second registration still happens: it is harmless where
     * the names do not collide, and a page that animates slightly wrong beats a page that does not
     * load. The line says which call to keep.
     */
    if (presetsWired) pageProblem('motion-presets-wired-twice');
    presetsWired = true;
    return connect(seams);
  };
});
import { lookUpPreset, lookUpMerged } from './presets.js';
import type { ParsedElement, PresetTable, Range, Region, WirableTree } from './types.js';

export { PRESETS } from './presets.js';
export const paint: EngineConnector = motionExtension(paintRows);
export const path: EngineConnector = motionExtension(pathRows);
/**
 * Sequence wires TWO things from one options object: its settings rows into the vocabulary, and
 * its drawer into the tick registry under the name the attribute uses — `tick: 'sequence'`. A
 * page's own `wireTicks({ sequence })` earlier would win the name and be reported, per the
 * registry's first-wins rule.
 */
export const sequence = dual<SequenceOptions>((options) => {
  const { rows, tick } = sequenceModule(options);
  const connect = motionExtension(rows);
  return (seams) => {
    wireTicks({ sequence: tick });
    return connect(seams);
  };
});
export const split = splitDirective;
/**
 * The write-path registry — INTERNAL until the rewrite's stage 4 wires activation through it.
 * Exported now so the browser suite can prove delivery, dedup and eviction against real engines
 * without a public surface committing to anything; not documented, not API, and its shape may
 * change with any stage.
 */
/**
 * The named-JS door — see `ticks.ts`. Public API: `wireTicks({ drawFrame: (el, p) => … })`
 * registers what `tick: 'drawFrame'` names. The escape hatch, not the road.
 */
export { wireTicks } from './ticks.js';
/**
 * SSR emission — stage 7: mark in-scope elements and emit their generated CSS so a
 * server-rendered page paints frame 0 with no JavaScript. Runs under any DOM (the vera SSR shim,
 * jsdom); pass the SAME wire array the page uses so presets and packs resolve identically.
 */
export { renderMotion } from './ssr.js';
export * as keyframeRegistry from './registry.js';
export * as writePath from './generate.js';
/** Row tables for the vocabulary ARTIFACT generator only — data, not API; the connectors above are
 *  the way packs are wired. Exported so `sync-diagnostics.mjs` reads rows from the BUILT bundle,
 *  where Node's source-loader cannot follow the packs' runtime imports. */
export { paintRows, pathRows, sequenceRows };
export { parsePathData } from './path.js';

export { enableMotion, disableMotion, runInserts };
export { MOTION_ATTR } from './parse.js';
export { EVENTS } from './events.js';
/** The GUI surface: the live vocabulary, and the validator controls share with the runtime. */
export { properties, vocabulary as settings, parseMeasure };
