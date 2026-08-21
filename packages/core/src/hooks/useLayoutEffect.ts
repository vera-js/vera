import { createHook } from '../modules/createHook.js';
import { coalesce } from './coalesce.js';
import { HookCallback, ComponentElement } from '../types.js';

/**
 * When changes are detected within content, runs the callback before both useRender and useEffect.
 *
 * Coalesced on a microtask, so it lands before the frame that useRender and useEffect run on, but
 * still only once per tick. See `useEffect` for the batching contract and `useSyncEffect` for
 * per-change semantics.
 *
 * A returned function is treated as cleanup and runs before the next pass.
 *
 * @param callback Callback to run when a change is detected
 * @param element Element to bind to, when not the current instance
 */
export const useLayoutEffect = (callback: HookCallback, element?: ComponentElement) => {
  createHook({
    callback: coalesce(callback, (run) => {
      Promise.resolve().then(run);
    }),
    element,
    priority: 25,
  });
};
