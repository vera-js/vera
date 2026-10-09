import { createHook, reportHookError } from '../modules/createHook.js';
import { currentInstance } from '../store/store.js';
import { enqueue } from '../modules/scheduler.js';
import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import type { ComponentElement, HookCallback, HookCleanup, HookPass } from '../types.js';

/**
 * Runs a cleanup, reported on its own if it throws — a throwing teardown must neither stop the run it
 * precedes (one bad cleanup silenced its effect for good) nor the removal sweeping its siblings.
 */
export const runCleanup = (cleanup: HookCleanup, owner?: ComponentElement | null) => {
  try {
    cleanup();
  } catch (error) {
    /** Named as a CLEANUP (main did): the hook ran fine — what threw is what it returned. */
    reportHookError(error, owner ?? undefined, 'a cleanup threw:');
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
  /** Development: an async callback is named once per hook, not on every run. */
  let warnedAsync = false;
  /** Development: how deep a SYNC hook's own writes have re-entered it (`useSyncEffect`). */
  let depth = 0;
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
        const out = callback(signal, init);
        /**
         * Only a FUNCTION is a cleanup. An `async` callback returns a promise, which was called as one on the next run
         * and on removal — `[vera] a hook threw:` twice (measured 2026-10-09). Now an async effect just runs.
         */
        cleanup = typeof out === 'function' ? out : undefined;
        if (__DEV__ && !warnedAsync && typeof (out as { then?: unknown } | undefined)?.then === 'function') {
          warnedAsync = true;
          const hook = priority === 60 ? 'useLayoutEffect' : priority === 75 ? (sync ? 'useSyncEffect' : 'useEffect') : 'useHook';
          console.warn(diagnostic('core', `${hook}${owner?.localName ? ` on <${owner.localName}>` : ''}`, 'async-callback', __DEV__ && PROSE['async-callback']()));
        }
        if (cleanup) {
          if (owner?._removed) runCleanup(cleanup, owner);
          else owner?._cleanups?.add(cleanup);
        }
        return;
      }
      queuedSignal ??= signal;
      if (sync) {
        /**
         * **A self-feeding `useSyncEffect` is stopped and named at depth 50, in development** — it runs inside every
         * write, so an unguarded write to what it reads recursed to a stack overflow, which names the trap and not the
         * cause (main had this guard; the lean rebuild dropped it while README and llms.txt still promised it).
         * Production carries neither the counter nor the check.
         */
        if (__DEV__) {
          if (depth >= 50) {
            queuedSignal = undefined;
            console.error(diagnostic('core', 'useSyncEffect', 'sync-loop', __DEV__ && PROSE['sync-loop']()));
            return;
          }
          depth++;
          try {
            run();
          } finally {
            depth--;
          }
        } else run();
      }
      else enqueue(run);
    },
  });
  return hook;
};

/**
 * **A hook of your own, scheduled as the built-in ones are**, at a priority you choose: one run per flush, after every
 * write in it, and a returned function is its cleanup (render 50, `useLayoutEffect` 60, `useEffect` 75). At 25 it runs
 * before the render and reads the DOM as the last render left it. `createHook` is the raw primitive under it, which
 * runs inside every write it hears, unbatched — what a `computed` needs. (Brian, 2026-10-08: a name, not a flag.)
 *
 * @param callback The effect: handed the change and whether this is the first pass
 * @param priority Where it runs in a flush — lower first
 * @param element The owner, instead of the element being set up
 */
export const useHook = (callback: HookCallback, priority: number, element?: ComponentElement) =>
  coalesce(callback, priority, false, element);
