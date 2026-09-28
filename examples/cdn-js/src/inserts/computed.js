/**
 * Computed values as a `'store'` insert — the extension point demonstrated end-to-end.
 *
 * `@verajs/store` ships a real `computed` (memoized, a hook of its own); this is the extension
 * point's worked example, and the whole feature is the few lines below.
 *
 * How it works: a `'store'` insert is consulted once, when a store first meets a value, and handed
 * core's handler for it; this one wraps core's `get` so a marked function reads as its result. Reads
 * that happen *inside* a hook run in that hook's tracking context — so when the marked function reads
 * other store properties, those reads subscribe the hook automatically. No dependency arrays, no
 * invalidation bookkeeping: the reactivity graph is doing all of it already.
 *
 *   import { computed, computedValues } from './inserts/computed.js';
 *   wire({ on: 'store', fn: computedValues, priority: 60 });
 *
 *   const state = createStore({
 *     count: 0,
 *     doubled: computed(() => state.count * 2),   // reads as a value: state.doubled === 0
 *   });
 *
 * The function closes over the store itself (safe: the body only runs on later reads), so
 * anything it reads — this store or another — becomes a live dependency of whatever hook is
 * currently reading `state.doubled`. Wire it at the app entry: a `'store'` insert reaches the values
 * a store meets after it is wired.
 */

/** Marks a function as a computed value. The marker is what keeps ordinary function-valued
 * properties (event handlers stored in state, say) untouched. */
export const computed = (fn) => ((fn._computed = true), fn);

/** The insert: wraps core's `get` so a marked function reads as its result. */
export const computedValues = (type, handler) =>
  handler?.get && {
    ...handler,
    get(obj, prop, receiver) {
      const read = handler.get(obj, prop, receiver);
      return typeof read === 'function' && read._computed === true ? read() : read;
    },
  };
