import { misuse } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { tracking } from '../store/store.js';
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
 * The tracking cell cleared: a read subscribes whatever hook the cell holds, and it holds none.
 *
 * @param fn Function to run without tracking
 * @return Whatever `fn` returns
 */
export const untrack = <T>(fn: () => T): T => {
  if (__DEV__ && typeof fn !== 'function')
    throw new TypeError(misuse('untrack', 'untrack-not-function', __DEV__ && PROSE['untrack-not-function'](String(fn))));
  return untracked(fn);
};

/**
 * `fn(a, b, c)` with no hook reading (the tracking cell cleared, then restored) — `untrack` with its arguments passed through, so a hot
 * caller allocates no closure. Core hands it to the modules it is wired to: the renderer runs a ref, and reads a
 * component's getter on the parent's behalf, through it — that code's reads must not subscribe the render.
 */
export const untracked: Untracked = (fn, a, b, c) => {
  const reader = tracking.hook;
  tracking.hook = undefined;
  try {
    return fn(a!, b!, c!);
  } finally {
    tracking.hook = reader;
  }
};
