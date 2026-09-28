import { createHook, reportHookError } from '../modules/createHook.js';
import { currentInstance } from '../store/store.js';
import { renderScheduler } from '../modules/setRenderScheduler.js';
import type { ComponentElement, HookCallback, HookCleanup } from '../types.js';

/**
 * Runs a cleanup, reported on its own if it throws — a throwing teardown must neither stop the run it
 * precedes (one bad cleanup silenced its effect for good) nor the removal sweeping its siblings.
 */
export const runCleanup = (cleanup: HookCleanup, owner?: ComponentElement | null) => {
  try {
    cleanup();
  } catch (error) {
    reportHookError(error, owner ?? undefined);
  }
};

/**
 * **One hook, run at once on the first pass and then at most once per `schedule`, however many
 * writes land before it runs** — the shape `useRender`, `useEffect`, `useLayoutEffect` and
 * `useSyncEffect` all share, differing only in priority and in when `schedule` runs the pass.
 *
 * The deferred run re-enters through the hook itself: `now` is raised for exactly that one call, so
 * the hook's own wrapper provides the tracking context and the error isolation, as it does for
 * every other run. It is lowered before the callback runs, so a write the callback makes to state it
 * reads schedules another pass rather than recursing into one.
 *
 * Whatever the callback returns is its cleanup, run before its next run and when its owner is
 * removed — it is kept in the owner's `_cleanups`, which the removal sweeps (see `init`). An owner
 * that removed itself during this very run has already been swept, so its cleanup runs at once
 * rather than into a set nothing will drain again.
 *
 * @param callback The effect, or a render pass (which returns nothing)
 * @param priority Where it runs among its owner's hooks
 * @param schedule Runs the deferred pass, handed the owner — the render scheduler, a microtask, or at once
 * @param element The owner, instead of the element being set up
 * @return The hook, as `createHook` returns it
 */
/** The render scheduler, read at each scheduling so a swapped one takes effect at once — see `setRenderScheduler`. */
export const deferred = (run: () => void, owner?: Element | null) => renderScheduler(run, owner ?? undefined);

export const coalesce = (
  callback: HookCallback,
  priority: number,
  schedule: (run: () => void, owner?: ComponentElement | null) => void,
  element?: ComponentElement
) => {
  const owner = element ?? currentInstance.element;
  let queued = false;
  let now = false;
  let cleanup: void | HookCleanup;
  const hook = createHook({
    priority,
    element,
    callback: (signal, init) => {
      if (init || now) {
        now = false;
        if (cleanup) {
          owner?._cleanups?.delete(cleanup);
          /** Cleared first, so a callback that throws does not leave a spent cleanup to run again. */
          const spent = cleanup;
          cleanup = undefined;
          runCleanup(spent, owner);
        }
        cleanup = callback(signal, init);
        if (cleanup) {
          if (owner?._removed) runCleanup(cleanup, owner);
          else owner?._cleanups?.add(cleanup);
        }
        return;
      }
      if (queued) return;
      queued = true;
      schedule(() => {
        queued = false;
        now = true;
        hook!(signal);
        now = false;
      }, owner);
    },
  });
  return hook;
};
