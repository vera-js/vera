import type { HookCallback } from '../types.js';
import { currentInstance, hooksQueue } from '../store/store.js';

/**
 * Registers a hook on the element being set up, and returns the hook itself: run it and it records
 * what it reads, which is how it is subscribed. The element holds it strongly and the store holds a
 * weak reference — one per hook, so repeated runs add the same entry to a subscription set.
 *
 * @param callback Run on the first pass and again whenever a store it read changes
 */
export const createHook = (callback: HookCallback): HookCallback | undefined => {
  const element = currentInstance.element;
  if (element === null) return;
  const hook: HookCallback = (signal, init) => {
    hooksQueue.push(self);
    try {
      callback(signal, init);
    } finally {
      hooksQueue.pop();
    }
  };
  const self = new WeakRef(hook);
  element._hooks!.add(hook);
  return hook;
};
