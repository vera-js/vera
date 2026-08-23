import { currentInstance } from '../store/store.js';

/**
 * End a component's setup without rendering anything.
 *
 * `render()` does two jobs: it declares what to draw, and it commits the setup — running the first
 * pass of every hook registered since `init()`. A component whose whole job is a side effect
 * (analytics, syncing, focus management, a store subscription) has nothing to draw and used to have
 * to write `render(() => html``)` to get its effects to run at all. This is the same commit,
 * without the pretence.
 *
 * ```js
 * connectedCallback() {
 *   init(this);
 *   useEffect(() => track(session.page));
 *   commit();
 * }
 * ```
 *
 * Deliberately explicit rather than scheduled. Committing automatically after `connectedCallback`
 * was the alternative, and it would have run a headless component's effects a microtask later than
 * a rendering component's — the same code with two different orderings depending on whether it drew
 * anything. One rule is worth more than the saved line.
 */
export const commit = () => {
  const element = currentInstance.element?.deref();
  if (!element) return;
  element.runHooks?.();
  currentInstance.element = null;
};
