import { currentInstance } from '../store/store.js';
import { useRender } from '../hooks/useRender.js';

/**
 * When a change is detected, useRender renders the provided template into the element later than
 * useLayoutEffect but earlier than useEffect.
 *
 * @param template Template to render. Should be a function that can be called with the result passed to the renderer
 * @param args Any additional args that should be passed to the renderer
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const render = (template: unknown, ...args: any[]) => {
  const element = currentInstance.element?.deref();
  if (!element) return;

  useRender(template, element, ...args);

  element.runHooks?.();

  currentInstance.element = null;
};
