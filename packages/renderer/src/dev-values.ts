/**
 * `__DEV__` only: the one home for *"is this value something an attribute can carry?"*
 *
 * **Why it is a closed vocabulary and not a predicate.** The first design asked whether a value
 * stringifies meaningfully — `String(v) === '[object Object]'` means it lost its data. Driven
 * through 16 value shapes rather than reasoned about, that broke four ways, and the first is
 * disqualifying: `String()` THROWS on `Object.create(null)`, on `{ toString: null }`, and on any
 * object whose `toString` throws — so a diagnostic would have killed the page for an author using
 * the recommended dictionary idiom. It also passed `["a","b"]` as `"a,b"` (one junk class, if that
 * was a `class` binding) and `new Date()` as a timezone-bearing string, which is an SSR/CSR
 * divergence manufactured out of correct-looking code. And it passed `Symbol('s')` while
 * `` `${sym}` `` throws — a guard and its sink disagreeing about a single expression.
 *
 * "Does it stringify meaningfully" is an OPEN predicate over an unbounded, environment-dependent
 * space, and open predicates cannot be audited. So the test is inverted and closed: **primitives
 * pass; everything else is reported; anything else that should pass is a named row added on
 * evidence.** The list has exactly one member so far.
 *
 * Credit where it is due: the four breaks were found by the omni engine's session, which drove the
 * shapes rather than arguing about them, and the closed-vocabulary form is theirs.
 */

/**
 * Blessed non-primitives — types whose `toString` IS the value the author means.
 *
 * Tested by brand rather than `instanceof`, which is false across realms: a `URL` built in an
 * iframe is not `instanceof` the parent's `URL`, and a diagnostic that fires on a correct value in
 * one frame and not another is worse than none.
 */
const brand = (value: object) => Object.prototype.toString.call(value);

/** One message per element+name+kind, so a value rebuilt every render does not flood the console. */
let reported: Set<string> | undefined;

/**
 * Returns the complaint, or `null` when the value is fine. Never throws — the shapes that break a
 * naive guard are exactly the ones worth reporting, so they reach the `object` arm and are named.
 */
export const attributeValueKind = (tag: string, name: string, value: unknown): string | null => {
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') return null;
  if (type === 'object' && brand(value as object) === '[object URL]') return null;

  /**
   * Keyed by BRAND, not by `typeof` — `Date`, `Array` and a plain object are all `'object'`, so a
   * coarser key reported whichever arrived first and silently swallowed the rest. An author who
   * fixed the Date would never have been told about the array.
   */
  const key = `${tag}|${name}|${type === 'object' ? brand(value as object) : type}`;
  reported ??= new Set();
  if (reported.has(key)) return null;
  reported.add(key);

  /**
   * A function into an attribute is never what the author meant, but the REASON matters: on a
   * custom element the Lit-era convention is that complex values are set as properties, so
   * `<my-chart formatter={fn}>` is a coherent intention that this sink simply cannot express. The
   * message names the binding that can, rather than blaming the author.
   */
  const said = type === 'function'
    ? `a function, which becomes its own SOURCE TEXT`
    : type === 'symbol'
      ? `a symbol, which every DOM conversion refuses`
      : Array.isArray(value)
        ? `an array, which becomes its members joined by commas`
        : brand(value as object) === '[object Date]'
          ? `a Date, whose text carries the TIMEZONE of whichever side rendered it`
          : `an ${type}, which cannot survive as text`;

  /** The KIND only: the sentence is the shared `attribute-value` entry, printed by each call site with its area. */
  return said;
};

/**
 * `__DEV__` only: **an event name one or two keystrokes from a real one** — `@clik`, or `onClik` in
 * JSX, which compiles to it — is almost certainly a typo, and a listener for an event that never
 * fires is a button that silently does nothing. TypeScript cannot catch it beside a permissive prop
 * surface (an index signature cannot exclude names), and nothing at runtime ever fails.
 *
 * Deliberately narrow, because custom events are legitimate on every element: a name the element
 * knows (`'on' + name in element`) is never questioned; one that EXTENDS a real event (`changed`,
 * `loaded`, `closed`) is a custom event by its shape and is left alone; and only a name within two
 * edits of an event this element really has — transpositions counting as one — is named. Each
 * `(tag, name)` pair is said once. The message comes back without the `[vera]` prefix; the call site
 * adds it as a literal, where `tests/diagnostics-convention.test.mjs` can read it.
 */
/** Marked pure: a bare module-level `new Set()` is kept by the bundler even when nothing reads it, and
 *  was the only trace this dev-only check left in production (8 B raw, measured). */
const saidEvents = /* @__PURE__ */ new Set<string>();
export const eventNameGuess = (element: Element, name: string): string | null => {
  if ('on' + name in element) return null;
  const said = element.localName + ' ' + name;
  if (saidEvents.has(said)) return null;
  let best: string | null = null;
  let bestDistance = 3;
  for (const key in element) {
    if (!key.startsWith('on')) continue;
    const known = key.slice(2);
    if (name.startsWith(known)) return null;
    const distance = editDistance(name, known, bestDistance);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = known;
    }
  }
  if (best === null) return null;
  saidEvents.add(said);
  /** The GUESS only: the sentence is the renderer table's `event-name-typo`. */
  return best;
};

/** Optimal-string-alignment distance, stopping early once it cannot come in under `limit`. */
const editDistance = (a: string, b: string, limit: number): number => {
  if (Math.abs(a.length - b.length) >= limit) return limit;
  let before: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, before[j - 2] + 1);
      current.push(value);
      if (value < rowBest) rowBest = value;
    }
    if (rowBest >= limit) return limit;
    before = previous;
    previous = current;
  }
  return previous[b.length];
};
