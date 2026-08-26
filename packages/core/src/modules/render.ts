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
  if (!element) {
    /**
     * **Nothing is being set up, so there is nothing to render into.**
     *
     * `render()` ends a component's setup: it runs the first pass of every hook registered since
     * `init()` and then clears the current instance. A second call therefore has no instance to
     * find, and used to return in silence — the component drew whatever the *first* call declared
     * and the second line of the file did nothing at all.
     *
     * The three ways to arrive here all look like working code:
     *
     * - two `render()` calls in one `connectedCallback`, which is what a refactor leaves behind
     * - `render()` after an `await`, where the instance was cleared before the continuation ran
     * - `render()` from an event handler or a timer, long after setup finished
     *
     * The last is the one worth naming: re-rendering is what the *store* is for. Reading state
     * inside the template subscribes it, and a write re-renders — calling `render()` again is
     * neither necessary nor sufficient.
     *
     * `__DEV__`-only, so production carries neither the check nor the message. This is the same
     * shape as `init()`'s "registered hooks but never called render()" warning, at the other end.
     */
    if (__DEV__) {
      console.warn(
        `[vera] render() did nothing — no component is being set up.\n` +
          `It ends the setup started by init(), so it runs once, synchronously, inside ` +
          `connectedCallback. Calling it twice, after an \`await\`, or from a handler finds nothing ` +
          `to render into.\nTo update after setup, write to a store the template reads.`
      );
    }
    return;
  }

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
