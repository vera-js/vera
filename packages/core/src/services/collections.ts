import { StoreProxyKeys } from '@verajs/shared-types';

/**
 * The every-change channel: mutations notify it in addition to their own key, and unkeyed reads
 * (`entries`, `keys`, `values`, `forEach`, `size`) subscribe to it. Also part of the documented
 * surface for `'proxy-handler'` insert authors, so treat the name as public.
 */
const GLOBAL = '_global';

/**
 * One wrapper per collection per method, cached so repeated reads return the SAME function —
 * `map.get === map.get` holds, and the hot path (this runs inside the proxy `get` trap) does not
 * allocate a closure per read.
 */
const wrapperCache = new WeakMap<object, Map<PropertyKey, unknown>>();

/**
 * Returns a tracking wrapper for a Map/Set method read through a store proxy.
 *
 * Native collection methods throw (`called on incompatible receiver`) when invoked on the proxy —
 * their internal slots live on the raw target — so this re-bind is what makes collections in
 * stores work at all; the per-method change detection is what makes them reactive.
 *
 * History: this lived in `@verajs/map-support` as a `'proxy-handler'` insert (the insert form is
 * archived as the reference example of that extension point). Integrated 2026-08-20: collections
 * that throw-by-default were a landmine for "core covers what most people need", and the direct
 * branch skips the per-read insert-chain walk. The `'proxy-handler'` insert point itself is
 * unchanged and stays public.
 *
 * Change detection is per method: `set` fires iff absent-or-different, `add` iff absent, `delete`
 * iff it returned true, `clear` iff non-empty (notifying every previous key). No-op mutations are
 * silent. `get`/`has` subscribe per key; `entries`/`keys`/`values`/`forEach` subscribe to every
 * change. `for…of`/spread work but do not subscribe (`Symbol.iterator` — iterate via `entries()`
 * when reactivity is needed). Reactivity is per-entry, not deep: values come back raw.
 */
export const collectionMethod = (
  obj: object & StoreProxyKeys,
  prop: PropertyKey,
  propValue: unknown,
  addCallback: (obj: never, prop: never) => void,
  runCallbacks: (obj: never, prop: never, value: never, prevValue: never) => void
) => {
  let wrappers = wrapperCache.get(obj);
  if (wrappers === undefined) wrapperCache.set(obj, (wrappers = new Map()));

  let wrapper = wrappers.get(prop);
  if (wrapper === undefined) {
    const collection = obj as unknown as Map<unknown, unknown> & Set<unknown>;
    const method = propValue as (...args: unknown[]) => unknown;
    /** The single cast seam between the collection's untyped keys and the callback machinery. */
    const notify = (key: unknown, value: unknown, prevValue: unknown) =>
      (runCallbacks as (o: object, k: unknown, v: unknown, p: unknown) => void)(obj, key, value, prevValue);
    const track = (key: unknown) => (addCallback as (o: object, k: unknown) => void)(obj, key);

    wrapper = (...args: unknown[]) => {
      const [key, value] = args;
      switch (prop) {
        case 'set': {
          const had = collection.has(key);
          const prevValue = collection.get(key);
          const result = method.apply(obj, args);
          if (!had || prevValue !== value) {
            notify(key, value, prevValue);
            notify(GLOBAL, value, prevValue);
          }
          return result;
        }
        case 'add': {
          const had = collection.has(key);
          const result = method.apply(obj, args);
          if (!had) {
            notify(key, key, undefined);
            notify(GLOBAL, key, undefined);
          }
          return result;
        }
        case 'delete': {
          const prevValue = collection.get ? collection.get(key) : key;
          const result = method.apply(obj, args);
          if (result === true) {
            notify(key, undefined, prevValue);
            notify(GLOBAL, undefined, prevValue);
          }
          return result;
        }
        case 'clear': {
          /** Captured first: subscribers of individual keys must hear the clear too. */
          const previous = collection.size > 0 ? [...collection.entries()] : null;
          const result = method.apply(obj, args);
          if (previous) {
            for (const [key, prevValue] of previous) notify(key, undefined, prevValue);
            notify(GLOBAL, undefined, undefined);
          }
          return result;
        }
        case 'get':
        case 'has': {
          track(key);
          return method.apply(obj, args);
        }
        case 'entries':
        case 'keys':
        case 'values':
        case 'forEach': {
          track(GLOBAL);
          return method.apply(obj, args);
        }
        default:
          return method.apply(obj, args);
      }
    };
    wrappers.set(prop, wrapper);
  }
  return wrapper;
};
