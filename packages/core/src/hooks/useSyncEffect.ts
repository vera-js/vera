import { coalesce } from './coalesce.js';
import type { ComponentElement, HookCallback } from '../types.js';

/** Runs the pass at once — `coalesce` with nothing to wait for. */
const now = (run: () => void) => run();

/**
 * Like `useEffect`, but runs synchronously on every change rather than once per frame — for work
 * that must see each value, not only the last. A write it makes to state it reads re-enters it at
 * once, so guard such writes.
 *
 * @param callback The effect
 * @param element The owner, instead of the element being set up
 */
export const useSyncEffect = (callback: HookCallback, element?: ComponentElement) => {
  coalesce(callback, 75, now, element);
};
