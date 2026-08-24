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

