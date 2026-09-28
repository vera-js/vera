import { coalesce } from './coalesce.js';
import type { ComponentElement, HookCallback } from '../types.js';

/**
 * Like `useEffect`, but runs before the render on the first pass and in a microtask after a change —
 * so it can read or adjust the DOM before the browser paints.
 *
 * @param callback The effect
 * @param element The owner, instead of the element being set up
 */
export const useLayoutEffect = (callback: HookCallback, element?: ComponentElement) => {
  coalesce(callback, 25, queueMicrotask, element);
};
