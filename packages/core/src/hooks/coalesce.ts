import { createHook, reportHookError } from '../modules/createHook.js';
import { currentInstance } from '../store/store.js';
import { enqueue } from '../modules/scheduler.js';
import type { ComponentElement, Hook, HookCallback, HookCleanup, HookPass } from '../types.js';

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

/** Every coalesced hook's creation, in order: the second half of the queue's key (`HookPass._k`). */
let created = 0;

/**
 * **One hook, run at once on the first pass and then at most once per flush, however many writes land
 * before it runs** — the shape `useRender`, `useEffect`, `useLayoutEffect` and `useSyncEffect` all share,
 * differing only in priority and in whether a write queues the pass (`sync` runs it at once).
 *
 * The deferred run re-enters through the hook itself: `now` is raised for exactly that one call, so
 * the hook's own wrapper provides the tracking context and the error isolation, as it does for
 * every other run. It is lowered before the callback runs, so a write the callback makes to state it
 * reads queues another pass rather than recursing into one.
 *
 * Whatever the callback returns is its cleanup, run before its next run and when its owner is
 * removed — it is kept in the owner's `_cleanups`, which the removal sweeps (see `init`). An owner
 * that removed itself during this very run has already been swept, so its cleanup runs at once
 * rather than into a set nothing will drain again.
 *
 * @param callback The effect, or a render pass (which returns nothing)
 * @param priority Where it runs: among its owner's hooks, and in the flush (render 50 → layout 60 → effect 75)
 * @param sync Runs the pass at once on every change instead of queueing it (`useSyncEffect`)
 * @param element The owner, instead of the element being set up
 * @return The hook, as `createHook` returns it
 */
export const coalesce = (callback: HookCallback, priority: number, sync: boolean, element?: ComponentElement) => {
  const owner = element ?? currentInstance.element;
  let now = false;
  let cleanup: void | HookCleanup;
  /** The signal of the first write since the last run — what the queued run is handed. */
  let queuedSignal: Parameters<HookCallback>[0] | undefined;
  /**
   * The pass a write queues — ONE closure per hook, never one per update (measured: a synchronous
   * effect's write 4–5% faster).
   */
  const run = (() => {
    const signal = queuedSignal;
    queuedSignal = undefined;
    now = true;
    hook!(signal!);
    now = false;
  }) as HookPass;
  run._k = priority * 1e9 + ++created;
  run._o = owner;
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
      queuedSignal ??= signal;
      if (sync) run();
      else enqueue(run);
    },
  });
  return hook;
};

/**
 * **`createHook`, as core exports it.** A hook of your own runs inside every write it hears; `scheduled: true` makes it
 * join the flush instead, at its own priority, exactly as the built-in hooks do — so a hook at 25 runs before the
 * render and reads the DOM as the last render left it (what `useLayoutEffect` did before it took React's meaning).
 */
export const createPublicHook = (hook: Hook) =>
  hook.scheduled ? coalesce(hook.callback!, hook.priority!, false, hook.element) : createHook(hook);
