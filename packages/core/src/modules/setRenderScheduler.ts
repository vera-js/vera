import type { RenderScheduler } from '../types.js';

/**
 * The default: the next animation frame **of the element's own window**. `requestAnimationFrame` ticks
 * per window, so a component moved into a popped-out window or an iframe was redrawn on the opener's
 * clock — and froze when the opener's tab was hidden. The global is the fallback for a pass with no
 * element (a `computed`'s owner is a plain object), and with no `requestAnimationFrame` at all (a test,
 * a server) the pass runs at once.
 */
const animationFrame: RenderScheduler = (run, element) => {
  const view = (element?.ownerDocument?.defaultView ?? globalThis) as typeof globalThis;
  if (typeof view.requestAnimationFrame === 'function') view.requestAnimationFrame(run);
  else run();
};

/** A microtask: the DOM updates before the browser paints, possibly more than once per frame. */
export const microtask: RenderScheduler = (run) => queueMicrotask(run);

/** When render passes and `useEffect` runs happen. A live binding, read when a pass is scheduled. */
export let renderScheduler: RenderScheduler = animationFrame;

/**
 * Replaces the render scheduler, and **returns the one it replaced** — which is what makes a temporary
 * swap possible, and a temporary swap is the only way to render synchronously (the View Transitions API
 * snapshots the DOM around a callback, and a pass deferred to the next frame lands after the snapshot):
 *
 * ```js
 * const flushSync = (fn) => {
 *   const previous = setRenderScheduler((run) => run());
 *   try { fn(); } finally { setRenderScheduler(previous); }
 * };
 * ```
 *
 * @param scheduler Receives each pass (and the element it belongs to, when there is one) and decides
 *   when to run it — never whether.
 */
export const setRenderScheduler = (scheduler: RenderScheduler) => {
  const previous = renderScheduler;
  renderScheduler = scheduler;
  return previous;
};
