import { useRender } from '../hooks/useRender.js';
import { currentInstance } from '../store/store.js';

/**
 * Declares a component's template and ends its setup — the closing half of the pair `init()` opens.
 * Runs the first pass of every hook registered since `init()`, then clears the current instance so
 * the next component's `init()` starts clean.
 *
 * ```js
 * connectedCallback() {
 *   init(this, { mode: 'open' });
 *   const state = createStore({ count: 0 });
 *   render(() => html`<button @click=${() => state.count++}>${state.count}</button>`);
 * }
 * ```
 *
 * @param template A function returning a template, or a template result. Re-run on every change to
 *   a store it reads.
 * @param args Any additional arguments to pass through to the renderer
 */
export const render = (template: unknown, ...args: unknown[]) => {
  const element = currentInstance.element;
  if (element === null) return;
  useRender(template, element, ...args);
  element._hooks!.forEach((hook) => hook({}, true));
  currentInstance.element = null;
};
