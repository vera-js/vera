import type { RenderScheduler } from '../types.js';

export type { RenderScheduler } from '../types.js';

const animationFrame: RenderScheduler = (run) =>
  /** `typeof` rather than a bare reference: off-browser the global is undefined, not falsy. */
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : run();

export const microtask: RenderScheduler = (run) => {
  Promise.resolve().then(run);
};

export let renderScheduler: RenderScheduler = animationFrame;

/**
 * Bumped whenever the scheduler is replaced, so a pass queued under a scheduler that never ran it can
 * be recognised as stranded and queued again.
 *
 * A coalescing flag is raised before the pass is handed over and lowered inside it, so a scheduler
 * that drops the pass leaves the component frozen for the rest of the page. At the moment of
 * scheduling there is no way to tell a dropped pass from a deferred one — deferring is the whole job.
 * **Replacement is the moment where it becomes knowable**: whatever the old scheduler was holding is
 * provably never going to run, because nothing will ever call it again.
 *
 * A live binding, exactly as `revision` is in `@verajs/inserts`, and read on the coalescing guard's
 * early-return path only.
 */
export let schedulerGeneration = 0;

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
  /**
   * **Silent and total.** Every render and every effect is handed to the scheduler, so a
   * non-function means nothing is ever drawn and nothing ever runs — with no error, because nothing
   * calls it. The pass is scheduled; the schedule is the broken part.
   *
   * The cause is almost always an import that resolved to `undefined` — a name that moved packages,
   * a typo, a default-vs-named mix-up — and none of those are visible where the failure shows up.
   * `__DEV__`-only: production carries neither the check nor the text, and an app that does this in
   * production was already broken. This is the build that says why.
   */
  if (__DEV__ && typeof scheduler !== 'function')
    throw new Error(
      `setRenderScheduler: expected a function and received ${String(scheduler)}. It receives the ` +
        `render pass and decides when to run it — \`microtask\` is exported for that, and the default ` +
        `is requestAnimationFrame.`
    );
  const previous = renderScheduler;
  renderScheduler = scheduler;
  /** See `schedulerGeneration`: this is what lets a stranded pass be queued again. */
  schedulerGeneration++;
  return previous;
};
