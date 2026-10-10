/**
 * **How @verajs/ssr says what it says** (code-system phase 4c, 2026-10-09). Twins of @verajs/shared-utils' `misuse()`
 * and `diagnostic()` DEVELOPMENT output — ssr cannot import the private package, so the shapes are restated here and
 * `tests/ssr-shared-twins.test.mjs` holds the generated strings equal — plus the two server rules (vera-5a):
 * text that came from outside is quoted, and a warning is said once per process per key, never at request rate.
 */
type Said = readonly [string, string?];

const sentence = ([what, fix]: Said): string => `${what}${fix ? ` ${fix}` : ''}`;

/** A thrown message: `ssr: <sentence> <fix> (<code>)` — what `misuse('ssr', code, prose)` says in development. */
export const ssrMisuse = (code: string, prose: Said): string => `ssr: ${sentence(prose)} (${code})`;

/** A warning line: `[vera] ssr: <subject> — <sentence> <fix> (<code>)` — `diagnostic('ssr', subject, code, prose)`. */
export const ssrWarning = (subject: string, code: string, prose: Said): string => `[vera] ssr: ${subject} — ${sentence(prose)} (${code})`;

/**
 * **Text from outside — an error's message, a URL, a selector, a name — quoted before it reaches a line.** A server's
 * console is a log pipeline, and that text can be shaped by a request: a newline in it forges a log line, an ESC
 * sequence hides one (log injection — the server's form of the '%s' class). `JSON.stringify` escapes both; cut to 80
 * characters so one value cannot fill the log either.
 */
/**
 * `max` caps the length (80 by default); `Infinity` keeps the whole text for a value worth reading in full — a site
 * owner's own path — which is still ESCAPED: truncation and escaping are separate jobs, and a path is not free of control
 * characters just because its owner wrote it (vera-5a, 2026-10-09).
 */
export const quoted = (text: string, max = 80): string => JSON.stringify(text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * **Once per process per key.** A server renders per request, so a warning that fires per render floods the log at
 * request rate; every ssr warning names its key (a component tag, with an attribute or an event type where that
 * distinguishes two facts). Bounded by the number of component classes and their names — the code, not the traffic.
 */
const said = new Set<string>();
export const once = (key: string): boolean => {
  if (said.has(key)) return false;
  said.add(key);
  return true;
};

/**
 * **The errors ssr constructs, marked as its own.** A refusal raised inside a render is reported by the render's
 * `ssr-render-threw` beside the component's tag, and quoting it as foreign text would cut its code off: one of ours
 * is already formatted, its outside text already quoted, so it is carried as it is. Anything else is the app's —
 * quoted. A set of instances, never a shape test: a message can imitate ours, an identity cannot.
 */
const ours = new WeakSet<object>();
export const own = <E extends Error>(error: E): E => {
  ours.add(error);
  return error;
};
export const isOwn = (error: unknown): boolean => typeof error === 'object' && error !== null && ours.has(error);
