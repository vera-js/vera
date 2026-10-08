import { coalesce } from './coalesce.js';
import type { ComponentElement, HookCallback } from '../types.js';

/**
 * Runs `callback` after the component's first render, and again in the next flush after any store it read changes —
 * once, however many writes land, after that flush's renders and before the browser paints (a microtask, by default:
 * after `await`, the DOM and its effects are current). A write it makes to state its component renders lands before
 * paint too: a hook may run twice in one flush, and a third run waits for the next frame. Return a cleanup to undo
 * what it set up; it runs before the next run.
 *
 * @param callback The effect
 * @param element The owner, instead of the element being set up
 */
export const useEffect = (callback: HookCallback, element?: ComponentElement) => {
  coalesce(callback, 75, false, element);
};
