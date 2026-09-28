import { coalesce, deferred } from './coalesce.js';
import type { ComponentElement, HookCallback } from '../types.js';

/**
 * Runs `callback` after the component's first render, and again when the render scheduler next runs
 * (the next animation frame, by default) after any store it read changes — once, however many writes land. Return a cleanup to undo
 * what it set up; it runs before the next run.
 *
 * @param callback The effect
 * @param element The owner, instead of the element being set up
 */
export const useEffect = (callback: HookCallback, element?: ComponentElement) => {
  coalesce(callback, 75, deferred, element);
};
