/**
 * **Where every diagnostic code is explained.** The URL is permanent: a released bundle is immutable, so every version
 * published points here for ever — the domain cannot lapse and `/e/` cannot be reorganized without breaking links in
 * code nobody can edit; the docs site redirects instead. `scripts/sync-diagnostics.mjs` imports this constant, so the
 * pages and the bundles can never disagree about where they are.
 */
export const DOCS = 'https://verajs.dev/e/';

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
 * A package converts only where its production bundle measured SMALLER for it (Brian, 2026-10-02): a bundle whose
 * messages are already a few words keeps them rather than paying for `DOCS`.
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
 * characters just because its owner wrote it (vera-5a, 2026-10-09).
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
