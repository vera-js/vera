import { coalesce } from './coalesce.js';
import type { ComponentElement, HookCallback } from '../types.js';

/**
 * Like `useEffect`, but FIRST in its flush — before the render, on the first pass and after a change — so it reads
 * the DOM as the last render left it, and a write it makes lands in the render that follows, before the browser paints.
 *
 * @param callback The effect
 * @param element The owner, instead of the element being set up
 */
export const useLayoutEffect = (callback: HookCallback, element?: ComponentElement) => {
  coalesce(callback, 25, false, element);
};
