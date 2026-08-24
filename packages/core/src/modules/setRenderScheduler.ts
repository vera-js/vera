/**
 * How a re-render is deferred. Swappable for the same reason `setHtml` and `setRenderer` are: the
 * right answer depends on the app, and the framework should not decide it for you.
 *
 * The default is an animation frame, which aligns updates to the display and coalesces naturally.
 * The cost is a frame boundary: work scheduled in `requestAnimationFrame` leaves the browser only
 * the remainder of that frame to lay out and paint, which shows up as latency on large updates.
 *
 * A microtask is what Lit and Vue use — the DOM is updated immediately and the browser gets the
 * whole frame to paint. Usually faster for big trees, at the cost of possibly running more than
 * once per frame if writes straddle microtask boundaries.
 */
export type RenderScheduler = (run: () => void) => void;

const animationFrame: RenderScheduler = (run) =>
  /** `typeof` rather than a bare reference: off-browser the global is undefined, not falsy. */
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : run();

export const microtask: RenderScheduler = (run) => {
  Promise.resolve().then(run);
};

export let renderScheduler: RenderScheduler = animationFrame;

/**
 * Replaces the render scheduler, and **returns the one it replaced**.
 *
 * ```js
 * import { setRenderScheduler, microtask } from '@verajs/core';
 * setRenderScheduler(microtask);
 * ```
 *
 * Returning the previous scheduler is what makes a temporary swap possible, and a temporary swap is
 * the only way to render *synchronously* — which the View Transitions API requires, since it
 * snapshots the DOM around a callback and a render deferred to the next frame happens after the
 * snapshot is taken:
 *
 * ```js
 * const flushSync = (fn) => {
 *   const previous = setRenderScheduler((run) => run());
 *   try { fn(); } finally { setRenderScheduler(previous); }
 * };
 *
 * document.startViewTransition(() => flushSync(() => { state.rows = next; }));
 * ```
 *
 * Without the return there is no way to read the current scheduler, so `flushSync` could only guess
 * what to restore — and would silently undo an app's own `microtask` choice. Four lines in userland
 * rather than a `flushSync` export, because the swap is the whole mechanism and hiding it would
 * make the frame boundary harder to reason about, not easier.
 *
 * @param scheduler Receives the render pass and decides when to run it
 * @return The scheduler that was in effect until now
 */
export const setRenderScheduler = (scheduler: RenderScheduler) => {
  const previous = renderScheduler;
  renderScheduler = scheduler;
  return previous;
};
