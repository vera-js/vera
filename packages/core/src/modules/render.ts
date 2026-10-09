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
  /**
   * A bare `render()` commits the setup with nothing to draw — kept working, and development names `mount()`, the
   * word for it (main had this). It registers no render: a template of `undefined` would replace the root's content.
   */
  if (template === undefined) {
    if (__DEV__)
      console.warn(
        `[vera] render() was called with no template. That works — the setup is committed and the hooks run, exactly ` +
          `as with a template — but mount() is the name for it, and says so at the call site.\n\n` +
          `  import { mount } from '@verajs/core';\n  mount();\n`
      );
  } else useRender(template, element, ...args);
  commit(element);
};
