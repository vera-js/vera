import { createHook } from '../modules/createHook.js';
import { coalesce } from './coalesce.js';
import { renderScheduler } from '../modules/setRenderScheduler.js';
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
    /**
     * The same scheduler renders use, rather than a second hardcoded `requestAnimationFrame`.
     *
     * It used to inline its own copy — identical to `animationFrame` in `setRenderScheduler`, down
     * to the `typeof` guard for off-browser environments. That duplicated the knowledge and, worse,
     * meant `setRenderScheduler(microtask)` moved renders while leaving effects on animation frames:
     * the two then ran on different clocks, which is not what an author asks for by swapping one
     * scheduler.
     */
    callback: coalesce(callback, (run) => renderScheduler(run), 'useEffect'),
    element,
    priority: 75,
  });
};
