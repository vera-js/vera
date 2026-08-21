import { createHook } from '../modules/createHook.js';
import { HookCallback, HookCleanup, ComponentElement, Signal } from '../types.js';
import { swapCleanup } from '../store/store.js';

/**
 * Runs the callback **synchronously on every individual change**, the model Solid's `createEffect`
 * and Preact's `effect` use.
 *
 * The difference from `useEffect` is observability, not just timing. A coalesced effect runs once
 * after all the writes in a tick, so it only ever sees the final state; this one runs during each
 * write and therefore observes every intermediate value:
 *
 * ```js
 * state.a = 1; state.a = 2; state.a = 3;
 * // useEffect     -> one run, sees 3
 * // useSyncEffect -> three runs, sees 1, 2, 3
 * ```
 *
 * Each run also receives that individual change as `signal.prop` / `value` / `prevValue`, which the
 * equivalent hooks in Solid and Preact do not provide.
 *
 * A returned function is treated as cleanup and runs before the next pass.
 *
 * **This can loop.** An effect that unconditionally writes state it also reads will recurse until
 * the stack gives out — the same hazard Solid and Preact carry, and the reason `useEffect` is the
 * safer default. Guard the write, or use `useEffect`.
 *
 * @param callback Callback to run on every change
 * @param element Element to bind to, when not the current instance
 */
export const useSyncEffect = (callback: HookCallback, element?: ComponentElement) => {
  let cleanup: void | HookCleanup;

  createHook({
    callback: <V>(signal?: Signal<V>, init?: boolean) => {
      cleanup?.();
      const next = callback(signal, init);
      swapCleanup(cleanup, next);
      cleanup = next;
    },
    element,
    priority: 75,
  });
};
