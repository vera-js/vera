import { currentInstance } from '../store/store.js';
import { noOwner } from './createHook.js';
import type { ComponentElement } from '../types.js';

/**
 * Ends a component's setup: runs the first pass of every hook registered since `init()`, in priority
 * order, then clears the current instance so the next component's `init()` starts clean. The whole of
 * `mount` and the second half of `render`.
 */
export const commit = (element: ComponentElement) => {
  firstPasses(element);
  currentInstance.element = null;
};

/**
 * The first pass of every hook registered since `init()`, in priority order — `commit` without clearing the current
 * instance, for the setup path, whose window already closed when its setup returned. Plain loops: no closure per
 * mount (C3).
 */
export const firstPasses = (element: ComponentElement) => {
  /** Development: this generation's setup was committed — what the never-committed check in `init` reads. */
  if (__DEV__) (element as { _committed?: number })._committed = element._gen;
  const all = element._hooks!;
  for (let i = 0; i < all.length; i++) for (const hook of all[i]!) hook({}, true);
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
  if (element === null) throw new Error(noOwner('mount()'));
  commit(element);
};
