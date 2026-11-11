import { RAW } from '../services/identity.js';

/**
 * **A deep plain copy of `value`, for cloning, sending or saving state** (`structuredClone`, `postMessage`, IndexedDB,
 * JSON): every store replaced by its data at EVERY depth, every plain object and array copied once (so cycles are kept),
 * a `Map` or `Set` copied with its entries; anything else (a class instance, a `Date`) kept as given.
 *
 * A record written into a store is stored as given (Brian, 2026-11-08), so the raw data passed to `createStore` can
 * hold stores, which can't be cloned; this is the way to a plain copy. It costs a walk of what it copies, only when called.
 *
 * @example structuredClone(snapshot(state))
 */
export const snapshot = <T>(value: T): T => copyOut(value, new Map()) as T;

/** The copy of `value`, recorded in `seen` before its contents are copied, so a cycle comes back as the same copy. */
const copyOut = (value: unknown, seen: Map<object, unknown>): unknown => {
  if (value === null || typeof value !== 'object') return value;
  const raw = ((value as { [RAW]?: object })[RAW] ?? value) as Record<string, unknown>;
  const done = seen.get(raw);
  if (done !== undefined) return done;
  /** A Map or Set: a new one, its entries copied out the same way (a store held in one would otherwise stop the clone). */
  if (raw instanceof Map || raw instanceof Set) {
    const copy = raw instanceof Map ? new Map() : new Set();
    seen.set(raw, copy);
    for (const [k, v] of (raw as Map<unknown, unknown>).entries()) {
      if (copy instanceof Map) copy.set(copyOut(k, seen), copyOut(v, seen));
      else copy.add(copyOut(k, seen));
    }
    return copy;
  }
  const proto = Object.getPrototypeOf(raw);
  if (!Array.isArray(raw) && proto !== Object.prototype && proto !== null) return raw;
  const out = (Array.isArray(raw) ? new Array(raw.length) : Object.create(proto)) as Record<string, unknown>;
  seen.set(raw, out);
  for (const key in raw)
    if (Object.hasOwn(raw, key)) {
      const copied = copyOut(raw[key], seen);
      /**
       * An own `__proto__` key (`JSON.parse` makes one) is DEFINED, not assigned: assigning it would run the inherited
       * `__proto__` setter and replace the copy's prototype instead of copying the key.
       */
      if (key === '__proto__') Object.defineProperty(out, key, { value: copied, writable: true, enumerable: true, configurable: true });
      else out[key] = copied;
    }
  return out;
};
