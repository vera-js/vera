/**
 * Write batching as a `'store'` insert — the extension point for batching, transactions, undo,
 * persistence and devtools. It is consulted once, when a store first meets a value, and handed core's
 * handler for it; this one wraps core's `set`. Outside a batch a write goes through core as usual.
 * Inside one it is written to the raw target, which notifies nobody, and remembered — then `batch`
 * notifies once per property through `kit.trigger`, core's own notify.
 *
 *   import { batch, batching } from './inserts/batch.js';
 *   wire({ on: 'store', fn: batching, priority: 60 });
 *
 *   batch(() => {
 *     state.a = 1;
 *     state.b = 2;      // useSyncEffect subscribers hear nothing yet…
 *     state.a = 3;
 *   });                 // …then one flush: a (1 write, final value), b — deduped per property
 *
 * Mostly interesting for `useSyncEffect` users: `useEffect` and renders already coalesce per
 * frame on their own. Nested `batch` calls join the outermost one. Wire it at the app entry: a
 * `'store'` insert reaches the values a store meets after it is wired.
 */

/** Writes held during a batch: obj -> prop -> { value, prevValue, added, kit }. */
let held = null;

/** The insert: wraps core's handler (plain objects and arrays), leaves everything else alone. */
export const batching = (type, handler, kit) =>
  handler?.set && {
    ...handler,
    set(obj, prop, next, receiver) {
      if (!held) return handler.set(obj, prop, next, receiver);
      const prevValue = obj[prop];
      const added = !Object.prototype.hasOwnProperty.call(obj, prop);
      if (!Reflect.set(obj, prop, next)) return false;
      let props = held.get(obj);
      if (!props) held.set(obj, (props = new Map()));
      const seen = props.get(prop);
      /** First `prevValue` wins so the pair spans the whole batch; latest `value` wins. */
      props.set(prop, { value: next, prevValue: seen ? seen.prevValue : prevValue, added: seen?.added || added, kit });
      return true;
    },
  };

/** Runs `fn`, holding every store write until it finishes, then notifies once per property. */
export const batch = (fn) => {
  if (held) return fn(); // nested batch joins the outer one
  held = new Map();
  try {
    fn();
  } finally {
    const flush = held;
    held = null;
    for (const [obj, props] of flush) {
      for (const [prop, { value, prevValue, added, kit }] of props) {
        if (value !== prevValue) kit.trigger(obj, prop, value, prevValue);
        if (added) kit.trigger(obj, kit.shape, value, prevValue);
      }
    }
  }
};
