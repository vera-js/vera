/**
 * `requestAnimationFrame` on a machine that has no frames. Callbacks queue here and are drained once a
 * component's `connectedCallback` has returned — where a browser would run them, so a component's own
 * ordering holds (work scheduled before `render()` still sees the template) — and drained REPEATEDLY, so
 * the markup is where the client settles: an effect that derives state schedules another render, which is
 * another frame.
 */

/** One queued callback: handed the frame's timestamp, and allowed to return a promise — the asynchronous drain awaits it. */
type Frame = (time: number) => unknown;

/** Where a frame callback's throw is reported, so the render can fail naming the component. */
type FrameReport = (error: unknown) => void;

/**
 * **Callbacks awaiting a frame that will not arrive on its own, by the id they were given.** The ids are the
 * platform's: unique and increasing for the life of the page, never reused, and a cancel of one that already ran, or
 * of one that never existed, does nothing. They used to be queue positions, which restarted at 1 after every drain,
 * so a component canceling its OWN finished frame deleted whichever callback now sat at that position; and a cancel
 * from inside a frame never reached a callback of the same frame, already taken off the queue. A `Map` keeps the order
 * they were requested in, which is the order they run.
 */
const frames = new Map<number, Frame>();
/** The ids that are idle callbacks: a browser keeps those apart, so `cancelIdleCallback` never cancels a frame. */
const idle = new Set<number>();
let lastId = 0;

/** `requestAnimationFrame` (`isIdle` false) and `requestIdleCallback` (true): queue `fn`, answer its id. */
export const requestFrame = (fn: Frame, isIdle: boolean): number => {
  const id = ++lastId;
  frames.set(id, fn);
  if (isIdle) idle.add(id);
  return id;
};

/** `cancelAnimationFrame`/`cancelIdleCallback`: drops the callback with that id, if it is still waiting and of that kind. */
export const cancelFrame = (id: number, isIdle: boolean): void => {
  if (idle.has(id) !== isIdle) return;
  frames.delete(id);
  idle.delete(id);
};

/**
 * One round: every callback waiting when it starts — those a callback schedules have later ids and run in the NEXT
 * round, as the next frame — each taken off as it runs, so a callback canceling a later one of the same round stops
 * it, exactly as a browser's frame does. Walked in place: a `Map` iterates in insertion order, skips entries deleted
 * mid-walk and stops here at the round's last id, so a round allocates nothing (a copied id list per round cost a page
 * of 100 components 17% at steady state).
 */
const round = (report: FrameReport | undefined): void => {
  const last = lastId;
  for (const [id, fn] of frames) {
    if (id > last) break;
    frames.delete(id);
    if (idle.size !== 0) idle.delete(id);
    run(fn, report);
  }
};
/** A loop that never settles leaves work queued; it must not reach the next component. */
const discard = (): void => {
  if (frames.size !== 0) frames.clear();
  if (idle.size !== 0) idle.clear();
};

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
const run = (frame: Frame, report?: FrameReport): unknown => {
  try {
    return frame(performance.now());
  } catch (error) {
    report?.(error);
  }
};

/** Runs everything waiting on a frame, and everything those schedule, up to the bound. */
export const flushFrames = (report?: FrameReport): void => {
  for (let count = 0; count < FRAME_ROUNDS && frames.size !== 0; count++) round(report);
  discard();
};

/**
 * The same drain, for a render allowed to wait. A frame callback that starts asynchronous work —
 * a router's first `navigate()`, awaiting guards and a route module — returns a promise the markup
 * depends on, so it is awaited, and the microtask queue runs between rounds (`await null`, not a timer,
 * so no unrelated request interleaves). **An empty queue is not the end** while such work is in flight:
 * it takes three consecutive empty turns to conclude that nothing more is coming.
 */
export const flushFramesAsync = async (report?: FrameReport): Promise<void> => {
  for (let round = 0, empty = 0; round < FRAME_ROUNDS && empty < 3; round++) {
    await null;
    if (!frames.size) {
      empty++;
      continue;
    }
    empty = 0;
    /** The same in-place round as `round`, each callback awaited before the next. */
    const last = lastId;
    for (const [id, fn] of frames) {
      if (id > last) break;
      frames.delete(id);
      if (idle.size !== 0) idle.delete(id);
      try {
        await run(fn, report);
      } catch (error) {
        report?.(error);
      }
    }
  }
  discard();
};
