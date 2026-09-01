import { currentInstance } from '../store/store.js';
import { ComponentElement } from '../types.js';

/**
 * The element currently being set up, or `undefined` with a warning naming the caller.
 *
 * **Nothing is being set up, so there is nothing to commit.** `init()` opens a component's setup
 * and `mount()` closes it; a second close therefore has no instance to find, and used to return in
 * silence — the component ran whatever the *first* call committed and the second line of the file
 * did nothing at all.
 *
 * The three ways to arrive here all look like working code:
 *
 * - two closing calls in one `connectedCallback`, which is what a refactor leaves behind
 * - a closing call after an `await`, where the instance was cleared before the continuation ran
 * - a closing call from an event handler or a timer, long after setup finished
 *
 * The last is the one worth naming: re-rendering is what the *store* is for. Reading state inside
 * the template subscribes it, and a write re-renders — calling `render()` again is neither
 * necessary nor sufficient.
 *
 * Parameterised by caller so the message names the function the author actually wrote. It is the
 * same shape as `init()`'s "registered hooks but never closed the setup" warning, at the other end.
 *
 * `__DEV__`-only, so production carries neither the check nor the message.
 */
export const setupTarget = (caller: 'render' | 'mount'): ComponentElement | undefined => {
  const element = currentInstance.element?.deref();
  if (!element && __DEV__) {
    console.warn(
      `[vera] ${caller}() did nothing — no component is being set up.\n` +
        `It ends the setup started by init(), so it runs once, synchronously, inside ` +
        `connectedCallback. Calling it twice, after an \`await\`, or from a handler finds nothing ` +
        `to close.\nTo update after setup, write to a store the template reads.`
    );
  }
  return element;
};

/**
 * Ends a component's setup: runs the first pass of every hook registered since `init()`, then
 * clears the current instance so the next component's `init()` starts clean.
 *
 * Shared by `mount` and `render` — the *whole* of `mount` and the second half of `render`.
 */
export const commit = (element: ComponentElement) => {
  element.runHooks?.();
  currentInstance.element = null;
};

/**
 * Commits a component's setup without drawing anything. The closing half of the pair `init()` opens.
 *
 * ```js
 * connectedCallback() {
 *   init(this);
 *   const state = createStore({ online: navigator.onLine });
 *   useEffect(() => report(state.online));
 *   mount();
 * }
 * ```
 *
 * **`render(template)` is this plus the template** — `useRender(template)` followed by exactly the
 * call below. They are a base operation and a compound, not two ways to do one thing, which is why
 * a component only ever calls one of them.
 *
 * It exists because a component whose whole job is a side effect has nothing to draw, and the only
 * way to say so used to be a bare `render()` — legal, documented, and guessed by nobody. Hooks that
 * are never committed never run: no error, no render, an effect that simply does not happen. A name
 * that says *commit this component* is discoverable in a way that an argument you omit is not.
 */
export const mount = () => {
  const element = setupTarget('mount');
  if (element) commit(element);
};
