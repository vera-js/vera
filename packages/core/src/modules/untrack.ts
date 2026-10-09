import { hooksQueue } from '../store/store.js';
import type { Untracked } from '@verajs/shared-utils';

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
  if (__DEV__ && typeof fn !== 'function')
    throw new TypeError(
      `untrack: expected a function and received ${String(fn)}. It runs the function without subscribing — ` +
        `\`untrack(() => state.a)\`, not \`untrack(state.a)\`, which reads the property before untrack can do anything about it.`
    );
  return untracked(fn);
};

/**
 * `fn(a, b, c)` with nothing on top of the tracking stack — `untrack` with its arguments passed through, so a hot
 * caller allocates no closure. Core hands it to the modules it is wired to: the renderer runs a ref, and reads a
 * component's getter on the parent's behalf, through it — that code's reads must not subscribe the render.
 */
export const untracked: Untracked = (fn, a, b, c) => {
  hooksQueue.push(undefined);
  try {
    return fn(a!, b!, c!);
  } finally {
    hooksQueue.pop();
  }
};
