import { currentInstance } from '../store/store.js';
import type { ComponentElement } from '../types.js';

/**
 * Ends a component's setup: runs the first pass of every hook registered since `init()`, in priority
 * order, then clears the current instance so the next component's `init()` starts clean. The whole of
 * `mount` and the second half of `render`.
 */
export const commit = (element: ComponentElement) => {
  element._hooks!.forEach((hooks) => hooks.forEach((hook) => hook({}, true)));
  currentInstance.element = null;
};

/**
 * Commits a component's setup without drawing anything — the closing half of the pair `init()` opens,
 * for a component whose whole job is a side effect. `render(template)` is this plus the template.
 *
 * ```js
 * connectedCallback() {
 *   init(this);
 *   const state = createStore({ online: navigator.onLine });
 *   useEffect(() => report(state.online));
 *   mount();
 * }
 * ```
 */
export const mount = () => {
  const element = currentInstance.element;
  if (element !== null) commit(element);
};
