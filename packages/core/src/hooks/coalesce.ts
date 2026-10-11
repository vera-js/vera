import { callable, MODE_QUEUED, MODE_SYNC, noOwner, register } from '../modules/createHook.js';
import { currentInstance } from '../store/store.js';
import type { ComponentElement, HookCallback } from '../types.js';

/**
 * **One hook, run at once on the first pass and then at most once per flush, however many writes land
 * before it runs** — the shape `useRender`, `useEffect`, `useLayoutEffect` and `useSyncEffect` all share,
 * differing only in priority and in whether a write queues the pass (`sync` runs it at once). The hook is one object
 * (`HookState`): a write remembers its signal and queues the hook itself, and the queued pass runs it tracked, so a
 * write the callback makes to state it reads queues another pass rather than recursing into one.
 *
 * Whatever the callback returns is its cleanup, run before its next run and when its owner is
 * removed — it is kept in the owner's `_$c$`, which the removal sweeps (see `init`).
 *
 * @param callback The effect, or a render pass (which returns nothing)
 * @param priority Where it runs: among its owner's hooks, and in the flush (render 50 → layout 60 → effect 75)
 * @param sync Runs the pass at once on every change instead of queueing it (`useSyncEffect`)
 * @param element The owner, instead of the element being set up
 * @return The hook
 */
export const coalesce = (callback: HookCallback, priority: number, sync: boolean, element?: ComponentElement) => {
  const owner = element ?? currentInstance.element;
  if (!owner) throw new Error(noOwner('a hook'));
  /** Refused, as `createHook` refuses: `NaN` is what `parseInt` of a config value produces. */
  if (!Number.isFinite(priority)) return;
  return register(owner, callback, priority, sync ? MODE_SYNC : MODE_QUEUED);
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
export const useHook = (callback: HookCallback, priority: number, element?: ComponentElement) => {
  const hook = coalesce(callback, priority, false, element);
  return hook && (callable(hook) as HookCallback);
};
