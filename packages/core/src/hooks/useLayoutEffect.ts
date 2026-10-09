import { coalesce } from './coalesce.js';
import type { ComponentElement, HookCallback } from '../types.js';

/**
 * Like `useEffect`, but right AFTER the render and before every `useEffect` — on the first pass and after a change —
 * so it reads the DOM the render just made, and a write it makes re-renders in the same flush, before the browser
 * paints: React's meaning (Brian, 2026-10-08; until then it ran before the render and saw the PREVIOUS render's DOM,
 * so a measurement ported from React silently measured stale layout).
 *
 * @param callback The effect
 * @param element The owner, instead of the element being set up
 */
export const useLayoutEffect = (callback: HookCallback, element?: ComponentElement) => {
  coalesce(callback, 60, false, element);
};
