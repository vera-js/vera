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
 * **This can loop.** An effect that unconditionally writes state it also reads will recurse — the
 * same hazard Solid and Preact carry, and the reason `useEffect` is the safer default. Guard the
 * write, or use `useEffect`. In development the recursion is stopped and named at depth 50 rather
 * than allowed to run to a stack overflow, which reports the trap and not the cause; production
 * carries neither the counter nor the check.
 *
 * @param callback Callback to run on every change
 * @param element Element to bind to, when not the current instance
 */
export const useSyncEffect = (callback: HookCallback, element?: ComponentElement) => {
  let cleanup: void | HookCleanup;
  /** Dev-only re-entry depth. Unreferenced in production, so the build drops it entirely. */
  let depth = 0;

  createHook({
    callback: <V>(signal?: Signal<V>, init?: boolean) => {
      if (__DEV__) {
        if (depth > 50) {
          console.error(
            `[vera] useSyncEffect re-entered ${depth} times and was stopped — it is writing state ` +
              `it also reads.\nThis hook runs synchronously on every change, so an unguarded write ` +
              `feeds itself. Guard the write (\`if (next !== state.x) state.x = next\`), or use ` +
              `useEffect, which coalesces.`
          );
          return;
        }
        depth++;
      }
      try {
        cleanup?.();
        const next = callback(signal, init);
        swapCleanup(cleanup, next);
        cleanup = next;
      } finally {
        if (__DEV__) depth--;
      }
    },
    element,
    priority: 75,
  });
};
