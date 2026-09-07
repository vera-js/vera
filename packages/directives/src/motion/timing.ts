/**
 * The contract between a curve and whatever shapes it.
 *
 * Only the type lives here. The implementations — the bezier solver, the step
 * function, the keyword table — moved to `@verajs/motion/easings`, because
 * `linear` is the default and a page that never leaves it was paying 384 bytes
 * for a solver it never called.
 *
 * A type costs nothing at runtime, so the core keeps it: `curve.ts` needs to
 * name what it holds, and a module needs to name what it returns.
 *
 * **`ease` and `inertia-ease` are still different things.** This shapes the
 * *curve* — value against scroll position — and is evaluated per segment, as
 * `@keyframes` does. `inertia-ease` is handed to CSS and shapes the catch-up.
 * Same vocabulary, validated by the same `parseEasing`; do not merge them.
 */

/** Progress in, progress out. Both nominally 0-1, though a bezier may overshoot. */
export type Easing = (progress: number) => number;
