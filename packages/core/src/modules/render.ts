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
export const render = (template?: unknown, ...args: any[]) => {
  const element = currentInstance.element?.deref();
  if (!element) return;

  /**
   * No template means there is nothing to draw — only the setup to commit.
   *
   * `render()` has always ended a component's setup as well as declaring its markup: it runs the
   * first pass of every hook registered since `init()`, then clears the current instance. A
   * component whose whole job is a side effect has nothing to draw and used to write
   * `render(() => html``)` to get its effects to run at all, which is ceremony that pretends to
   * draw. Calling it bare says the true thing instead, and keeps one concept rather than adding a
   * second function to choose between.
   *
   * Existing light DOM is left alone, since nothing renders into it.
   */
  if (template !== undefined) useRender(template, element, ...args);

  element.runHooks?.();

  currentInstance.element = null;
};
