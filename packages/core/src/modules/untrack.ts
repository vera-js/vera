import { hooksQueue } from '../store/store.js';
import { ComponentHook } from '../types.js';

/**
 * Reads state without subscribing to it.
 *
 * Inside a hook, every property read registers a dependency, so an effect that needs the *current*
 * value of something it should not re-run for has no way to ask. This is the escape hatch — the
 * equivalent of Solid's `untrack` or Preact's `untracked`.
 *
 * ```js
 * useEffect(() => {
 *   const a = state.a;                       // re-runs when `a` changes
 *   const b = untrack(() => state.b);        // reads current `b`, stays unsubscribed
 * });
 * ```
 *
 * It cannot be a module: the `'proxy-handler'` insert runs *before* dependency registration, which
 * then happens unconditionally, so an insert can change the value returned but not the subscription.
 *
 * Implemented by pushing a blank entry — `addCallback` already bails on one without an element,
 * callback and priority, so nothing registers while it is on top of the queue.
 *
 * @param fn Function to run without tracking
 * @return Whatever `fn` returns
 */
export const untrack = <T>(fn: () => T): T => {
  /**
   * Checked because the mistake is easy and the failure names the wrong thing: `untrack(state.a)`
   * instead of `untrack(() => state.a)` reads the property *before* untrack is entered — so it is
   * tracked after all, which is the opposite of what was asked for — and then throws
   * `fn is not a function`, naming a parameter rather than the call. Every other direct entry point
   * in core says what it wanted; this one did not.
   */
  if (__DEV__ && typeof fn !== 'function')
    throw new TypeError(
      `untrack: expected a function and received ${String(fn)}. It runs the function without ` +
        `subscribing — \`untrack(() => state.a)\`, not \`untrack(state.a)\`, which reads the property ` +
        `before untrack can do anything about it.`
    );
  hooksQueue.push({} as ComponentHook);
  try {
    return fn();
  } finally {
    hooksQueue.pop();
  }
};
