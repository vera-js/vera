import { coalesce } from './coalesce.js';
import type { ComponentElement, HookCallback } from '../types.js';

/**
 * Like `useEffect`, but runs synchronously on every change rather than once per flush — for work
 * that must see each value, not only the last. A write it makes to state it reads re-enters it at
 * once, so guard such writes.
 *
 * @param callback The effect
 * @param element The owner, instead of the element being set up
 */
export const useSyncEffect = (callback: HookCallback, element?: ComponentElement) => {
  coalesce(callback, 75, true, element);
};
