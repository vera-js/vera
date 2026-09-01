/**
 * Computed values as a `'proxy-handler'` insert — the extension point demonstrated end-to-end.
 *
 * Core deliberately has no `computed` API (see llms.txt, "Not supported"): it is exactly the kind
 * of capability the insert system exists for. This whole feature is the ten lines below.
 *
 * How it works: a `'proxy-handler'` insert sees every property read on every store and may
 * replace the value being returned. Reads that happen *inside* a hook run in that hook's tracking
 * context — so when the marked function reads other store properties, those reads subscribe the
 * hook automatically. No dependency arrays, no invalidation bookkeeping: the reactivity graph is
 * doing all of it already.
 *
 *   import { computed, computedValues } from './inserts/computed.js';
 *   wire({ on: 'proxy-handler', fn: computedValues, priority: 40 });
 *
 *   const state = createStore({
 *     count: 0,
 *     doubled: computed(() => state.count * 2),   // reads as a value: state.doubled === 0
 *   });
 *
 * The function closes over the store itself (safe: the body only runs on later reads), so
 * anything it reads — this store or another — becomes a live dependency of whatever hook is
 * currently reading `state.doubled`.
 *
 * Reactive Map/Set support lived at this same extension point before it moved into core.
 */

/** Marks a function as a computed value. The marker is what keeps ordinary function-valued
 * properties (event handlers stored in state, say) untouched. */
export const computed = (fn) => ((fn._computed = true), fn);

/** The insert: replace marked functions with their result at read time. */
export const computedValues = (obj, prop, value) =>
  typeof value === 'function' && value._computed === true ? value() : value;
