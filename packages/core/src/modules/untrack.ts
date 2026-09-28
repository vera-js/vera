import { hooksQueue } from '../store/store.js';

/**
 * Reads state without subscribing to it — the escape hatch for an effect that needs the CURRENT value of
 * something it should not re-run for (Solid's `untrack`, Preact's `untracked`).
 *
 * ```js
 * useEffect(() => {
 *   const a = state.a;                       // re-runs when `a` changes
 *   const b = untrack(() => state.b);        // reads current `b`, stays unsubscribed
 * });
 * ```
 *
 * An empty entry on top of the tracking stack: a read records whatever hook is on top, and there is none.
 *
 * @param fn Function to run without tracking
 * @return Whatever `fn` returns
 */
export const untrack = <T>(fn: () => T): T => {
  hooksQueue.push(undefined);
  try {
    return fn();
  } finally {
    hooksQueue.pop();
  }
};
