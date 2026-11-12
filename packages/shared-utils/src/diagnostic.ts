/**
 * **Where every diagnostic code is explained.** The URL is permanent: a released bundle is immutable, so every version
 * published points here for ever — the domain cannot lapse and `/e/` cannot be reorganized without breaking links in
 * code nobody can edit; the docs site redirects instead. `scripts/sync-diagnostics.mjs` imports this constant, so the
 * pages and the bundles can never disagree about where they are.
 */
export const DOCS = 'https://verajs.dev/e/';

/**
 * **What this copy of the framework has already said** (Brian's ruling, 2026-11-12): the ONE memory behind `warnOnce`, `errorOnce`
 * and `hasWarned`, for DEVELOPMENT-ONLY warnings. It replaced the hand-written once-flags every package kept
 * (`saidLists`, `warnedDrop`, per-element WeakSets, per-key Sets: two naming styles, Brian: no names). **A warning that
 * ships to production keeps its memory at its site** (bytes, measured 2026-11-12: the shared memory costs +80–145 B gz
 * per bundle); development-only warnings use warnOnce. Module state by necessity, since "once" spans every call on the
 * page. One per BUNDLE COPY, exactly the scope each flag had, because this package is inlined into every bundle.
 * A code, or `code key` for a string key, in a Set. An object key (an element, a setup function) in a WeakMap, so its
 * entry goes with the object. Marked pure, so a bundle that never prints once drops both.
 */
const printed = /* @__PURE__ */ new Set<string>();
const printedOn = /* @__PURE__ */ new WeakMap<object, Map<string, Set<unknown>>>();
/**
 * A once's KEY: none (once per page), a string (once per that string), an object (once per that object: an element, a
 * class, a setup function), or the PAIR `[object, value]`, a value key on that object (a store write: the object and its
 * property; a keyed list: the list and the duplicate key, compared as the list compares them, by value, so `1` and `'1'`
 * stay apart). A pair is the only array a key may be.
 */
type OnceKey = string | object | readonly [object, unknown];
/** Where an object key's (code, value) lives: the value set for that code on that object, made on demand. */
const valuesOn = (on: object, code: string, make: boolean): Set<unknown> | undefined => {
  let codes = printedOn.get(on);
  if (codes === undefined) {
    if (!make) return undefined;
    printedOn.set(on, (codes = new Map()));
  }
  let values = codes.get(code);
  if (values === undefined && make) codes.set(code, (values = new Set()));
  return values;
};
/** The object and value of an object or pair key. */
const split = (key: object): readonly [object, unknown] => (Array.isArray(key) ? (key as unknown as readonly [object, unknown]) : [key, undefined]);
/** Whether (code, key) is new, recording it if so. */
const firstTime = (code: string, key?: OnceKey): boolean => {
  if (key === undefined || typeof key === 'string') {
    const entry = key === undefined ? code : `${code} ${key}`;
    if (printed.has(entry)) return false;
    printed.add(entry);
    return true;
  }
  const [on, sub] = split(key);
  const values = valuesOn(on, code, true)!;
  if (values.has(sub)) return false;
  values.add(sub);
  return true;
};

/**
 * **One shape for every diagnostic the framework prints** — the short line production keeps, the whole sentence
 * development adds — so a package converting its messages writes a table and a call, never its own format.
 *
 *   production   `[vera] hydration: element: found <i> — https://verajs.dev/e/hydration-fallback`
 *   development  `[vera] hydration: element: found <i> — fell back to a client render: … (hydration-fallback)`
 *
 * `subject` is the free information — what the code already has at hand, naming the problem area — the same in both
 * builds. `prose` is development only: the package's table entry (`Prose`), called behind `__DEV__` at the call site so
 * the table goes unreferenced in production and rollup drops it whole. Production prints the code inside the link, so
 * the reader is one click from the explanation, which `scripts/sync-diagnostics.mjs` publishes from the same tables.
 *
 * **Every production message is coded** (Brian, 2026-11-11; this supersedes "convert where smaller", 2026-10-02):
 * consistency over a few bytes, so no package keeps a hand-written production line beside its table.
 */
/*
 * The parameter names are deliberately unlike anything a caller holds: terser will not inline a function whose
 * parameter shadows a name at the call site (measured 2026-10-02 — directives passes its own `code`, and a parameter
 * called `code` left `((e,t,n)=>`…`)(0,t,n)` in its bundle, +8 B; renamed, the call folds to the bare template).
 */
/**
 * **A misused API, named by its function** — the thrown-error twin of `diagnostic()`: `untrack: expected a function …
 * (untrack-not-function)`, function-first because a stack already names the source and the sweep reads that shape. The
 * prose comes from a package's table, behind `__DEV__`, so a development-only guard costs production nothing.
 */
export const misuse = (forName: string, withCode: string, andProse?: false | readonly [string, string?]) =>
  __DEV__ && andProse
    ? `${forName}: ${andProse[0]}${andProse[1] ? ` ${andProse[1]}` : ''} (${withCode})`
    : `${forName}: ${DOCS}${withCode}`;

/**
 * **A misused API and what it was misused ABOUT** — `misuse()` with a subject, in `diagnostic()`'s ` — ` separator:
 * `parseFrontmatter: line 3 — https://verajs.dev/e/cms-frontmatter-unsupported`. The subject is the free information
 * (a line, a URL and its status) and prints in both builds. A sibling rather than an optional parameter on `misuse()`,
 * because `misuse()` is inlined into every bundle that throws and a conditional subject would tax all of them for a
 * shape few need; a sibling is tree-shaken where unused.
 */
export const misuseAbout = (forName: string, aboutSubject: string, withCode: string, andProse?: false | readonly [string, string?]) =>
  __DEV__ && andProse
    ? `${forName}: ${aboutSubject} — ${andProse[0]}${andProse[1] ? ` ${andProse[1]}` : ''} (${withCode})`
    : `${forName}: ${aboutSubject} — ${DOCS}${withCode}`;

export const diagnostic = (
  inArea: string,
  bySubject: string,
  withCode: string,
  andProse?: false | readonly [string, string?]
) =>
  /** `__DEV__` HERE as well as at the call: production folds this to the one-line form, branch and all. */
  __DEV__ && andProse
    ? `[vera] ${inArea}: ${bySubject} — ${andProse[0]}${andProse[1] ? ` ${andProse[1]}` : ''} (${withCode})`
    : `[vera] ${inArea}: ${bySubject} — ${DOCS}${withCode}`;

/**
 * **Text from outside — a file path, a YAML key, a URL, an error's message — quoted before it reaches a line.** A log is a
 * pipeline, and such text can be shaped by an author or a request: a newline in it forges a line, an ESC sequence hides
 * one (log injection). `JSON.stringify` escapes both; cut to 80 characters so one value cannot fill the log. @verajs/ssr
 * keeps a twin (it cannot import this), held equal by tests/ssr-coded-diagnostics.
 */
/**
 * `max` caps the length (80 by default); `Infinity` keeps the whole text for a value worth reading in full — a site
 * owner's own path — which is still ESCAPED: truncation and escaping are separate jobs, and a path is not free of control
 * characters just because its owner wrote it (2026-10-09).
 */
export const quoted = (text: string, max = 80): string => JSON.stringify(text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * **The errors a package constructs, marked as its own** — so a wrapper that reports an inner refusal (cms's
 * `generateManifest` around a frontmatter line) carries it as it is: already formatted, its outside text already
 * quoted. Anything else is foreign, and quoted. Identity, never a shape test: a message can imitate ours, an identity
 * cannot. @verajs/ssr keeps a twin (it cannot import this).
 */
const ours = /* @__PURE__ */ new WeakSet<object>();
export const own = <E extends Error>(error: E): E => {
  ours.add(error);
  return error;
};
export const isOwn = (error: unknown): boolean => typeof error === 'object' && error !== null && ours.has(error);

/**
 * **Whether this copy has already said `code` (for `key`)**: for a GUARD only, where deciding to warn costs work worth
 * skipping once the warning is out (development's whole-tree walk for unwired directive attributes, an event-name
 * guess over every property of an element). A site that only prints calls `warnOnce`. Asks, never records.
 */
export const hasWarned = (code: string, key?: OnceKey): boolean => {
  if (key === undefined || typeof key === 'string') return printed.has(key === undefined ? code : `${code} ${key}`);
  const [on, sub] = split(key);
  return valuesOn(on, code, false)?.has(sub) === true;
};

type Detail = false | readonly [string, string?] | (() => readonly [string, string?] | undefined);
/**
 * The printer behind both, on one level. `andDetail` is `diagnostic()`'s prose, or a function returning it where building
 * the sentence costs something: it is called only the first time. `...andMore` rides beside the line behind '%s' (an
 * element, a thrown error), never inside it, so text from outside cannot forge a line. The console method is read at the
 * call, so a test that replaces `console.warn` sees it.
 */
const sayOnce =
  (level: 'warn' | 'error') =>
  (inArea: string, bySubject: string, withCode: string, andDetail?: Detail, forKey?: OnceKey, ...andMore: unknown[]): void => {
    if (!firstTime(withCode, forKey)) return;
    const line = diagnostic(inArea, bySubject, withCode, typeof andDetail === 'function' ? andDetail() : andDetail);
    if (andMore.length) console[level]('%s', line, ...andMore);
    else console[level](line);
  };
/**
 * **A diagnostic said once per page** (per key, where one is given: a string, or an object such as the element it is
 * about): `diagnostic()`'s arguments, then the key, then what rides beside the line. Coded in production exactly as
 * `diagnostic()` is, because it IS `diagnostic()`. `errorOnce` is its twin on `console.error`, for a refusal a page should
 * not miss.
 */
export const warnOnce = /* @__PURE__ */ sayOnce('warn');
export const errorOnce = /* @__PURE__ */ sayOnce('error');
