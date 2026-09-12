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
export const attributeValueComplaint = (tag: string, name: string, value: unknown): string | null => {
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

  /**
   * Returned WITHOUT the `[vera]` prefix, which each call site writes as a literal.
   * `tests/diagnostics-convention.test.mjs` reads the prefix off the call, so a message handed over
   * as a variable is invisible to it — and its answer to that is an allowance list. Taking the
   * allowance would have excused these two calls rather than checked them, which is the
   * reclassification this audit keeps refusing; the literal at the call site is what every other
   * diagnostic in the repo does anyway.
   */
  return (
    `renderer: the attribute \`${name}\` on <${tag}> was given ${said}. ` +
    `An attribute value is a string and nothing else.\n` +
    `If the element is meant to RECEIVE this value, bind a property instead — \`.${name}=\${value}\` ` +
    `— which is how a custom element takes anything that is not text. If it is meant to be read as ` +
    `text, convert it where you know what it means: \`date.toISOString()\`, \`list.join(' ')\`. ` +
    `A Date in particular serializes with the SERVER's timezone on one side and the browser's on ` +
    `the other, so it will not survive hydration.`
  );
};
