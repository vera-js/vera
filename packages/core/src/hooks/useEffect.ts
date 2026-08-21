import { createHook } from '../modules/createHook.js';
import { coalesce } from './coalesce.js';
import { HookCallback, ComponentElement } from '../types.js';

/**
 * When changes are detected, runs the callback later than both useRender and useLayoutEffect.
 *
 * Coalesced: every change within a tick produces **one** run on the next animation frame, carrying
 * `signal.changed` with the full set of properties that moved. For a run per individual change,
 * observing each intermediate value, use `useSyncEffect`.
 *
 * A returned function is treated as cleanup and runs before the next pass.
 *
 * @param callback Callback to run when a change is detected
 * @param element Element to bind to, when not the current instance
 */
export const useEffect = (callback: HookCallback, element?: ComponentElement) => {
  createHook({
    callback: coalesce(callback, (run) =>
      /** `typeof` rather than a bare reference: the global is undefined, not falsy, off-browser. */
      typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : run()
    ),
    element,
    priority: 75,
  });
};
