import { createHook, reportHookError } from '../modules/createHook.js';
import type { ComponentElement, HookCallback, HookCleanup } from '../types.js';

/**
 * The next animation frame, looked up when a pass is scheduled rather than when a hook is created —
 * `render()` runs in environments with no `requestAnimationFrame` (a test, a server) and must not
 * fail there merely by naming it.
 */
export const frame = (run: () => void) => requestAnimationFrame(run);

/**
 * **One hook, run at once on the first pass and then at most once per `schedule`, however many
 * writes land before it runs** — the shape `useRender`, `useEffect` and `useLayoutEffect` all share,
 * differing only in priority and in when `schedule` runs the pass.
 *
 * The deferred run re-enters through the hook itself: `now` is raised for exactly that one call, so
 * the hook's own wrapper provides the tracking context and the error isolation, as it does for
 * every other run. It is lowered before the callback runs, so a write the callback makes to state it
 * reads schedules another pass rather than recursing into one.
 *
 * Whatever the callback returns is its cleanup, run before its next run. A throwing cleanup is
 * reported on its own rather than stopping the run it precedes — otherwise one bad teardown silenced
 * its effect for good.
 *
 * @param callback The effect, or a render pass (which returns nothing)
 * @param priority Where it runs among its owner's hooks
 * @param schedule Runs the deferred pass — an animation frame, a microtask, or at once
 * @param element The owner, instead of the element being set up
 * @return The hook, as `createHook` returns it
 */
export const coalesce = (
  callback: HookCallback,
  priority: number,
  schedule: (run: () => void) => void,
  element?: ComponentElement
) => {
  let queued = false;
  let now = false;
  let cleanup: void | HookCleanup;
  const hook = createHook({
    priority,
    element,
    callback: (signal, init) => {
      if (init || now) {
        now = false;
        try {
          cleanup?.();
        } catch (error) {
          reportHookError(error, element);
        }
        /** Cleared first, so a callback that throws does not leave the cleanup it already ran to run again. */
        cleanup = undefined;
        cleanup = callback(signal, init);
        return;
      }
      if (queued) return;
      queued = true;
      schedule(() => {
        queued = false;
        now = true;
        hook!(signal);
        now = false;
      });
    },
  });
  return hook;
};
