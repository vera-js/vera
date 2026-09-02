/**
 * The suite's assertion vocabulary, over `node:assert` — one reviewed
 * implementation instead of ~2,300 hand-transcribed call sites.
 *
 * When the suite left Vitest for `node --test` (2026-09-01 monorepo
 * migration), every `expect(...)` in 170 files was already written against
 * this exact matcher surface. Porting each call site to bare `assert` would
 * have meant thousands of individual transcriptions, each one a chance to
 * weaken an assertion invisibly — the mutation runner exists because tests
 * that look like they assert something sometimes do not. This module keeps
 * every call site byte-identical and puts the semantics in one place.
 *
 * The matcher set is closed: exactly what the suite used on the day of the
 * port, nothing speculative. A new matcher is added here when a test needs
 * it, with the semantics the test means — not imported wholesale.
 *
 * `vi` is the same idea for test doubles: `fn`, `spyOn` (methods and
 * accessors), `stubGlobal`/`unstubAllGlobals`, `restoreAllMocks`, and fake
 * timers over `node:test`'s `mock.timers`. Mock call records keep the shape
 * the suite reads: `f.mock.calls[i]` is that call's argument array.
 */
import { AssertionError } from 'node:assert';
import { mock } from 'node:test';

/* ── deep equality, with asymmetric matchers ──────────────────────────────── */

const ASYM = Symbol('asymmetric');

const isAsym = (v) => typeof v === 'object' && v !== null && v[ASYM] === true;

/**
 * Vitest `toEqual` semantics where the suite depends on them: `NaN` equals
 * `NaN`, and a property whose value is `undefined` is the same as an absent
 * one. Set/Map/Date/RegExp compare by content.
 */
const equals = (a, b) => {
  if (isAsym(b)) return b.matches(a);
  if (isAsym(a)) return a.matches(b);
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => equals(v, b[i]));
  }
  if (a instanceof Date || b instanceof Date)
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (a instanceof RegExp || b instanceof RegExp)
    return a instanceof RegExp && b instanceof RegExp && String(a) === String(b);
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false;
    return [...a].every((v) => [...b].some((w) => equals(v, w)));
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
    return [...a].every(([k, v]) => b.has(k) && equals(v, b.get(k)));
  }
  const keys = (o) => Object.keys(o).filter((k) => o[k] !== undefined);
  const ka = keys(a);
  const kb = keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => equals(a[k], b[k]));
};

/** Subset match: every key the expected object names must match; extras are fine. */
const matchesObject = (actual, expected) => {
  if (isAsym(expected)) return expected.matches(actual);
  if (typeof expected !== 'object' || expected === null) return equals(actual, expected);
  if (typeof actual !== 'object' || actual === null) return false;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((v, i) => matchesObject(actual[i], v));
  }
  return Object.keys(expected).every((k) => matchesObject(actual[k], expected[k]));
};

const show = (v) => {
  if (isAsym(v)) return v.label;
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'function') return v.name ? `[Function ${v.name}]` : '[Function]';
  try {
    return JSON.stringify(v, (_, x) => (typeof x === 'function' ? String(x) : x)) ?? String(v);
  } catch {
    return String(v);
  }
};

/* ── the matchers ─────────────────────────────────────────────────────────── */

const asFn = (actual) => {
  if (typeof actual !== 'function') throw new TypeError('expected a function');
  return actual;
};

const caught = (fn) => {
  try {
    fn();
    return { threw: false };
  } catch (error) {
    return { threw: true, error };
  }
};

const throwMatches = (error, expected) => {
  if (expected === undefined) return true;
  if (expected instanceof RegExp) return expected.test(error?.message ?? String(error));
  if (typeof expected === 'string') return (error?.message ?? String(error)).includes(expected);
  if (typeof expected === 'function') return error instanceof expected;
  return false;
};

/** name -> (actual, ...args) -> [pass, description-of-expectation] */
const MATCHERS = {
  toBe: (a, e) => [Object.is(a, e), `to be ${show(e)}`],
  toEqual: (a, e) => [equals(a, e), `to equal ${show(e)}`],
  /**
   * Aliased to `toEqual` knowingly: Vitest's strict variant also distinguishes
   * class identity and present-but-undefined keys. Weaker can only make an
   * assertion more permissive — never a false failure — and the mutation
   * table is the check on permissiveness. A test that needs the distinction
   * upgrades this matcher, not its call site.
   */
  toStrictEqual: (a, e) => [equals(a, e), `to strictly equal ${show(e)}`],
  toHaveLength: (a, n) => [a != null && a.length === n, `to have length ${n} (was ${a?.length})`],
  toContain: (a, e) => [
    typeof a === 'string' ? a.includes(e) : Array.from(a ?? []).includes(e),
    `to contain ${show(e)}`,
  ],
  toContainEqual: (a, e) => [Array.from(a ?? []).some((v) => equals(v, e)), `to contain an element equal to ${show(e)}`],
  toBeNull: (a) => [a === null, 'to be null'],
  toBeUndefined: (a) => [a === undefined, 'to be undefined'],
  toBeDefined: (a) => [a !== undefined, 'to be defined'],
  toBeTruthy: (a) => [Boolean(a), 'to be truthy'],
  toBeFalsy: (a) => [!a, 'to be falsy'],
  toBeInstanceOf: (a, c) => [a instanceof c, `to be an instance of ${c?.name ?? show(c)}`],
  toBeTypeOf: (a, t) => [typeof a === t, `to be of type ${t} (was ${typeof a})`],
  toBeGreaterThan: (a, n) => [a > n, `to be > ${n}`],
  toBeGreaterThanOrEqual: (a, n) => [a >= n, `to be >= ${n}`],
  toBeLessThan: (a, n) => [a < n, `to be < ${n}`],
  toBeLessThanOrEqual: (a, n) => [a <= n, `to be <= ${n}`],
  toBeCloseTo: (a, e, digits = 2) => [
    typeof a === 'number' && Math.abs(a - e) < 10 ** -digits / 2,
    `to be within ${10 ** -digits / 2} of ${e}`,
  ],
  toMatch: (a, e) => [
    e instanceof RegExp ? e.test(a) : typeof a === 'string' && a.includes(e),
    `to match ${show(e)}`,
  ],
  toMatchObject: (a, e) => [matchesObject(a, e), `to match ${show(e)}`],
  toThrow: (a, e) => {
    const result = caught(asFn(a));
    return [result.threw && throwMatches(result.error, e), e === undefined ? 'to throw' : `to throw ${show(e)}`];
  },
  toHaveBeenCalled: (a) => [asFn(a).mock.calls.length > 0, 'to have been called'],
  toHaveBeenCalledTimes: (a, n) => [
    asFn(a).mock.calls.length === n,
    `to have been called ${n} time(s) (was ${a.mock.calls.length})`,
  ],
  toHaveBeenCalledWith: (a, ...args) => [
    asFn(a).mock.calls.some((call) => equals(call, args)),
    `to have been called with ${args.map(show).join(', ')}`,
  ],
};

export const expect = (actual) => {
  const bind = (negated) =>
    Object.fromEntries(
      Object.entries(MATCHERS).map(([name, matcher]) => [
        name,
        (...args) => {
          const [pass, description] = matcher(actual, ...args);
          if (pass === negated) {
            throw new AssertionError({
              message: `expected ${show(actual)}${negated ? ' not' : ''} ${description}`,
              stackStartFn: bind,
            });
          }
        },
      ]),
    );
  return { ...bind(false), not: bind(true) };
};

/* ── asymmetric matchers ──────────────────────────────────────────────────── */

const asym = (matches, label) => ({ [ASYM]: true, matches, label });

const TYPEOF = new Map([
  [Number, 'number'],
  [String, 'string'],
  [Boolean, 'boolean'],
  [Function, 'function'],
  [Symbol, 'symbol'],
  [BigInt, 'bigint'],
]);

expect.any = (ctor) =>
  asym(
    (v) => (TYPEOF.has(ctor) ? typeof v === TYPEOF.get(ctor) : ctor === Array ? Array.isArray(v) : v instanceof ctor),
    `any(${ctor?.name ?? String(ctor)})`,
  );
expect.stringContaining = (s) => asym((v) => typeof v === 'string' && v.includes(s), `stringContaining(${show(s)})`);
expect.arrayContaining = (arr) =>
  asym((v) => Array.isArray(v) && arr.every((x) => v.some((y) => equals(y, x))), `arrayContaining(${show(arr)})`);
expect.closeTo = (n, digits = 2) =>
  asym((v) => typeof v === 'number' && Math.abs(v - n) < 10 ** -digits / 2, `closeTo(${n})`);

/* ── test doubles ─────────────────────────────────────────────────────────── */

const spies = [];
const stubbed = [];

const makeFn = (impl = () => undefined) => {
  /** A real `function`, so an implementation that reads `this` gets the call's receiver. */
  const f = function (...args) {
    f.mock.calls.push(args);
    const value = f._impl.apply(this, args);
    f.mock.results.push({ type: 'return', value });
    return value;
  };
  f._impl = impl;
  f.mock = { calls: [], results: [] };
  f.mockImplementation = (next) => ((f._impl = next), f);
  f.mockReturnValue = (v) => ((f._impl = () => v), f);
  f.mockClear = () => ((f.mock.calls.length = 0), (f.mock.results.length = 0), f);
  f.mockReset = f.mockClear;
  f.mockRestore = f.mockClear;
  return f;
};

/** Walks the prototype chain for the descriptor, the way the suite's accessor spies need. */
const findDescriptor = (obj, key) => {
  for (let o = obj; o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, key);
    if (d) return d;
  }
  return undefined;
};

export const vi = {
  fn: makeFn,

  spyOn(obj, key, accessor) {
    const descriptor = findDescriptor(obj, key);
    const hadOwn = Object.getOwnPropertyDescriptor(obj, key) !== undefined;
    if (accessor === 'get' || accessor === 'set') {
      const original = descriptor?.[accessor];
      const spy = makeFn(original ? (...args) => original.apply(obj, args) : () => undefined);
      Object.defineProperty(obj, key, {
        configurable: true,
        get: accessor === 'get' ? spy : descriptor?.get?.bind(obj),
        set: accessor === 'set' ? spy : descriptor?.set?.bind(obj),
      });
      spy.mockRestore = () => {
        if (hadOwn && descriptor) Object.defineProperty(obj, key, descriptor);
        else delete obj[key];
      };
      spies.push(spy);
      return spy;
    }
    const original = obj[key];
    const spy = makeFn(function (...args) {
      return original.apply(this ?? obj, args);
    });
    obj[key] = spy;
    spy.mockRestore = () => {
      if (hadOwn && descriptor) Object.defineProperty(obj, key, descriptor);
      else delete obj[key];
    };
    spies.push(spy);
    return spy;
  },

  /**
   * By descriptor, not assignment: happy-dom registers several globals (`CSS`
   * among them) as getter-only accessors, and a plain `globalThis[name] =`
   * throws on those. Saving and restoring the descriptor handles both shapes.
   */
  stubGlobal(name, value) {
    stubbed.push({ name, descriptor: Object.getOwnPropertyDescriptor(globalThis, name) });
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  },

  unstubAllGlobals() {
    for (const { name, descriptor } of stubbed.reverse()) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    stubbed.length = 0;
  },

  restoreAllMocks() {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  },

  clearAllMocks() {
    for (const spy of spies) spy.mockClear();
  },

  useFakeTimers() {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'setImmediate'] });
  },
  advanceTimersByTime(ms) {
    mock.timers.tick(ms);
  },
  useRealTimers() {
    mock.timers.reset();
  },
};
