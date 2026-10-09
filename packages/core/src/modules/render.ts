import { useRender } from '../hooks/useRender.js';
import { currentInstance } from '../store/store.js';
import { commit } from './mount.js';
import { noOwner } from './createHook.js';

/**
 * Declares a component's template and ends its setup — the closing half of the pair `init()` opens,
 * for a component that has markup. Exactly `useRender(template)` followed by {@link mount}'s commit.
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
  if (element === null) throw new Error(noOwner('render()'));
  useRender(template, element, ...args);
  commit(element);
};
