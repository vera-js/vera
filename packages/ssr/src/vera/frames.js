/**
 * `requestAnimationFrame` on a machine that has no frames: callbacks queue here and are drained after a
 * component's `connectedCallback` returns, which is where a browser would run them.
 */

/** Callbacks awaiting a frame that will not arrive on its own. */
export const frames = [];

/** Runs everything waiting on a frame, and everything those schedule in turn. */
export const flushFrames = () => {
  while (frames.length) for (const frame of frames.splice(0)) frame?.(performance.now());
};

/** The same drain, for a render that is allowed to wait. */
export const flushFramesAsync = async () => flushFrames();
