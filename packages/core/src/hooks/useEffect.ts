import { coalesce } from './coalesce.js';
import type { ComponentElement, HookCallback } from '../types.js';

/**
 * Runs `callback` after the component's first render, and again on the next animation frame after
 * any store it read changes — once per frame, however many writes land. Return a cleanup to undo
 * what it set up; it runs before the next run.
 *
 * @param callback The effect
 * @param element The owner, instead of the element being set up
 */
export const useEffect = (callback: HookCallback, element?: ComponentElement) => {
  coalesce(callback, 75, requestAnimationFrame, element);
};
