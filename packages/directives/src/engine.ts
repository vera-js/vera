/**
 * The @verajs/directives engine: registry, churn-first activation, per-key context resolution,
 * delegated events, the rejections registry, `settled()`, and the shared base/cloak sheet.
 *
 * The reactive half is core's own: each reflection instance is ONE `createHook` whose owner is a
 * plain object — reads through context stores inside the callback subscribe automatically, writes
 * re-run it on core's scheduler (no second timing model), and bumping the owner's `_gen` is the
 * core-sanctioned kill switch that makes a torn-down instance permanently inert. The engine
 * invents no reactivity.
 *
 * Events are REGISTRY-DECLARATIVE: no per-element listeners, no per-element instances — one root
 * listener per event type, matching by attribute at dispatch time (which is why a swapped-in
 * region's buttons work the instant the HTML lands). See DESIGN-DIRECTIVES §3/§6.
 */
import { createHook as bakedCreateHook, createStore as bakedCreateStore, inserts as bakedInserts } from '@verajs/core';
import { parseValue, parseLiteral, isPath, isObject } from './parse.js';
import type { ValueError } from './parse.js';
import type { Parsed, ParsedObject, Path } from './parse.js';
import type { Ctx, Directive, Rejection } from './types.js';

/* ── substrate adoption (design §16b) ─────────────────────────────────────────────────────── */

/**
 * The engine never hard-binds to the copy of core it was bundled with. Core's `wire` stamps
 * `Symbol.for('vera.core')` with the copy the app actually uses — only a wired core can stamp,
 * so a baked copy inside this bundle can never impersonate it — and resolution here is LAZY and
 * SNAPSHOTS once, at the first store or hook this engine creates. On a vera page that means the
 * stamped core wins and components and directives share one store registry; on a page with no
 * vera at all nothing ever stamps, and the baked copy serves. A stamp missing either function is
 * not core's stamp and is ignored (with a dev note), which is also the forward seam for a
 * version gate when the release tooling can bake a compatible range in.
 */
type LoaderFn = (name: string, element: Element) => boolean | Promise<unknown> | void;
type Substrate = {
  createStore: typeof bakedCreateStore;
  createHook: typeof bakedCreateHook;
  /** The PAGE's insert registry, when adopted — where the `'loader'` chain lives. */
  inserts?: Map<string, unknown[]>;
};
let substrate: Substrate | null = null;
const core = (): Substrate => {
  if (substrate) return substrate;
  const stamp = (globalThis as Record<symbol, unknown>)[Symbol.for('vera.core')] as Substrate | undefined;
  if (stamp && typeof stamp.createStore === 'function' && typeof stamp.createHook === 'function') return (substrate = stamp);
  if (__DEV__ && stamp) console.warn('[vera] the vera.core stamp is not a usable substrate — the engine is using its own copy.');
  return (substrate = { createStore: bakedCreateStore, createHook: bakedCreateHook, inserts: bakedInserts as unknown as Map<string, unknown[]> });
};

/* ── discovery: the 'loader' seam (design §7) ─────────────────────────────────────────────── */

/**
 * An unknown `data-vd-*` name is a QUESTION before it is a refusal: the engine asks the page's
 * `'loader'` chain (autoloader's `directiveLoader`, by convention `{base}/{name}.js`), and a
 * claimed module registers itself through `wireDirectives` — module caching guarantees the same
 * registry, the exact symmetry of an autoloaded component calling `customElements.define`.
 * Elements that asked are QUEUED per name and activated when the claim settles; only final
 * outcomes are recorded, because the registry is append-only and "loading…" would be a stale
 * entry the moment it stopped being true.
 *
 * `undiscoverable` memoizes the refusals (declined, failed, or loaded-nothing) so a page of a
 * hundred unknown badges asks once — the same one-attempt-per-page-load posture the autoloader
 * takes with URLs.
 */
const loadingNames = new Map<string, Array<{ el: Element; attr: string }>>();
const undiscoverable = new Set<string>();

const loaderChain = (): LoaderFn[] =>
  ((core().inserts?.get('loader') as LoaderFn[] | undefined) ?? []);

const discover = (el: Element, attr: string, suffix: string): void => {
  if (undiscoverable.has(suffix)) {
    reject(el, attr, 'unknown-directive', `nothing wired provides "${suffix}".`, 'Wire its pack, or check the name.');
    return;
  }
  const queued = loadingNames.get(suffix);
  if (queued) {
    queued.push({ el, attr });
    return;
  }

  /** First claimer wins; a link that throws declines (a broken loader costs its answer, not the page). */
  let claim: Promise<unknown> | true | null = null;
  for (const fn of loaderChain()) {
    let answer: ReturnType<LoaderFn>;
    try {
      answer = fn(suffix, el);
    } catch {
      continue;
    }
    if (answer === true) claim = true;
    else if (answer && typeof (answer as Promise<unknown>).then === 'function') claim = answer as Promise<unknown>;
    if (claim) break;
  }

  if (!claim) {
    undiscoverable.add(suffix);
    reject(el, attr, 'unknown-directive', `nothing wired provides "${suffix}".`,
      loaderChain().length ? 'The loader declined it — check the name, or its alias map.' : 'Wire its pack, or check the name.');
    return;
  }

  const waiting: Array<{ el: Element; attr: string }> = [{ el, attr }];
  loadingNames.set(suffix, waiting);
  Promise.resolve(claim).then(
    () => {
      loadingNames.delete(suffix);
      const hit = directiveFor(suffix);
      if (!hit) {
        undiscoverable.add(suffix);
        for (const entry of waiting) {
          reject(entry.el, entry.attr, 'loader-loaded-nothing',
            `a module loaded for "${suffix}" but registered nothing by that name.`,
            'The module must call wireDirectives with a matching directive.');
        }
        return;
      }
      for (const entry of waiting) {
        if (!entry.el.isConnected) continue;
        applyHit(entry.el, entry.attr, hit, entry.el.getRootNode());
      }
    },
    (error) => {
      loadingNames.delete(suffix);
      undiscoverable.add(suffix);
      for (const entry of waiting) {
        reject(entry.el, entry.attr, 'loader-failed',
          `the loader claimed "${suffix}" but the import failed: ${String((error as Error)?.message ?? error)}`);
      }
    }
  );
};

const PREFIX = 'data-vd-';
const CLOAK = 'data-vd-cloak';

/* ── registry ─────────────────────────────────────────────────────────────────────────────── */

const byName = new Map<string, Directive>();
const families: Array<{ match: (suffix: string) => unknown | null; directive: Directive }> = [];
/** Every exact name the registry knows — the observer's attributeFilter is built from this. */
let knownAttrs: string[] = [];
let attrsDirty = true;

const VALUE_CLASSES = new Set(['literal', 'expression', 'object', 'none']);

/**
 * A CONNECTOR — the same second shape core's `wire` accepts. The expressions tier (and any future
 * first-party tier) ships as a standalone additive bundle that imports nothing from the engine;
 * wiring hands it the seams instead, so the CDN two-bundle case cannot create a second engine
 * (the renderer's additive-entry rule, applied here).
 */
export type EngineSeams = {
  /** The mark `pack()` duals dispatch on. Sigiled, so it survives mangling across bundles. */
  _$seams$: true;
  /** Replace the attribute-value parser (a superset grammar keeps ParsedObject's shape). */
  setParse: (parse: (source: string) => Parsed) => void;
  /** Evaluate hook for values the base grammar does not know — `{ kind: 'expr' }` nodes. */
  setEvalExpr: (evalExpr: (node: unknown, read: (segments: string[], global: boolean) => unknown, el: Element) => unknown) => void;
  /** Register a directive — what lets a connector CONTRIBUTE behaviors, not only replace seams. */
  directive: (d: Directive) => void;
  /** The engine's rejections registry, so an additive pack's diagnostics land where every
   *  other refusal does. `element: null` is a page-level problem. */
  reject: (element: Element | null, directive: string, code: string, message: string, fix?: string) => void;
};

export type EngineConnector = (seams: EngineSeams) => void;

const register = (d: Directive): void => {
  if (__DEV__) {
    if (!d || (typeof d.name !== 'string' && typeof (d.name as { match?: unknown })?.match !== 'function'))
      throw new Error('wireDirectives: a directive needs a `name` string or a { match } family.');
    if (!VALUE_CLASSES.has(d.value))
      throw new Error(`wireDirectives: \`value\` must be literal | expression | object | none — got ${String(d.value)}.`);
  }
  if (typeof d.name === 'string') byName.set(d.name, d);
  else families.push({ match: d.name.match, directive: d });
  attrsDirty = true;
};

const seams = (): EngineSeams => ({
  _$seams$: true,
  setParse: (parse) => {
    parseAttr = parse;
  },
  setEvalExpr: (evalExpr) => {
    tierEval = evalExpr;
  },
  directive: register,
  reject,
});

/**
 * Wraps a configurable pack so BOTH spellings work: `wireDirectives([motion])` uses the
 * defaults, `wireDirectives([motion({ inertia: 0.2 })])` configures — the function-and-
 * descriptor allowance core's own modules make, expressed for connectors. The dual dispatches
 * on the seams mark: called by the engine it builds with defaults and connects; called by the
 * author it closes over the options and returns the connector.
 */
export const pack = <O>(build: (options?: O) => EngineConnector): ((options?: O) => EngineConnector) & EngineConnector => {
  const dual = (arg?: unknown) =>
    arg && (arg as { _$seams$?: true })._$seams$ === true
      ? build()(arg as EngineSeams)
      : build(arg as O | undefined);
  return dual as ((options?: O) => EngineConnector) & EngineConnector;
};

export const wireDirectives = (item: Directive | EngineConnector | Array<Directive | EngineConnector>) => {
  for (const d of Array.isArray(item) ? item : [item]) {
    if (typeof d === 'function') {
      d(seams());
      continue;
    }
    register(d);
  }
  boot();
};

export const describeDirectives = () =>
  [...byName.values()].map((d) => ({
    name: d.name as string,
    value: d.value,
    ...(d.docs ?? {}),
  }));

/* ── rejections ───────────────────────────────────────────────────────────────────────────── */

const allRejections: Rejection[] = [];
const byElement = new WeakMap<Element, Rejection[]>();
const warned = new Set<string>();

export const reject = (element: Element | null, directive: string, code: string, message: string, fix?: string) => {
  /** Prod keeps the DATA (code, element, directive); the prose is a development feature — the
   *  strings are real bytes on every page, and the code is what tooling matches on anyway. */
  const entry: Rejection = { element, directive, code, message: __DEV__ ? message : '', fix: __DEV__ ? fix : undefined };
  allRejections.push(entry);
  if (element) {
    let list = byElement.get(element);
    if (!list) byElement.set(element, (list = []));
    list.push(entry);
  }
  if (__DEV__) {
    /** Once per (code × directive) — the registry keeps every instance, the console keeps signal. */
    const key = `${code}:${directive}`;
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[vera] directives: ${directive} — ${message}${fix ? ` ${fix}` : ''} (${code})`);
    }
  }
};

export const rejections = (element?: Element): readonly Rejection[] =>
  element ? (byElement.get(element) ?? []) : allRejections;

/* ── context ──────────────────────────────────────────────────────────────────────────────── */

/** Subtree state carriers: the element that declared `data-vd-state` → its store. */
const carriers = new WeakMap<Element, Record<string, unknown>>();
/** The page-global store, lazily created — `@key` addresses it. */
let pageStore: Record<string, unknown> | null = null;
const page = () => (pageStore ??= core().createStore({} as Record<string, unknown>));

/**
 * PER-KEY OWNER RESOLUTION (design §4): a read of `open` walks to the nearest carrier that OWNS
 * `open`. The flat-tree walk crosses shadow boundaries host-ward, like composed events.
 */
const flatParent = (el: Element): Element | null => {
  const p = el.parentElement;
  if (p) return p;
  const root = el.getRootNode() as ShadowRoot | Document;
  return (root as ShadowRoot).host ?? null;
};

const ownerOf = (el: Element, key: string): Record<string, unknown> | null => {
  for (let n: Element | null = el; n !== null; n = flatParent(n)) {
    const store = carriers.get(n);
    if (store && key in store) return store;
  }
  return null;
};

const nearestCarrier = (el: Element): Record<string, unknown> | null => {
  for (let n: Element | null = el; n !== null; n = flatParent(n)) {
    const store = carriers.get(n);
    if (store) return store;
  }
  return null;
};

const readPath = (el: Element, path: Path): unknown => {
  const [head, ...rest] = path.segments;
  let value: unknown;
  if (path.global) {
    value = page()[head];
  } else {
    const owner = ownerOf(el, head);
    if (!owner) {
      if (__DEV__) reject(el, 'context', 'unknown-key', `no ancestor state declares "${head}".`, 'Reads answer undefined.');
      value = undefined;
    } else value = owner[head];
  }
  /** Dotted tails walk OWN properties only — the same rule as everywhere else in vera. */
  for (const seg of rest) {
    if (value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, seg))
      value = (value as Record<string, unknown>)[seg];
    else value = undefined;
  }
  return path.negate ? !value : value;
};

const writeKey = (el: Element, key: string, value: unknown) => {
  if (key.startsWith('@')) {
    (page() as Record<string, unknown>)[key.slice(1)] = value;
    return;
  }
  const owner = ownerOf(el, key) ?? nearestCarrier(el);
  if (!owner) {
    reject(el, 'context', 'no-carrier', `a write to "${key}" found no data-vd-state ancestor.`, 'Add one, or use an @page key.');
    return;
  }
  if (__DEV__ && !(key in owner))
    reject(el, 'context', 'undeclared-write', `"${key}" was not declared by the state it landed in.`, 'Declare it in data-vd-state.');
  owner[key] = value;
};

/** The attribute-value parser — the expressions tier replaces it with the superset grammar. */
let parseAttr: (source: string) => Parsed = parseValue;
/** The tier's evaluator for `{ kind: 'expr' }` nodes; null until the tier is wired. */
let tierEval: ((node: unknown, read: (segments: string[], global: boolean) => unknown, el: Element) => unknown) | null = null;

/**
 * Read for the tier: head resolves by owner, tails walk own properties — one rule, both tiers.
 * The OVERLAY serves exactly one caller: `state` initials evaluate in declaration order against
 * ancestors PLUS the keys already built, before any carrier exists (design §20.6).
 */
const readSegments = (el: Element, overlay?: Record<string, unknown>) => (segments: string[], global: boolean): unknown => {
  if (!global && overlay && Object.prototype.hasOwnProperty.call(overlay, segments[0])) {
    let v: unknown = overlay[segments[0]];
    for (const seg of segments.slice(1)) {
      if (v !== null && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, seg)) v = (v as Record<string, unknown>)[seg];
      else return undefined;
    }
    return v;
  }
  return readPath(el, { kind: 'path', negate: false, global, segments });
};

/** Evaluate a parsed value against an element's context (overlay: see `readSegments`). */
const evaluate = (el: Element, v: Parsed, overlay?: Record<string, unknown>): unknown => {
  if (isPath(v)) {
    if (overlay && !v.global && Object.prototype.hasOwnProperty.call(overlay, v.segments[0])) {
      const got = readSegments(el, overlay)(v.segments, false);
      return v.negate ? !got : got;
    }
    return readPath(el, v);
  }
  if (v !== null && typeof v === 'object' && (v as { kind?: string }).kind === 'expr')
    return tierEval ? tierEval(v, readSegments(el, overlay), el) : undefined;
  return v;
};

/** Run an assignments object: `{ key: value, ... }` — every write goes through the store. */
const runAssignments = (el: Element, obj: ParsedObject) => {
  for (const key of Object.keys(obj)) writeKey(el, key, evaluate(el, obj[key]));
};

export const stateOf = (el: Element): Readonly<Record<string, unknown>> | null => nearestCarrier(el);

/** For the pack's SPECIAL event members: parse an attribute's object and run it as assignments. */
export const runAttrAssignments = (el: Element, attr: string): void => {
  const raw = el.getAttribute(attr);
  if (raw === null) return;
  try {
    const parsed = parseAttr(raw);
    if (isObject(parsed)) runAssignments(el, parsed);
    else reject(el, attr, 'handler-not-object', 'an on-* value is a braced assignments object.');
  } catch (error) {
    reject(el, attr, (error as ValueError).code ?? 'value-bad', `could not parse "${raw}"`);
  }
};

/* ── instances (the reactive half) ────────────────────────────────────────────────────────── */

type Instance = {
  _directive: Directive;
  _attr: string;
  /** Bumping `_gen` makes the createHook permanently inert — core's own stale-guard as teardown. */
  _owner: { _gen?: number };
  _teardown?: () => void;
  _cleanup?: () => void;
};

const instances = new WeakMap<Element, Map<string, Instance>>();
/** Directive-apply hooks run after computeds (10), in the layout-effect band. */
const APPLY_PRIORITY = 30;

const ctxFor = (el: Element, attr: string, selection: unknown): Ctx => ({
  get: (key) => readPath(el, { kind: 'path', negate: false, global: key.startsWith('@'), segments: (key.startsWith('@') ? key.slice(1) : key).split('.') }),
  set: (key, value) => writeKey(el, key, value),
  run: (obj) => runAssignments(el, obj as ParsedObject),
  runAttr: (name) => runAttrAssignments(el, name),
  eval: (v) => evaluate(el, v as Parsed),
  selection,
  reject: (code, message, fix) => reject(el, attr, code, message, fix),
});

const activateDirective = (el: Element, attr: string, directive: Directive, selection: unknown) => {
  const map = instances.get(el) ?? new Map<string, Instance>();
  instances.set(el, map);
  if (map.has(attr)) return; // already live — attribute changes come through deactivate first
  const raw = el.getAttribute(attr);
  let parsed: Parsed = null;
  if (directive.value === 'literal') {
    /**
     * LITERAL means literal, in BOTH tiers: it never goes through `parseAttr` at all, so a bare
     * word is a string and no tier can turn it into something that resolves — `sync="draft"`
     * names the key "draft", it does not read it. (Found when the expressions tier compiled the
     * key to a thunk and persist restored under the key's VALUE.)
     */
    parsed = parseLiteral(raw ?? '');
  } else if (directive.value !== 'none') {
    try {
      parsed = parseAttr(raw ?? '');
    } catch (error) {
      const ve = error as ValueError;
      reject(el, attr, ve.code ?? 'value-bad', `could not parse "${raw}": ${ve.message}`);
      return;
    }
  }
  const instance: Instance = { _directive: directive, _attr: attr, _owner: {} };
  map.set(attr, instance);
  const ctx = ctxFor(el, attr, selection);
  try {
    /** An apply returned from setup closes over setup's locals — per-instance state is ordinary
     *  closure variables (design §19.1), captured HERE so the shared descriptor is never touched. */
    let apply = directive.apply;
    if (directive.setup) {
      const out = directive.setup(el, ctx);
      if (typeof out === 'function') instance._teardown = out;
      else if (out && typeof out === 'object') {
        instance._teardown = out.teardown;
        if (out.apply) apply = out.apply;
      }
    }
    if (apply) {
      const run = core().createHook({
        element: instance._owner as unknown as HTMLElement,
        priority: APPLY_PRIORITY,
        callback: () => {
          try {
            instance._cleanup?.();
            const out = apply(el, directive.value === 'none' ? undefined : evaluate(el, parsed), ctx);
            instance._cleanup = typeof out === 'function' ? out : undefined;
          } catch (error) {
            /** QUARANTINE: this instance only — sibling directives on the element keep working. */
            reject(el, attr, 'directive-threw', String((error as Error)?.message ?? error));
            deactivateDirective(el, attr);
          }
        },
      });
      run?.(undefined, true);
    }
  } catch (error) {
    reject(el, attr, 'directive-threw', String((error as Error)?.message ?? error));
    deactivateDirective(el, attr);
  }
};

const deactivateDirective = (el: Element, attr: string) => {
  const map = instances.get(el);
  const instance = map?.get(attr);
  if (!instance || !map) return;
  map.delete(attr);
  instance._owner._gen = (instance._owner._gen ?? 0) + 1; // the kill switch
  try {
    instance._cleanup?.();
    instance._teardown?.();
  } catch (error) {
    reject(el, attr, 'teardown-threw', String((error as Error)?.message ?? error));
  }
};

/* ── the built-in `state` carrier (priority 10, before anything reads it) ─────────────────── */

export const stateDirective: Directive = {
  name: 'state',
  value: 'object',
  priority: 10,
  docs: { summary: 'Declares a state store for this subtree.', example: 'data-vd-state="{ open: false }"' },
  setup(el, ctx) {
    const raw = el.getAttribute(PREFIX + 'state') ?? '';
    let parsed: Parsed;
    try {
      parsed = parseAttr(raw);
    } catch (error) {
      ctx.reject((error as ValueError).code ?? 'value-bad', `could not parse "${raw}"`);
      return;
    }
    if (!isObject(parsed)) {
      ctx.reject('state-not-object', 'data-vd-state takes a braced object.', 'Write data-vd-state="{ open: false }".');
      return;
    }
    if (carriers.has(el)) {
      /** The declaration was the SEED; live state is data (design §16). */
      ctx.reject('state-reseed-ignored', 'the state declaration changed after activation; live state kept.');
      return;
    }
    const initial: Record<string, unknown> = {};
    /** Initials evaluate IN DECLARATION ORDER against ancestors + earlier keys (design §20.6) —
     *  the overlay IS the object being built, so `total: price * qty` sees its siblings. */
    for (const key of Object.keys(parsed)) {
      if (key.startsWith('_vd')) {
        ctx.reject('state-reserved-key', `"${key}" is reserved.`);
        continue;
      }
      initial[key] = evaluate(el, parsed[key], initial);
    }
    carriers.set(el, core().createStore(initial));
    return () => carriers.delete(el);
  },
};

/**
 * `state` is ENGINE-OWNED, registered here rather than shipped in a pack: the per-key owner walk,
 * the carriers map, `stateOf` — the engine's whole context layer only functions when something
 * can declare a carrier, so a page wiring nothing but custom directives still gets
 * `data-vd-state`. This is also what lets the packs import nothing from the engine.
 */
byName.set('state', stateDirective);

/* ── delegated events ─────────────────────────────────────────────────────────────────────── */

/** Which event types have a root listener, per root. */
const listening = new WeakMap<Node, Set<string>>();
/** Event types any wired on-* family member has requested (grown by activation scans). */
const wantedTypes = new Set<string>();

const KEYED = new Set(['keydown', 'keyup']);
const keySuffix = (key: string) =>
  key === ' ' ? 'space' : key.length === 1 ? key.toLowerCase() : key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

const dispatch = (root: Node, event: Event) => {
  const type = event.type;
  const path = event.composedPath();
  for (const node of path) {
    if (!(node as Element).getAttribute) continue;
    const el = node as Element;
    /** Guarded operand first — `on-keydown-enter` beats a bare `on-keydown` (design §6). */
    let raw: string | null = null;
    let attr = '';
    if (KEYED.has(type)) {
      attr = `${PREFIX}on-${type}-${keySuffix((event as KeyboardEvent).key ?? '')}`;
      raw = el.getAttribute(attr);
    }
    if (raw === null) {
      attr = `${PREFIX}on-${type}`;
      raw = el.getAttribute(attr);
    }
    if (raw === null) continue;
    if (node !== root && (root as ParentNode).contains && !(root as ParentNode).contains(el)) continue;
    try {
      const parsed = parseAttr(raw);
      if (isObject(parsed)) runAssignments(el, parsed);
      else reject(el, attr, 'handler-not-object', 'an on-* value is a braced assignments object.');
    } catch (error) {
      reject(el, attr, (error as ValueError).code ?? 'value-bad', `could not parse "${raw}"`);
    }
  }
};

const listen = (root: Node, type: string) => {
  let set = listening.get(root);
  if (!set) listening.set(root, (set = new Set()));
  if (set.has(type)) return;
  set.add(type);
  root.addEventListener(type, (event) => dispatch(root, event));
};

/* ── activation ───────────────────────────────────────────────────────────────────────────── */

const roots = new Set<Node>();
const observers = new WeakMap<Node, MutationObserver>();
let sheet: CSSStyleSheet | null = null;

/**
 * The observer filters on EXACT registered names (`attributeFilter` cannot prefix-match — the
 * platform limit design §3 records). Family attributes (`on-*`) are unbounded and so unfilterable:
 * their VALUES re-parse at dispatch anyway, and the one blind spot — a never-seen event TYPE added
 * dynamically to an existing element — is the documented §3 limitation, closed by any structural
 * change. When the registry grows, every live root is RE-observed with the wider filter.
 */
const attributeFilter = (): string[] => {
  if (attrsDirty) {
    knownAttrs = [...byName.keys()].map((n) => PREFIX + n);
    attrsDirty = false;
    for (const root of roots) {
      const observer = observers.get(root);
      if (observer) {
        observer.disconnect();
        observe(observer, isDocument(root as Node) ? (root as Document).documentElement : (root as Node));
      }
    }
  }
  return knownAttrs;
};

const observe = (observer: MutationObserver, target: Node) => {
  observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: attributeFilter() });
};

const directiveFor = (suffix: string): { directive: Directive; selection: unknown } | null => {
  const exact = byName.get(suffix);
  if (exact) return { directive: exact, selection: null };
  for (const f of families) {
    const selection = f.match(suffix);
    if (selection !== null) return { directive: f.directive, selection };
  }
  return null;
};

/**
 * Applies one matched directive to one element — the shared tail of activation, split out so a
 * LATE match (a name the loader just fulfilled) takes exactly the path an eager one does.
 * Event members: a plain bubbling type is PURE DELEGATION — one root listener, zero per-element
 * cost (design §3E). A member marked `special` needs per-element wiring too, so it takes the
 * instance path and the directive's setup reads `ctx.selection`.
 */
const applyHit = (el: Element, attr: string, hit: { directive: Directive; selection: unknown }, root: Node): void => {
  const sel = hit.selection as { type?: string; special?: boolean } | null;
  if (sel?.type && !sel.special) {
    wantedTypes.add(sel.type);
    listen(root, sel.type);
    return;
  }
  activateDirective(el, attr, hit.directive, hit.selection);
};

const activateElement = (el: Element, root: Node) => {
  /** Collect first, then sort by priority — `state` (10) must exist before reflections read it. */
  const found: Array<{ attr: string; directive: Directive; selection: unknown }> = [];
  for (const { name } of el.attributes) {
    if (!name.startsWith(PREFIX)) continue;
    const suffix = name.slice(PREFIX.length);
    if (suffix === 'cloak') continue;
    const hit = directiveFor(suffix);
    if (!hit) {
      /** A question before a refusal — the loader seam. See `discover`. */
      discover(el, name, suffix);
      continue;
    }
    found.push({ attr: name, ...hit });
  }
  found.sort((a, b) => (a.directive.priority ?? 50) - (b.directive.priority ?? 50));
  for (const f of found) applyHit(el, f.attr, { directive: f.directive, selection: f.selection }, root);
  if (el.hasAttribute(CLOAK)) el.removeAttribute(CLOAK);
};

const deactivateElement = (el: Element) => {
  const map = instances.get(el);
  if (!map) return;
  for (const attr of [...map.keys()]) deactivateDirective(el, attr);
};

const walk = (node: Node, root: Node) => {
  if (node.nodeType !== 1) return;
  const el = node as Element;
  /** `<template>` content is inert by platform rule. */
  if (el.localName === 'template') return;
  activateElement(el, root);
  for (let child = el.firstElementChild; child; child = child.nextElementSibling) walk(child, root);
};

const unwalk = (node: Node) => {
  if (node.nodeType !== 1) return;
  deactivateElement(node as Element);
  for (let child = (node as Element).firstElementChild; child; child = child.nextElementSibling) unwalk(child);
};

const onMutations = (root: Node, records: MutationRecord[]) => {
  for (const record of records) {
    if (record.type === 'attributes') {
      const el = record.target as Element;
      const attr = record.attributeName!;
      /** Value change = rebuild: teardown the old parse's instance, activate the new. */
      deactivateDirective(el, attr);
      if (el.hasAttribute(attr)) {
        const hit = directiveFor(attr.slice(PREFIX.length));
        const sel = hit?.selection as { type?: string; special?: boolean } | null;
        if (hit && (!sel?.type || sel.special)) activateDirective(el, attr, hit.directive, hit.selection);
      }
      continue;
    }
    for (const node of record.removedNodes) unwalk(node);
    for (const node of record.addedNodes) walk(node, root);
  }
};

const BASE_CSS = `[hidden]{display:none!important}[${CLOAK}]{display:none!important}`;

/** Realm-safe: a Document is nodeType 9 — `instanceof Document` binds to ONE realm's global and
 *  is undefined in a bare harness, the exact trap the slots module documents for `Event`. */
const isDocument = (root: Node): root is Document => root.nodeType === 9;

const adopt = (root: Document | ShadowRoot) => {
  try {
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(BASE_CSS);
    }
    /** APPEND, never assign — coexists with @verajs/styles and any other adopter (design §20.2). */
    if (!root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  } catch {
    const doc = isDocument(root) ? root : root.ownerDocument!;
    const style = doc.createElement('style');
    style.textContent = BASE_CSS;
    (isDocument(root) ? root.head : root).appendChild(style);
  }
};

export const activate = (root: Document | ShadowRoot | Element) => {
  if (roots.has(root)) return;
  roots.add(root);
  adopt(root.nodeType === 1 ? ((root as Element).getRootNode() as Document | ShadowRoot) : (root as Document | ShadowRoot));
  const target: Node = isDocument(root as Node) ? (root as Document).documentElement : (root as Node);
  const observer = new MutationObserver((records) => onMutations(root, records));
  observe(observer, target);
  observers.set(root, observer);
  if (target.nodeType === 1) walk(target, root);
  else for (let c = (target as unknown as ParentNode).firstElementChild; c; c = c.nextElementSibling) walk(c, root);
};

export const deactivate = (root: Document | ShadowRoot | Element) => {
  if (!roots.delete(root)) return;
  observers.get(root)?.disconnect();
  observers.delete(root);
};

/* ── boot + settled ───────────────────────────────────────────────────────────────────────── */

let booted = false;
const boot = () => {
  if (booted) return;
  /** Never under the SSR shim — the server renders once and flattens (the slots precedent). */
  if (typeof document === 'undefined' || (globalThis as { __veraSsrShimmed?: boolean }).__veraSsrShimmed) return;
  booted = true;
  const go = () => activate(document);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
  else go();
};

/**
 * Resolves when activation and pending directive effects have flushed — the testing/e2e primitive
 * (design §20.8). Two scheduler turns mirrors the house `frame()` idiom.
 */
export const settled = (): Promise<void> =>
  new Promise((resolve) => {
    const turn = (n: number) => {
      if (n === 0) return resolve();
      const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => void }).requestAnimationFrame;
      if (raf) raf(() => setTimeout(() => turn(n - 1), 0));
      else setTimeout(() => turn(n - 1), 0);
    };
    turn(2);
  });

/** The core-connector: `wire([directives])` in core registers component roots — open OR closed. */
export const directives = {
  on: 'init' as const,
  priority: 40,
  fn: (element: HTMLElement) => {
    const root = (element as unknown as Record<string, ShadowRoot | null | undefined>)['_root'] ?? element.shadowRoot;
    if (root) activate(root);
  },
};
