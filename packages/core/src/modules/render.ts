import { useRender } from '../hooks/useRender.js';
import { commit, setupTarget } from './mount.js';

/**
 * Declares a component's template and ends its setup. The closing half of the pair `init()` opens,
 * for a component that has markup.
 *
 * ```js
 * connectedCallback() {
 *   init(this, { mode: 'open' });
 *   const state = createStore({ count: 0 });
 *   render(() => html`<button @click=${() => state.count++}>${state.count}</button>`);
 * }
 * ```
 *
 * Exactly `useRender(template)` followed by {@link mount} — a compound over the base operation, not
 * a second way to do the same thing. A component with no markup calls `mount()` instead.
 *
 * The template is **required**. It used to be optional, and omitting it was how a side-effect-only
 * component committed its setup: a bare `render()` that rendered nothing, which is a contradiction
 * the docs had to keep apologising for and which nobody guessed was legal. `mount()` says the same
 * thing in a way that can be found. Passing `undefined` explicitly still commits — refusing would
 * turn a spelling preference into effects that silently never run — but it warns in development.
 *
 * @param template A function returning a template, or a template result. Re-run on every change to
 *   a store it reads.
 * @param args Any additional arguments to pass through to the renderer
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const render = (template: unknown, ...args: any[]) => {
  const element = setupTarget('render');
  if (!element) return;

  if (template === undefined) {
    /**
     * Reached only from JavaScript — TypeScript rejects the missing argument outright. Buildless is
     * a first-class mode here and has no compiler, so this is the only signal those callers get.
     *
     * It commits anyway. Refusing would convert a naming preference into a component whose effects
     * never run, which is the exact failure `mount()` exists to prevent; and every other guard in
     * this framework warns and then does the understandable thing rather than throwing on input it
     * can read perfectly well.
     *
     * `__DEV__`-only, so production carries neither the check nor the message.
     */
    if (__DEV__)
      console.warn(
        `[vera] render() needs a template. If this component has no markup, call mount() instead — ` +
          `it commits the setup and runs the hooks, which is what a bare render() used to do.\n\n` +
          `  import { mount } from '@verajs/core';\n` +
          `  mount();\n`
      );
  } else {
    useRender(template, element, ...args);
  }

  commit(element);
};
