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
import { parseValue, parseLiteral, isPath, isObject, sameValue } from './parse.js';
import type { ValueError } from './parse.js';
import type { Parsed, ParsedObject, Path } from './parse.js';
import type { AnyDirective, Ctx, Directive, Rejection, EngineSeams, EngineConnector } from './types.js';
/**
 * Referenced ONLY inside `__DEV__` branches, which is what lets the whole module leave the
 * production bundle: once those fold, nothing names `PROSE` and rollup drops the import with it.
 */
import { PROSE } from './diagnostics.js';
/** Its own module so a PRODUCTION reference cannot tether the dev-only table — see `docs-url.ts`. */
import { DOCS } from './docs-url.js';
import { DEFAULT_PAYLOADS, TYPE } from './payload-defaults.js';
import type { Payload } from './payload-defaults.js';

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
    reject(el, attr, 'unknown-directive', [suffix]);
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
    reject(el, attr, 'unknown-directive', [suffix, loaderChain().length ? 'y' : '']);
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
          reject(entry.el, entry.attr, 'loader-loaded-nothing', [suffix]);
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
        reject(entry.el, entry.attr, 'loader-failed', [suffix, String((error as Error)?.message ?? error)]);
      }
    }
  );
};

const PREFIX = 'data-vd-';
const CLOAK = 'data-vd-cloak';

/**
 * **Tell core this engine is here — development only, and it is the whole missing-import story.**
 *
 * Markup addressed to a module the app never wired is inert and SILENT: `data-vd-on-click` on a
 * page that wired only the renderer does nothing, and the thing that would have complained about it
 * is the thing that is missing. So core watches for `data-vd-` attributes with no claimant, and
 * this is how a wired engine stops that warning firing.
 *
 * Claimed from BOTH doors — `wireDirectives(...)` and core's `wire([directives])` — because either
 * one alone means the markup is going to be handled, and warning at a page that works is far worse
 * than staying quiet at one that does not.
 *
 * `Symbol.for` rather than an import: the two packages share no runtime, so an import would be a
 * second copy rather than a channel. Inside `__DEV__` on both sides, so production carries nothing.
 */
const claim = () => {
  if (!__DEV__) return;
  const key = Symbol.for('vera.claims');
  const g = globalThis as Record<symbol, unknown>;
  ((g[key] as Set<string> | undefined) ?? (g[key] = new Set<string>()) as Set<string>).add(PREFIX);
};

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
  action: callAction,
});

export const wireDirectives = (item: Directive | EngineConnector | Array<Directive | EngineConnector>) => {
  claim();
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

/**
 * The `$` variables each event base offers — the other half of the vocabulary, and useless to a
 * generator unless it is here beside the directives.
 *
 * A picker that lists `data-vd-on-input` without saying it carries `$value` has told an author the
 * word and withheld the sentence. Sorted, so a generated page or a diff does not churn on Map order.
 */
export const describePayloads = () => [
  /**
   * **The universal row comes first, and it is not decoration.** This listed only bases someone had
   * registered, so `focusin` was absent although it answers `$type` — and a consumer reading the
   * list concluded that base offered nothing. An introspection API is worth exactly what its
   * completeness is worth, so the floor every event shares is IN THE DATA rather than in a sentence
   * a reader has to have found. A base listed below carries these as well as its own.
   */
  { base: '*', vars: ['$type'] },
  ...[...payloads.keys()]
    .map((base) => ({
      base,
      vars: [...Object.keys(payloads.get(base) ?? {}), 'type'].map((one) => `$${one}`),
    }))
    .sort((a, b) => (a.base < b.base ? -1 : 1)),
];

/* ── rejections ───────────────────────────────────────────────────────────────────────────── */

const allRejections: Rejection[] = [];
const byElement = new WeakMap<Element, Rejection[]>();
const warned = new Set<string>();

/**
 * Record a refusal.
 *
 * **The fourth argument decides where the prose comes from, and that is the whole design.** An
 * ARRAY (or nothing) asks `diagnostics.ts` for the sentence this code always carries, filling in
 * the array as its arguments; a STRING is used verbatim, which is how a third-party directive
 * writes its own words for a code this package has never heard of.
 *
 * Prod kept the DATA (code, element, directive) and dropped the prose even before — but the fold
 * lived HERE, inside the function, so every caller still constructed its string and shipped it to
 * be discarded. Moving the words into a table that only `__DEV__` reads is what finally makes the
 * intent true: 1,030 B gzipped that no production page has any use for.
 */
export const reject = (
  element: Element | null,
  directive: string,
  code: string,
  messageOrArgs?: string | readonly unknown[],
  fix?: string
) => {
  let message = '';
  if (__DEV__) {
    if (typeof messageOrArgs === 'string') message = messageOrArgs;
    else {
      const [text, suggested] = PROSE[code]?.(...((messageOrArgs ?? []) as string[])) ?? [`(${code})`];
      message = text;
      fix ??= suggested;
    }
  }
  const entry: Rejection = { element, directive, code, message, fix: __DEV__ ? fix : undefined };
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
  } else if (!warned.has(code)) {
    /**
     * **Production says something too — the code and where it is explained.**
     *
     * The prose is gone here and should be: it is bytes on every page for text an end user cannot
     * act on. But saying NOTHING is a different mistake, and this package was making it 140 times
     * over — a refusal was recorded in a registry nobody reads and the console stayed empty, so a
     * production-only failure was undebuggable by the one person who could fix it.
     *
     * The code survives the fold because tooling matches on it, so the whole line costs the URL and
     * a template: `[vera] directives: data-vd-show — https://docs.verajs.dev/e/undeclared-write`.
     *
     * Once per CODE rather than per code×directive as development does — a list of two hundred rows
     * making the same mistake is one line either way, and in production the extra grain buys a
     * reader nothing they can act on differently.
     */
    warned.add(code);
    console.warn(`[vera] directives: ${directive} — ${DOCS}${code}`);
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
      if (__DEV__) reject(el, 'context', 'unknown-key', [head]);
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
    reject(el, 'context', 'key-not-writable', [key]);
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
    reject(el, 'context', 'no-carrier', [key]);
    return;
  }
  if (__DEV__ && !(key in owner))
    reject(el, 'context', 'undeclared-write', [key]);
  if (onServer() && !sameValue(owner[key], value)) serverWrites++;
  owner[key] = value;
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
  /**
   * **A `$` name never falls through to state**, and that is about the diagnostic rather than the
   * value. Both answers are `undefined`, but the state lookup ALSO reports *"no ancestor state
   * declares `$vaule`"* — so one typo produced two refusals, the second of them nonsense, since a
   * trigger variable could not be in a `data-vd-state` however correct it was. The handler path
   * has already said the useful thing.
   */
  if (!global && segments[0]!.startsWith('$')) return payloadValue(segments[0]!.slice(1), segments.length - 1);
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

/* ── actions: the named escape hatch (design §17.4) ───────────────────────────────────────── */

/**
 * **The one place authored JavaScript enters — by NAME, never inline.**
 *
 * The value grammar is bounded on purpose: arithmetic, comparisons, a fixed set of pure functions,
 * no `eval` and no `Function`. That is what lets a reader look at markup and know what it can do.
 * The cost is the last one percent — call your API client, format with `Intl`, run a calculation
 * the tier cannot express — and without a door for it the answer is "write a component", which
 * throws away the whole vocabulary for one line of logic.
 *
 * ```js
 * wireActions({ checkout: (ctx) => api.checkout(ctx.get('cart')) });
 * ```
 * ```html
 * <button data-vd-on-click="{ status: checkout() }">Buy</button>
 * ```
 *
 * Three properties make this an escape hatch rather than a hole. The attribute names a function, it
 * never contains one. Every action a page can reach is in one registry, so "what JavaScript can
 * this page run" has an answer a tool can print. And an action receives a `Ctx` rather than free
 * rein, so its reads and writes go through the same door directives use and land in the same store.
 *
 * **They run only while a handler is firing**, which is the rule that keeps them from being the
 * hole. `data-vd-text="checkout()"` would otherwise charge a card on every re-render — a reflection
 * runs whenever its inputs change, and an author reaching for an action is thinking about an event.
 * The same gate the `$` variables use, for the same reason.
 */
const actions = new Map<string, (ctx: Ctx, event: Event | null, ...args: unknown[]) => unknown>();

/**
 * Register named actions. Later registrations replace earlier ones under the same name, so a page
 * may sharpen one a pack shipped.
 */
export const wireActions = (
  map: Record<string, (ctx: Ctx, event: Event | null, ...args: unknown[]) => unknown>
): void => {
  for (const [name, fn] of Object.entries(map)) actions.set(name, fn);
};

/** The registered action names — beside `describeDirectives()`, and the point of a registry. */
export const describeActions = (): string[] => [...actions.keys()].sort();

const callAction = (name: string, args: readonly unknown[], element: Element | null): unknown => {
  const fn = actions.get(name);
  if (!fn) {
    const known = __DEV__ ? [...actions.keys()] : [];
    throw refusal('unknown-action', [name, known.join(', ')]);
  }
  /** A reflection has no event; running an action there is the mistake described above. */
  if (!firing) throw refusal('action-outside-handler', [name]);
  if (!element) throw refusal('action-no-element', [name]);
  return fn(ctxFor(element, 'action', undefined), firing, ...args);
};

/* ── event payloads: the `$` namespace (design §20.1) ─────────────────────────────────────── */

/**
 * **What a handler can read about the event that ran it.**
 *
 * `data-vd-on-input="{ q: $value }"` was impossible before this: a handler could only write
 * constants and re-read state, so the commonest interaction there is — type into a box, filter a
 * list — needed `data-vd-sync` and a state key whether or not the page wanted one.
 *
 * **It cannot be "just read the event", and that is the design.** Native event properties live on
 * PROTOTYPES, so the own-property walk every path resolution here does would read nothing from a
 * real event — and reaching through the prototype chain would hand attribute text the entire DOM
 * API, which is precisely the surface this grammar exists not to have. A base declares GETTERS
 * returning primitives, `$` resolves against those and nothing else, and an unknown name refuses.
 *
 * **A map of NAME → getter, not a name list beside a reader returning all of them.** The first
 * version had `{ vars, read }`, which let the two disagree — a name declared and never read, or
 * read and never declared — and repeated `type` nine times, once per mouse base. Here a base IS
 * its vocabulary, `describePayloads()` reads the keys, and one shared object serves every base
 * that behaves alike.
 */
export type { Payload } from './payload-defaults.js';

const payloads = new Map<string, Payload>();

/**
 * Register payload getters for event bases — the same door packs and pages use. Merged per base
 * rather than replaced, so a page can add one name without restating the rest.
 */
export const wirePayloads = (map: Record<string, Payload>): void => {
  for (const [base, payload] of Object.entries(map)) {
    payloads.set(base, { ...payloads.get(base), ...payload });
  }
};

/**
 * The engine ships these; `payload-defaults.ts` holds them so the docs generator can read the same
 * declaration the runtime registers, rather than a hand-typed copy of it that drifts.
 */
for (const [base, payload] of Object.entries(DEFAULT_PAYLOADS)) payloads.set(base, payload);

/**
 * The event being dispatched, for the `$` resolution below.
 *
 * A module-level current-trigger rather than an overlay threaded through `evaluate`,
 * `runAssignments` and every caller: dispatch is synchronous and one at a time, the value is
 * genuinely ambient to the run, and the alternative allocated a payload object on EVERY event
 * whether or not the handler named one variable. Saved and restored rather than cleared, so a
 * handler dispatching an event of its own does not blank the outer trigger.
 */
let firing: Event | null = null;

/** The names in scope for an event, `$`-less — the did-you-mean and the refusal both read it. */
const offers = (event: Event | null): string[] =>
  event ? [...Object.keys(payloads.get(event.type) ?? {}), 'type'] : [];

/**
 * Resolve one `$name`, or THROW.
 *
 * **The throw is what makes the refusal free.** An unknown name must skip the whole handler —
 * writing `undefined` under the author's key is the half-applied state this engine refuses
 * everywhere else, and `{ q: $vlaue }` would read on screen as a filter matching everything.
 * Detecting that by WALKING every parsed value cost 235 B and had to run in production too, or the
 * two builds would disagree about what a page does. Throwing reuses the try/catch dispatch already
 * has: identical behaviour in both builds, and only the sentence is development-only.
 *
 * It also carries out of an EXPRESSION, which a walk had to handle as its own case — a throw leaves
 * `$q / 2` exactly as it leaves a bare `$q`, instead of quietly yielding NaN.
 */
const payloadValue = (name: string, tail: number): unknown => {
  const event = firing;
  /**
   * **A dotted `$` path is refused, not walked.** `$value.length` silently answered `"abcd"` — the
   * tail was dropped and the whole primitive returned, which is a wrong value that looks like a
   * right one, the failure this grammar exists to make impossible. Supporting it is not the fix
   * either: property access on a primitive is the prototype surface the extractor design closed on
   * purpose, and `.length` today is `.constructor` tomorrow.
   */
  if (tail > 0) throw refusal('payload-not-walkable', [`$${name}`]);
  /** No trigger at all — a reflection, an initial, a server pass. Its own refusal, because
   *  "$value is not something this event carries" is nonsense when there is no event. */
  if (!event) throw refusal('payload-outside-handler', [`$${name}`]);
  const getter = payloads.get(event.type)?.[name] ?? TYPE[name];
  if (!getter) {
    /**
     * The ARGUMENTS are development-only, not just the sentence they fill: `reject` keeps no
     * message in production, so computing the offered list and the did-you-mean there is work for
     * a string nothing reads — the difference between this refusal costing a code and costing the
     * vocabulary of every base beside it.
     */
    const list = __DEV__ ? offers(event) : [];
    const near = __DEV__
      ? list.find((one) => one[0] === name[0] && Math.abs(one.length - name.length) <= 2)
        ?? list.find((one) => one.includes(name) || name.includes(one))
      : undefined;
    throw refusal('unknown-payload-var',
      [`$${name}`, list.map((one) => `$${one}`).join(', '), near ? `$${near}` : '']);
  }
  const value = getter(event);
  /**
   * **Primitives only** is the charter (design §20.1) and nothing enforced it. A getter returning
   * an object hands attribute text a walkable graph — precisely what extractors exist to prevent —
   * and it would be a third-party getter, so the engine cannot assume good behaviour. Checked in
   * development, where the author of that getter is standing.
   */
  if (__DEV__ && value !== null && typeof value === 'object') {
    reject(null, 'payload', 'payload-not-primitive', [`$${name}`, firing?.type ?? '']);
    return undefined;
  }
  return value;
};

/**
 * Record a thrown error as a refusal, keeping its OWN code when it brought one.
 *
 * Everything used to land as `directive-threw` with the message in place of an explanation, which
 * turned `$value` outside a handler into `directive-threw: value` — a code that says a directive
 * misbehaved about a page that made an ordinary authoring mistake, and a message that is a bare
 * word. A refusal that names itself keeps its name however far it is thrown.
 */
const rejectThrown = (el: Element, attr: string, error: unknown): void => {
  const ve = error as ValueError & { args?: string[] };
  reject(el, attr, ve.code ?? 'directive-threw', ve.args ?? [String(ve?.message ?? error)]);
};

/** A refusal that travels as a throw — see `payloadValue`. */
const refusal = (code: string, args: string[]): ValueError & { args?: string[] } => {
  const error = new Error(code) as ValueError & { args?: string[] };
  error.code = code;
  error.args = args;
  return error;
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
    else reject(el, attr, 'handler-not-object');
  } catch (error) {
    reject(el, attr, (error as ValueError).code ?? 'value-bad', [raw, (error as ValueError).message]);
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
  reject: (code, messageOrArgs, fix) => reject(el, attr, code, messageOrArgs, fix),
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
    reject(el, attr, ve.code ?? 'value-bad', [raw, ve.message]);
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
            rejectThrown(el, attr, error);
            deactivateDirective(el, attr);
          }
        },
      });
      run?.(undefined, true);
    }
  } catch (error) {
    rejectThrown(el, attr, error);
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
    reject(el, attr, 'teardown-threw', [String((error as Error)?.message ?? error)]);
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
      ctx.reject((error as ValueError).code ?? 'value-bad', [raw, (error as ValueError).message]);
      return;
    }
    if (!isObject(parsed)) {
      ctx.reject('state-not-object');
      return;
    }
    if (carriers.has(el)) {
      /** The declaration was the SEED; live state is data (design §16). */
      ctx.reject('state-reseed-ignored');
      return;
    }
    const initial: Record<string, unknown> = {};
    /** Initials evaluate IN DECLARATION ORDER against ancestors + earlier keys (design §20.6) —
     *  the overlay IS the object being built, so `total: price * qty` sees its siblings. */
    for (const key of Object.keys(parsed)) {
      if (key.startsWith('_vd')) {
        ctx.reject('state-reserved-key', [key]);
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
      if (isObject(parsed)) {
        const outer = firing;
        firing = event;
        try {
          runAssignments(el, parsed);
        } finally {
          firing = outer;
        }
      } else reject(el, attr, 'handler-not-object');
    } catch (error) {
      const ve = error as ValueError & { args?: string[] };
      /** A `$` refusal carries its own arguments; a parse failure carries the text it choked on. */
      reject(el, attr, ve.code ?? 'value-bad', ve.args ?? [raw, ve.message]);
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
    /**
     * **A node still in the document did not leave — it MOVED, and tearing it down is wrong.**
     *
     * A move is delivered as a removal plus an addition, so this tore every directive on the moved
     * subtree down and built it again: `data-vd-init` ran twice on one page load, teardowns fired
     * for elements that never went anywhere, and any per-instance state closed over by `setup` was
     * silently discarded. Wrapping children in a container — something layout code does constantly
     * — was enough to trigger it.
     *
     * `isConnected` at PROCESSING time is the whole test. Records arrive in a microtask batch after
     * the DOM has settled, so a genuine removal reads false and a move reads true; the re-addition
     * in the same batch then finds the instances still live and returns, because activation is
     * idempotent per element and attribute.
     */
    for (const node of record.removedNodes) if (!node.isConnected) unwalk(node);
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
      rejectThrown(el, f.attr, error);
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
      reject(target as Element, 'render', 'server-unsettled', [String(LIMIT)]);
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
    claim();
    const el = element as unknown as Record<string, ShadowRoot | null | undefined>;
    /** `_shadowRoot` is the server's own field — a CLOSED root is null on `shadowRoot` in both
     *  runtimes, and the server still serializes it, so it must still be evaluated. */
    const root = el['_root'] ?? el['_shadowRoot'] ?? element.shadowRoot ?? element;
    activate(root as ShadowRoot | Element);
  },
};
