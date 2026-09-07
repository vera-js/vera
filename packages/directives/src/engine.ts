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
import type { AnyDirective, Ctx, Directive, Rejection, EngineSeams, EngineConnector } from './types.js';

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

const byName = new Map<string, AnyDirective>();
const families: Array<{ match: (suffix: string) => unknown | null; directive: AnyDirective }> = [];
/** Every exact name the registry knows — the observer's attributeFilter is built from this. */
let knownAttrs: string[] = [];
let attrsDirty = true;

const VALUE_CLASSES = new Set(['literal', 'expression', 'object', 'none']);

/**
 * A CONNECTOR — the same second shape core's `wire` accepts. A pack ships as a standalone
 * additive bundle that imports nothing from the engine at RUNTIME; wiring hands it the seams
 * instead, so the CDN two-bundle case cannot create a second engine (the renderer's additive-entry
 * rule, applied here). The contract itself lives in `types.ts` and is imported as a TYPE, which is
 * erased — one declaration, no runtime edge, no four copies to keep in step.
 */
const register = (d: Directive): void => {
  /** Widened once, here: see `AnyDirective`. Every author-facing path above keeps the union. */
  const held = d as AnyDirective;
  if (__DEV__) {
    if (!d || (typeof d.name !== 'string' && typeof (d.name as { match?: unknown })?.match !== 'function'))
      throw new Error('wireDirectives: a directive needs a `name` string or a { match } family.');
    if (!VALUE_CLASSES.has(d.value))
      throw new Error(`wireDirectives: \`value\` must be literal | expression | object | none — got ${String(d.value)}.`);
  }
  if (typeof d.name === 'string') byName.set(d.name, held);
  else families.push({ match: d.name.match, directive: held });
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

/**
 * The live vocabulary — what a GUI panel, `llms.txt` and an agent all read instead of a
 * hand-written list.
 *
 * **Families are included**, and were not: `on-*` and `bind-*` live in `families[]` rather than
 * `byName`, so the two most-typed attributes in the whole system were invisible to every consumer
 * of the vocabulary. A family declares a `pattern` (`'on-*'`) because a matcher function cannot be
 * shown to a reader, and `kind` distinguishes the two so a generator can render them differently.
 */
export const describeDirectives = () => [
  ...[...byName.values()].map((d) => ({
    kind: 'name' as const,
    name: d.name as string,
    value: d.value,
    ...(d.docs ?? {}),
  })),
  ...families.map(({ directive }) => ({
    kind: 'family' as const,
    name: (directive.name as { pattern?: string }).pattern ?? '(unnamed family)',
    value: directive.value,
    ...(directive.docs ?? {}),
  })),
];

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
/** The `location` the server's page store was created under — see below. */
let pageEpoch: unknown;
/**
 * **On a server the page store is per-REQUEST, and a module-level one is not.**
 *
 * `pageStore` lives for the life of the module, which in a browser is the life of the page — right.
 * On a server it is the life of the process, and `@key` then carries one request's data into the
 * next: a page reading `@route.path` with no `route` directive of its own would render the
 * PREVIOUS visitor's path. `@verajs/ssr` installs a fresh `location` object per render
 * (`applyLocation`) and serialises renders, so that object's identity is the request boundary the
 * engine can see without importing anything from the server.
 *
 * Residual, stated rather than hidden: a render given no `location` shares the ambient one, so two
 * such renders share a page store. That is the pre-existing behaviour and it is the case where
 * there is no request to leak between.
 */
const page = (): Record<string, unknown> => {
  if (!onServer()) return (pageStore ??= core().createStore({} as Record<string, unknown>));
  const epoch = (globalThis as { location?: unknown }).location;
  if (pageStore === null || pageEpoch !== epoch) {
    pageEpoch = epoch;
    pageStore = {};
  }
  return pageStore;
};

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
  /**
   * **A dotted key is readable and NOT writable, and the two used to disagree silently.**
   *
   * `readPath` resolves `user.name` by walking own properties, while a write did
   * `owner['user.name'] = value` — creating a literal property of that name, which no read will
   * ever find. A global made it worse: the `@` branch returns before the undeclared-write check,
   * so `@cart.count: 1` was accepted in total silence. Refused rather than implemented, because
   * writing through a path means mutating a nested object, and a nested mutation does not notify
   * the store's subscribers — so the "working" version would be a second silent failure.
   */
  if (key.includes('.')) {
    reject(el, 'context', 'key-not-writable', `"${key}" is a path, and a path can be read but not written.`,
      'Write the whole object under its own key, or use a flat key.');
    return;
  }
  if (key.startsWith('@')) {
    const global = page();
    if (onServer() && !sameValue(global[key.slice(1)], value)) serverWrites++;
    global[key.slice(1)] = value;
    return;
  }
  const owner = ownerOf(el, key) ?? nearestCarrier(el);
  if (!owner) {
    reject(el, 'context', 'no-carrier', `a write to "${key}" found no data-vd-state ancestor.`, 'Add one, or use an @page key.');
    return;
  }
  if (__DEV__ && !(key in owner))
    reject(el, 'context', 'undeclared-write', `"${key}" was not declared by the state it landed in.`, 'Declare it in data-vd-state.');
  if (onServer() && !sameValue(owner[key], value)) serverWrites++;
  owner[key] = value;
};

/**
 * Did this write CHANGE anything — the question the server's fixed-point walk turns on.
 *
 * Identity alone is too strict: `route` republishes `{ path, query, hash }` and `region` its
 * counts, both freshly built each pass, so an identity comparison would report a change for ever
 * and the walk would never converge on a page that is in fact settled.
 *
 * **One level is not enough either, and the difference is not academic** — `@route.query` is
 * itself a fresh object, so a shallow compare reported `@route` as changed on every pass and the
 * walk hit its limit on the very first page that used it. So this recurses, bounded: the depth cap
 * is what makes a cyclic or pathologically deep value cost a pass rather than a stack, and past it
 * the answer is "changed", which is the safe direction.
 */
const sameValue = (a: unknown, b: unknown, depth = 0): boolean => {
  if (Object.is(a, b)) return true;
  if (depth > 4 || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  return ak.length === bk.length
    && ak.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1));
};

/** Writes made during the current server pass that actually changed a value. */
let serverWrites = 0;

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

/** One view per element, so `stateOf(el) === stateOf(el)` and a reference can be kept. */
const views = new WeakMap<Element, Record<string, unknown>>();

/**
 * **What this element can SEE — resolved per key, exactly as its directives resolve.**
 *
 * It used to return the nearest carrier, which is a different question and quietly a wrong one.
 * Context resolves PER KEY (design §4): a `<li>` inside `data-vd-state="{ q: '' }"` inside
 * `data-vd-state="{ user: … }"` reads both, and every directive on it does. `stateOf` handed back
 * only the inner store, so `stateOf(li).user` was `undefined` while `data-vd-text="user.name"` on
 * the same element rendered the name — the introspection door disagreeing with the engine it exists
 * to introspect, silently, in the direction of "there is nothing there".
 *
 * A merged snapshot would fix reading and break writing, which is half of what this is for. So the
 * view is live: a read resolves the owner chain, and a write goes through the SAME path a directive
 * takes — landing on the key's owner rather than the nearest carrier, and picking up the
 * undeclared-key and dotted-key refusals with it.
 */
export const stateOf = (el: Element): Record<string, unknown> | null => {
  if (!nearestCarrier(el)) return null;
  const cached = views.get(el);
  if (cached) return cached;
  const view = new Proxy({} as Record<string, unknown>, {
    get: (_t, key) => (typeof key === 'string' ? readKey(el, key) : undefined),
    set: (_t, key, value) => {
      if (typeof key === 'string') writeKey(el, key, value);
      return true;
    },
    has: (_t, key) => typeof key === 'string' && ownerOf(el, key) !== null,
    /** The union of every key in scope, nearest first — so `Object.keys` and spread see what a
     *  directive on this element sees, not what one store happens to hold. */
    ownKeys: () => {
      const keys = new Set<string>();
      for (let n: Element | null = el; n !== null; n = flatParent(n))
        for (const key of Object.keys(carriers.get(n) ?? {})) keys.add(key);
      return [...keys];
    },
    getOwnPropertyDescriptor: (_t, key) =>
      typeof key === 'string' && ownerOf(el, key) !== null
        ? { configurable: true, enumerable: true, value: readKey(el, key) }
        : undefined,
  });
  views.set(el, view);
  return view;
};

/** A bare key read through the owner chain — `stateOf`'s reads and `Ctx.get` ask the same way. */
const readKey = (el: Element, key: string): unknown =>
  readPath(el, {
    kind: 'path',
    negate: false,
    global: key.startsWith('@'),
    segments: (key.startsWith('@') ? key.slice(1) : key).split('.'),
  });

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
  _directive: AnyDirective;
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

/**
 * The value a directive sees, parsed by its declared class. Factored out of activation because
 * the SERVER path evaluates the same attributes, and two copies of this decision is exactly the
 * "two implementations of truth" §9 refuses. `REFUSED` is the parse failure — already recorded.
 */
const REFUSED = Symbol('refused');

const parseFor = (el: Element, attr: string, directive: AnyDirective): Parsed | typeof REFUSED => {
  const raw = el.getAttribute(attr);
  if (directive.value === 'literal') {
    /**
     * LITERAL means literal, in BOTH tiers: it never goes through `parseAttr` at all, so a bare
     * word is a string and no tier can turn it into something that resolves — `sync="draft"`
     * names the key "draft", it does not read it. (Found when the expressions tier compiled the
     * key to a thunk and persist restored under the key's VALUE.)
     */
    return parseLiteral(raw ?? '');
  }
  if (directive.value === 'none') return null;
  try {
    return parseAttr(raw ?? '');
  } catch (error) {
    const ve = error as ValueError;
    reject(el, attr, ve.code ?? 'value-bad', `could not parse "${raw}": ${ve.message}`);
    return REFUSED;
  }
};

const activateDirective = (el: Element, attr: string, directive: AnyDirective, selection: unknown) => {
  const map = instances.get(el) ?? new Map<string, Instance>();
  instances.set(el, map);
  if (map.has(attr)) return; // already live — attribute changes come through deactivate first
  const parsed = parseFor(el, attr, directive);
  if (parsed === REFUSED) return;
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

export const stateDirective: AnyDirective = {
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
    /**
     * **A server carrier is a PLAIN OBJECT, and that is what makes `static: true` honest.**
     *
     * A server render is one shot: the subscriptions a store builds are never fired, so the proxy
     * is pure cost — which is exactly the reasoning behind `renderToString`'s `static` option. But
     * that option also REFUSES writes, because in a reactive render a write that cannot propagate
     * is a silent wrong answer. A directive that seeds state from the request (`query`, `route`,
     * `in-view`) writes, so under `static` it was refused and the page rendered unfiltered — the
     * markup differed between the two modes, breaking the one invariant static rests on.
     *
     * Not using a store here removes the collision at its root rather than negotiating with it:
     * the server pass never depends on reactivity in EITHER mode, so the two render identically by
     * construction, and the ordering reactivity used to provide is supplied explicitly by the
     * fixed-point walk in `renderDirectives`.
     */
    carriers.set(el, onServer() ? initial : core().createStore(initial));
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

const directiveFor = (suffix: string): { directive: AnyDirective; selection: unknown } | null => {
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
const applyHit = (el: Element, attr: string, hit: { directive: AnyDirective; selection: unknown }, root: Node): void => {
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
  const found: Array<{ attr: string; directive: AnyDirective; selection: unknown }> = [];
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
  /** On a server there is nothing to observe and no event to wait for: evaluate once and stop.
   *  Delegating rather than refusing is what makes `wire([directives])` correct in both runtimes
   *  — the app says what it wants, and where it runs decides what that means. */
  if (onServer()) {
    renderDirectives(root);
    return;
  }
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

/**
 * The symmetric half of `activate`, and it must TEAR DOWN — not merely stop watching.
 *
 * It used to disconnect the observer and forget the root, which reads as "deactivate" and is not:
 * every `every` interval kept ticking, every `sync`/`copy`/`scroll-to` listener stayed attached,
 * every `focus-trap` stayed on the module-level stack and every `scroll-lock` stayed counted. The
 * constraint set says it plainly — *timers leak without teardown, and the ENGINE owns teardown* —
 * and this was the one door that did not. Nothing caught it because the export had no caller and
 * no test; found in the pre-publication API audit.
 */
export const deactivate = (root: Document | ShadowRoot | Element) => {
  if (!roots.delete(root)) return;
  observers.get(root)?.disconnect();
  observers.delete(root);
  const target: Node = isDocument(root as Node) ? (root as Document).documentElement : (root as Node);
  if (target.nodeType === 1) unwalk(target);
  else for (let c = (target as unknown as ParentNode).firstElementChild; c; c = c.nextElementSibling) unwalk(c);
};

/* ── server rendering (design §9) ─────────────────────────────────────────────────────────── */

/**
 * **One evaluator, two runtimes.** The server runs the SAME parse, the SAME context resolution
 * and the SAME `apply` the browser runs — it simply runs them ONCE and attaches nothing. That is
 * the whole anti-drift argument of §9: a separate server-side guesser (WP's `initial_truth`) is
 * two implementations of one truth, and they diverge. Here the attribute IS the state source on
 * both sides, so hydration has nothing to reconcile — the client re-derives the same answer,
 * idempotently, and a mismatch is structurally impossible rather than merely tested for.
 *
 * What runs here and what does not follows the directive's own `ssr` declaration (see the
 * contract): absent means behavioral — handlers, timers, focus, clipboard — and behavioral means
 * nothing to say before an event exists. `state` is the exception the ENGINE owns rather than a
 * pack: context has to be seeded or every reflection reads undefined, and its setup is a store
 * and nothing else.
 *
 * Handlers are the interesting non-case: they need no server pass at all, because they are not
 * hydrated in the first place. `data-vd-on-click="{ open: !open }"` IS the handler, delegation
 * matches it at dispatch, and one root listener serves every element the server ever wrote —
 * so a server-rendered page is interactive the moment the engine boots, at a cost independent
 * of how much markup arrived.
 */

/** The shim's own published marker — the same signal `boot()` already trusts. */
const onServer = (): boolean => (globalThis as { __veraSsrShimmed?: boolean }).__veraSsrShimmed === true;

/**
 * Every directive NAME this process has rendered, unclaimed ones included — unclaimed is
 * precisely the interesting set, because those are the lazily-loadable packs whose modules a
 * server should preload. Drained by `takeDirectiveNames()`, so a caller reads one render's worth:
 * `renderToString` serializes its renders, which is what makes a module-level set correct here.
 */
const seenNames = new Set<string>();

/**
 * The names seen since the last call, and clears them. Hand them to
 * `directiveLoader(...).url(name)` to emit `<link rel="modulepreload">` — the server sees every
 * attribute, so the discover-then-fetch waterfall never has to happen for first paint.
 */
export const takeDirectiveNames = (): string[] => {
  const names = [...seenNames];
  seenNames.clear();
  return names;
};

const renderElement = (el: Element): void => {
  const found: Array<{ attr: string; directive: AnyDirective; selection: unknown }> = [];
  for (const { name } of el.attributes) {
    if (!name.startsWith(PREFIX)) continue;
    const suffix = name.slice(PREFIX.length);
    if (suffix === 'cloak') continue;
    seenNames.add(suffix);
    const hit = directiveFor(suffix);
    /** No refusal for an unknown name here: the client asks its loader chain, and a server that
     *  rejected would record a refusal about a pack the browser is about to fetch. */
    if (hit) found.push({ attr: name, ...hit });
  }
  found.sort((a, b) => (a.directive.priority ?? 50) - (b.directive.priority ?? 50));

  for (const f of found) {
    const ctx = ctxFor(el, f.attr, f.selection);
    try {
      /** Context first, and engine-owned: `state`'s setup is a store and a teardown, nothing else. */
      if (f.directive === stateDirective) {
        /** The walk may run more than once (below); a carrier is seeded on the first pass only,
         *  or the second would refuse itself with `state-reseed-ignored` and discard the writes
         *  the first pass had just made. */
        if (!carriers.has(el)) stateDirective.setup?.(el, ctx);
        continue;
      }
      const mode = f.directive.ssr;
      if (!mode) continue;
      const parsed = parseFor(el, f.attr, f.directive);
      if (parsed === REFUSED) continue;
      const value = f.directive.value === 'none' ? undefined : evaluate(el, parsed);
      if (typeof mode === 'function') {
        mode(el, value, ctx);
        continue;
      }
      /** `ssr: true` — resolve the apply exactly as activation does, then call it ONCE: no hook,
       *  no subscription, nothing retained past this render. */
      let apply = f.directive.apply;
      if (f.directive.setup) {
        const out = f.directive.setup(el, ctx);
        if (out && typeof out === 'object' && out.apply) apply = out.apply;
      }
      apply?.(el, value, ctx);
    } catch (error) {
      /** Quarantined per instance, exactly as the client quarantines — a refusal is a sentence in
       *  the registry, never a failed page. */
      reject(el, f.attr, 'directive-threw', String((error as Error)?.message ?? error));
    }
  }

  /**
   * And the cloak comes off. It exists to hide markup whose reflections have not run yet — and
   * they have now, so leaving it would hide CORRECT content until the client booted, which is
   * the very flash it was written to prevent, inverted.
   */
  if (el.hasAttribute(CLOAK)) el.removeAttribute(CLOAK);
};

const serverWalk = (node: Node): void => {
  if (node.nodeType !== 1) return;
  const el = node as Element;
  if (el.localName === 'template') return;
  renderElement(el);
  for (let child = el.firstElementChild; child; child = child.nextElementSibling) serverWalk(child);
};

/**
 * Evaluates a subtree's declarative directives into the markup, once. Called automatically for
 * every component root during an `@verajs/ssr` render (the `'init'` connector detects the shim),
 * so an app that wires directives is correct when server-rendered with no server-specific setup
 * at all. Exported for a root the connector never sees — a hand-built shell, a test.
 *
 * **Returns nothing: `takeDirectiveNames()` is the one door to the names.** It used to also return
 * the names new to this subtree, which is a second, subtly different answer to the same question —
 * per-root and per-render disagree the moment a page has two components, and a preload list wants
 * the page. Keeping both meant computing both, and the cost was not theoretical: the subtree answer
 * needed a snapshot of every name seen so far, allocated per component root per render.
 */
export const renderDirectives = (root: Document | ShadowRoot | Element): void => {
  const target: Node = isDocument(root as Node) ? (root as Document).documentElement : (root as Node);
  const walk = () => {
    if (target.nodeType === 1) serverWalk(target);
    else for (let c = (target as unknown as ParentNode).firstElementChild; c; c = c.nextElementSibling) serverWalk(c);
  };

  /**
   * **A FIXED POINT, not a cascade.** On the client, a directive that seeds state and one that
   * reads it are connected by the store: order does not matter because the reader re-runs when the
   * value lands. The server has no store (see the carrier note), so the ordering has to be
   * explicit — and document order is not it: `region` publishes `counts` that a `data-vd-text`
   * ABOVE it reads, and no single traversal satisfies both directions.
   *
   * So the pass repeats while it is still changing state, which reaches the same answer the client
   * reaches, from any starting order. Convergence is not an assumption: reflections compare before
   * they write (the rule `region`'s own fixed-point test pins), so a settled page writes nothing on
   * the following pass. A page that does not settle is a directive violating that rule, and it is
   * told so rather than being allowed to spin — with the last pass's markup kept, because a
   * partially-derived page is still a readable one.
   *
   * The cost is one extra walk on a page that seeds and none on a page that does not.
   */
  const LIMIT = 5;
  let passes = 0;
  for (;;) {
    const mark = serverWrites;
    walk();
    if (serverWrites === mark) break;
    if (++passes >= LIMIT) {
      reject(target as Element, 'render', 'server-unsettled',
        `state was still changing after ${LIMIT} server passes, so the markup may not be final.`,
        'A directive is writing a different value every run — compare before writing.');
      break;
    }
  }
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
  /**
   * **The point differs by runtime, and that is why one wiring is correct in both.**
   *
   * In a browser, `'init'` — after the shadow root exists and before the first render, so an
   * observer is watching by the time anything is rendered into it.
   *
   * On a server there is no observer, and `'init'` fires before the first render: a one-shot pass
   * there would walk an EMPTY root and evaluate nothing (measured — it is how this was found).
   * `'settle'` is the moment @verajs/ssr publishes for exactly this: lifecycle run, frames
   * drained, markup about to be serialized. Chosen at module evaluation because the shim is
   * installed before the app is imported (the SSR package's own documented rule, and the same
   * marker `boot()` already trusts), so the descriptor is simply *the right one* rather than a
   * branch taken at every element.
   */
  on: (onServer() ? 'settle' : 'init') as 'init',
  priority: 40,
  fn: (element: HTMLElement) => {
    const el = element as unknown as Record<string, ShadowRoot | null | undefined>;
    /** `_shadowRoot` is the server's own field — a CLOSED root is null on `shadowRoot` in both
     *  runtimes, and the server still serializes it, so it must still be evaluated. */
    const root = el['_root'] ?? el['_shadowRoot'] ?? element.shadowRoot ?? element;
    activate(root as ShadowRoot | Element);
  },
};
