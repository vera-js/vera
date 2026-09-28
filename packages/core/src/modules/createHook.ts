import type { Hook, HookCallback } from '../types.js';
import { currentInstance, hooksQueue } from '../store/store.js';
import { prioritySlot } from '@verajs/shared-utils';

/** Hoisted, so `prioritySlot` is not handed a fresh closure per registration. */
const newSet = () => new Set<HookCallback>();

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
    } finally {
      hooksQueue.pop();
    }
  };
  const self = new WeakRef(hook);
  prioritySlot((owner._hooks ??= []), (owner._hookPriorities ??= []), priority as number, newSet).add(hook);
  return hook;
};
