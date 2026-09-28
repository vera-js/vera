/**
 * `requestAnimationFrame` on a machine that has no frames. Callbacks queue here and are drained once a
 * component's `connectedCallback` has returned — where a browser would run them, so a component's own
 * ordering holds (work scheduled before `render()` still sees the template) — and drained REPEATEDLY, so
 * the markup is where the client settles: an effect that derives state schedules another render, which is
 * another frame.
 */

/** Callbacks awaiting a frame that will not arrive on its own. */
export const frames = [];

/**
 * How many rounds one render drains. The bound is for a component that schedules a frame from inside a
 * frame forever — an animation loop, browser-only code reachable here — which runs a few times and stops
 * rather than hanging the request.
 */
const FRAME_ROUNDS = 20;

/**
 * One frame callback, isolated: a browser runs each independently and reports a throw rather than
 * abandoning the frame, and here the throw is REPORTED (`report`) so the render fails naming the
 * component, the way a hook error does.
 */
const run = (frame, report) => {
  try {
    return frame?.(performance.now());
  } catch (error) {
    report?.(error);
  }
};

/** Runs everything waiting on a frame, and everything those schedule, up to the bound. */
export const flushFrames = (report) => {
  for (let round = 0; round < FRAME_ROUNDS && frames.length; round++)
    for (const frame of frames.splice(0)) run(frame, report);
  /** A loop that never settles leaves work queued; it must not reach the next component. */
  frames.length = 0;
};

/**
 * The same drain, for a render allowed to wait. A frame callback that starts asynchronous work —
 * a router's first `navigate()`, awaiting guards and a route module — returns a promise the markup
 * depends on, so it is awaited, and the microtask queue runs between rounds (`await null`, not a timer,
 * so no unrelated request interleaves). **An empty queue is not the end** while such work is in flight:
 * it takes three consecutive empty turns to conclude that nothing more is coming.
 */
export const flushFramesAsync = async (report) => {
  for (let round = 0, idle = 0; round < FRAME_ROUNDS && idle < 3; round++) {
    await null;
    if (!frames.length) {
      idle++;
      continue;
    }
    idle = 0;
    for (const frame of frames.splice(0)) {
      try {
        await run(frame, report);
      } catch (error) {
        report?.(error);
      }
    }
  }
  frames.length = 0;
};
