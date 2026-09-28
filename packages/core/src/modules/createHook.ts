import type { ComponentElement, Hook, HookCallback } from '../types.js';
import { currentInstance, hooksQueue } from '../store/store.js';
import { prioritySlot, reportUncaught } from '@verajs/shared-utils';
import { inserts } from '@verajs/inserts';
import type { ErrorInsert } from '@verajs/inserts';

/** Hoisted, so `prioritySlot` is not handed a fresh closure per registration. */
const newSet = () => new Set<HookCallback>();

/**
 * Hands a thrown hook error to the `'error'` insert chain, or reports it the way the platform reports
 * an uncaught error when nothing is registered — through `reportError`, so `window.onerror` and
 * page-error listeners see it (see `reportUncaught`).
 *
 * Never rethrown: an owner's hooks run in one loop, so an escaping error stopped every hook after
 * the failing one — a single bad effect took out its siblings.
 */
export const reportHookError = (error: unknown, element?: ComponentElement) => {
  const handlers = inserts.get('error');
  if (handlers?.length) handlers.forEach((handler) => (handler as ErrorInsert)(error, element));
  else reportUncaught(error, 'a hook threw:');
};

/**
 * The priority `useRender` registers at — between `useLayoutEffect` (25) and the effects (75), so a
 * component's first pass draws after its layout effects and before its effects.
 */
export const RENDER_PRIORITY = 50;

/**
 * Registers a hook on its owner — the element being set up, or `element` when given — and returns
 * the hook itself: run it and it records what it reads, which is how it is subscribed. A component
 * never needs the return value (`render()` runs the first pass); anything owning its own reactive
 * value does, and a `computed`'s owner is a plain object rather than an element.
 *
 * The owner holds the hook strongly, ordered by `priority` (lower runs first; `0` is legal and
 * earliest), and the store holds one weak reference to it — one per hook, so repeated runs add the
 * same entry to a subscription set.
 *
 * **A hook belongs to its owner's generation.** `init()` starts a new one every time an element
 * reconnects, and a hook from an older generation does nothing — otherwise the store, which only
 * holds it weakly, kept running it until a collection happened, and every reconnect doubled the
 * element's renders and effects. Bumping `_gen` is also how an owner retires its hooks deliberately
 * (`@verajs/directives` does, as teardown).
 *
 * Refused, returning `undefined`, when there is no owner or the priority is not a finite number —
 * `NaN` is what `parseInt` of a config value produces.
 *
 * A throw is isolated here (`reportHookError`), and this one wrapper is every entry: the first pass,
 * a write waking the hook, and a deferred pass — which re-enters through the hook rather than around
 * it — so no caller needs its own catch.
 */
export const createHook = ({ callback, priority, element }: Hook): HookCallback | undefined => {
  const owner = element ?? currentInstance.element;
  if (!owner || !callback || !Number.isFinite(priority)) return;
  const generation = owner._gen;
  const hook: HookCallback = (signal, init) => {
    if (owner._gen !== generation) return;
    hooksQueue.push(self);
    try {
      callback(signal, init);
    } catch (error) {
      reportHookError(error, owner);
    } finally {
      hooksQueue.pop();
    }
  };
  const self = new WeakRef(hook);
  prioritySlot((owner._hooks ??= []), (owner._hookPriorities ??= []), priority as number, newSet).add(hook);
  return hook;
};
