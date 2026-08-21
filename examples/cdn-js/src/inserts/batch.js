/**
 * Write batching as a `'set-handler'` insert — the extension point whose type documents exactly
 * this use ("batching, transactions, undo/redo…"). Returning `false` from a `'set-handler'`
 * takes responsibility for propagation; the default is suppressed until we flush.
 *
 *   import { batch, batching } from './inserts/batch.js';
 *   insert('set-handler', batching, 50);
 *
 *   batch(() => {
 *     state.a = 1;
 *     state.b = 2;      // useSyncEffect subscribers hear nothing yet…
 *     state.a = 3;
 *   });                 // …then one flush: a (1 write, final value), b — deduped per property
 *
 * Mostly interesting for `useSyncEffect` users: `useEffect` and renders already coalesce per
 * frame on their own. Nested `batch` calls join the outermost one.
 */

/** Writes held during a batch: obj -> prop -> { value, prevValue, runCallbacks }. */
let held = null;

/** The insert. Registered once: insert('set-handler', batching, 50). */
export const batching = (obj, prop, value, prevValue, runCallbacks) => {
  if (!held) return; // not batching — leave default propagation alone
  let props = held.get(obj);
  if (!props) held.set(obj, (props = new Map()));
  const seen = props.get(prop);
  /** First `prevValue` wins so the pair spans the whole batch; latest `value` wins. */
  props.set(prop, { value, prevValue: seen ? seen.prevValue : prevValue, runCallbacks });
  return false;
};

/** Runs `fn`, holding every store write until it finishes, then flushes once per property. */
export const batch = (fn) => {
  if (held) return fn(); // nested batch joins the outer one
  held = new Map();
  try {
    fn();
  } finally {
    const flush = held;
    held = null;
    for (const [obj, props] of flush) {
      for (const [prop, { value, prevValue, runCallbacks }] of props) {
        if (value !== prevValue) runCallbacks(obj, prop, value, prevValue);
      }
    }
  }
};
