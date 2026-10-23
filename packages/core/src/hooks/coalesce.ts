import { finite, MODE_QUEUED, MODE_SYNC, noOwner, register } from '../modules/createHook.js';
import { currentInstance } from '../store/store.js';
import type { ComponentElement, HookCallback } from '../types.js';

/**
 * **One hook, run at once on the first pass and then at most once per flush, however many writes land
 * before it runs** — the shape the setup's returned render, `effect`, a `'layout'` effect and a `'sync'` effect all share,
 * differing only in priority and in whether a write queues the pass (`sync` runs it at once). The hook is one object
 * (`HookState`): a write remembers its signal and queues the hook itself, and the queued pass runs it tracked, so a
 * write the callback makes to state it reads queues another pass rather than recursing into one.
 *
 * Whatever the callback returns is its cleanup, run before its next run and when its owner is
 * removed — it is kept in the owner's `_$c$`, which the removal sweeps (see `init`).
 *
 * @param callback The effect, or a render pass (which returns nothing)
 * @param priority Where it runs: among its owner's hooks, and in the flush (render 50 → layout 60 → effect 75)
 * @param sync Runs the pass at once on every change instead of queueing it (a `'sync'` effect)
 * @param element The owner, instead of the element being set up
 * @return The hook
 */
export const coalesce = (callback: HookCallback, priority: number, sync: boolean, element?: ComponentElement) => {
  const owner = element ?? currentInstance.element;
  if (!owner) throw new Error(noOwner('a hook'));
  if (!finite(priority, 'effect')) return;
  return register(owner, callback, priority, sync ? MODE_SYNC : MODE_QUEUED);
};
