/**
 * `requestAnimationFrame` on a machine that has no frames.
 *
 * A server render is one shot: nothing scheduled after the markup is built can reach it. Callbacks
 * are queued here and drained by `flushFrames` once a component's `connectedCallback` has returned,
 * which is where a browser would run them — deferring is what makes a component's own ordering hold,
 * and draining *repeatedly* is what makes the markup match where the client settles.
 */

/** Callbacks awaiting a frame that will not arrive on its own. See `flushFrames`. */
export const frames = [];

/**
 * How many rounds of frames a single server render will run.
 *
 * Deferring until after `connectedCallback` is what a browser does, and it is what makes a
 * component's own ordering hold: work scheduled before `render()` still sees the template. Draining
 * *repeatedly* is what makes the markup match where the client settles — an effect that derives
 * state schedules a re-render, which is another frame, and stopping after one would ship the
 * half-settled DOM this whole area exists to avoid.
 *
 * The bound is for the component that schedules a frame from inside a frame forever: an animation
 * loop, which is browser-only code that happens to be reachable here. It runs a few times and stops
 * rather than hanging the request.
 */
const FRAME_ROUNDS = 20;

/**
 * Runs everything waiting on a frame, and everything those schedule in turn.
 *
 * Called once per component, after `connectedCallback` — not inside `requestAnimationFrame` itself.
 * Running each callback immediately looked equivalent and was not: two state changes in a row
 * re-rendered twice where a browser coalesces them into one, and anything scheduled before
 * `render()` ran against a component that had not drawn yet.
 */
export const flushFrames = (report) => {
  for (let round = 0; round < FRAME_ROUNDS && frames.length; round++) {
    const batch = frames.splice(0, frames.length);
    for (const frame of batch) {
      /**
       * One failing callback does not take the others down, because a browser runs each frame
       * callback independently and reports a throw rather than abandoning the frame. It is not
       * *swallowed* either — `report` collects it, and the render fails at the end naming the
       * component, the same way a hook error does.
       */
      try {
        frame?.(performance.now());
      } catch (error) {
        report?.(error);
      }
    }
  }
  /** A loop that never settles leaves work queued; it must not reach the next component. */
  frames.length = 0;
};


/**
 * The same drain, for a render that is allowed to wait.
 *
 * A frame callback that starts asynchronous work — `navigate()` is the one that matters, and it is
 * why a routed component renders an empty outlet today — returns a promise the synchronous drain
 * cannot see. Letting the microtask queue run between rounds is what allows that work to finish and
 * whatever it schedules to be picked up by the next round.
 *
 * `await null` rather than a timer: it yields to the microtask queue, which is where a settled
 * promise's continuation is waiting, without handing control to the event loop and letting an
 * unrelated request interleave more than it already can.
 */
export const flushFramesAsync = async (report) => {
  /**
   * **An empty queue is not the end.** Work started inside a frame may still be in flight — a
   * `navigate()` awaits its guards and its route module before it renders anything — so stopping at
   * the first empty round ended the drain while the thing it was waiting for had not finished. It
   * takes a few consecutive empty turns to conclude that nothing more is coming.
   */
  let idle = 0;
  for (let round = 0; round < FRAME_ROUNDS; round++) {
    /** Anything already queued runs first, then whatever it scheduled becomes the next round. */
    await null;
    if (!frames.length) {
      if (++idle >= 3) break;
      continue;
    }
    idle = 0;
    const batch = frames.splice(0, frames.length);
    for (const frame of batch) {
      try {
        /**
         * **Awaited, unlike the synchronous drain.** A frame callback that returns a promise is
         * doing work the markup depends on — the router's initial `navigate()` is exactly that — and
         * ignoring it let the render finish while the route was still resolving. The callback ran,
         * the route resolved a moment later, and the outlet went out empty.
         */
        await frame?.(performance.now());
      } catch (error) {
        report?.(error);
      }
    }
  }
  frames.length = 0;
};
