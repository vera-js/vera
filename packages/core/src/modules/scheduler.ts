import type { ComponentElement, HookPass, RenderScheduler } from '../types.js';

/**
 * **One queue, drained by one flush.** Every deferred hook pass — a layout effect, a render, an effect — joins ONE
 * queue, and ONE scheduled flush runs it all; a scheduler decides only when a flush runs (Brian, 2026-10-08, after the
 * flood probe in the scheduler plan). The queue runs in KEY order: a pass's PRIORITY (layout 25 → render 50 → effect
 * 75), then its hook's CREATION — a parent's hooks are created before the children its render makes, so a child
 * re-rendered by its parent's new props runs once, after the parent; and one component's hooks run in the order it
 * registered them. A pass that arrives OUT of key order marks the queue, and the rest of it is sorted again before the
 * next pass is taken — the built-in sort, which merges a sorted run and a few new passes in linear time (smaller than
 * a heap). Passes queued in creation order — a store write waking its readers — never sort at all.
 */
let queue: HookPass[] = [];
let next = 0;
let unsorted = false;

/**
 * **The element window's next frame, or ~100 ms — whichever comes first** (the other is canceled). Where work that
 * must not run at once goes: past the budget, or a hook's third run in one flush. A visible window's frame always wins;
 * a hidden one has no frames, and its throttled timer runs instead (a runaway loop in a background tab costs almost
 * nothing); a window hidden WHILE waiting still recovers; and without `requestAnimationFrame` at all (a test, a server)
 * the timer is the one path — no visibility check anywhere.
 */
const frameOrTimer = (run: () => void, element?: Element) => {
  const view = (element?.ownerDocument?.defaultView ?? globalThis) as typeof globalThis;
  /** Each side cancels the other, so `run` runs once. */
  const go = () => {
    clearTimeout(timer);
    view.cancelAnimationFrame?.(frame!);
    run();
  };
  const timer = setTimeout(go, 100);
  const frame = view.requestAnimationFrame?.(go);
};

/**
 * **The budget: ~4 ms of flush work per 16 ms, by the clock.** Within it a flush runs as a microtask — the DOM, and
 * effects, are current as soon as the writing code yields; past it, the next flush waits for a frame. Measured on
 * three engines: one write reaches the DOM in 1–5 ms instead of 19–24, and fifty events landing in one frame still
 * render as they did on frames (a plain microtask rendered once per event: 4–7× slower). Reset by the CLOCK, never by
 * frames, so a hidden window, which has none, is never left with a spent budget. React's scheduler yields at 5 ms.
 */
const BUDGET = 4;
const WINDOW = 16;
let windowStart = -Infinity;
let spent = 0;

/** The default: a microtask within the budget, the element window's frame (or a timer) past it. */
const budgeted: RenderScheduler = (run, element) => {
  const now = performance.now();
  if (now - windowStart >= WINDOW) {
    windowStart = now;
    spent = 0;
  }
  if (spent < BUDGET) queueMicrotask(run);
  else frameOrTimer(run, element);
};

/** A plain microtask — every flush at once, however many land in a frame (no budget). */
export const microtask: RenderScheduler = (run) => queueMicrotask(run);

/** When flushes run. A live binding, read whenever one is scheduled. */
let renderScheduler: RenderScheduler = budgeted;

let scheduled = false;
let flushing = false;
let flushes = 0;
/** Development: the pass running now. */
let running: HookPass | undefined;

/**
 * Queues a hook's pass, once, and makes sure a flush is coming. A pass already queued is not queued twice. A flush
 * already running drains it; otherwise one is scheduled — and if the scheduler throws, the pass stays queued and the
 * next write asks again, so a broken scheduler never freezes a component for good.
 */
export const enqueue = (pass: HookPass) => {
  /** Development: which pass's run queued this one — the hook a loop warning names is the one that WRITES. */
  if (__DEV__) pass._b = flushing ? running : undefined;
  if (!pass._in) {
    pass._in = true;
    /** Only a pass arriving OUT of key order needs a sort — passes queued in creation order never pay one. */
    if (next < queue.length && pass._k < queue[queue.length - 1]._k) unsorted = true;
    queue.push(pass);
  }
  if (scheduled || flushing) return;
  scheduled = true;
  try {
    renderScheduler(flush, pass._o ?? undefined);
  } catch (error) {
    scheduled = false;
    throw error;
  }
};

/**
 * **At most TWO runs of a hook per flush; a third waits for the next frame.** A hook scheduled again by its own run
 * gets one more pass in the same flush — a measure-then-set lands before paint, and converges, because its second
 * measurement writes the same value, which the store ignores — and a third is a loop: held for the element window's
 * next frame (or the timer), where it is queued again, so a self-feeding pass runs twice per frame, runaway or
 * intended, and never freezes the tab. (Main ran it once per frame; Vue allows a hundred re-runs; React throws.) Each
 * held pass asks for its own frame: only a loop is ever held, so batching them is not worth its bytes.
 */
const hold = (pass: HookPass) => {
  if (__DEV__) loopWarning(pass);
  frameOrTimer(() => {
    if (__DEV__) pass._hf = 1;
    enqueue(pass);
  }, pass._o ?? undefined);
};

/**
 * **Runs every queued pass, now** — the scheduled flush, and an export: a test, or work that must see the DOM settled
 * (a View Transition's callback), calls it to drain synchronously. A call from inside a running flush does nothing:
 * that flush is already draining.
 */
export const flush = () => {
  if (flushing) return;
  scheduled = false;
  flushing = true;
  const flushId = ++flushes;
  const start = performance.now();
  try {
    while (next < queue.length) {
      if (unsorted) {
        queue = queue.slice(next).sort((a, b) => a._k - b._k);
        next = 0;
        unsorted = false;
      }
      const pass = queue[next++];
      pass._in = false;
      if (pass._f !== flushId) {
        pass._f = flushId;
        pass._r = 0;
      }
      if (++pass._r! > 2) hold(pass);
      else {
        if (__DEV__) running = pass;
        pass();
      }
    }
  } finally {
    queue = [];
    next = 0;
    flushing = false;
    spent += performance.now() - start;
  }
};

/**
 * Replaces the scheduler of FLUSHES and returns the one it replaced. A flush the old one was holding is asked of the
 * new one, so a scheduler that dropped it strands nothing (a second run finds the queue empty).
 *
 * @param scheduler Receives the flush, and the element whose pass asked for it, and decides when to run it — never
 *   whether. The default runs it as a microtask within a per-frame budget, and on the next frame past it.
 */
export const setRenderScheduler = (scheduler: RenderScheduler) => {
  const previous = renderScheduler;
  renderScheduler = scheduler;
  scheduled = next < queue.length;
  if (scheduled) scheduler(flush);
  return previous;
};

/* ── development: a self-feeding loop is named, once ─────────────────────────────────────────────────────────────── */

/** Consecutive frames a pass was held, before a development warning: React's `NESTED_PASSIVE_UPDATE_LIMIT`. */
const LIMIT = 50;
/** `@__PURE__`: read only in development, so production drops the allocations with the branch. */
const exempt = /* @__PURE__ */ new WeakSet<Element>();
const warned = /* @__PURE__ */ new WeakSet<Element>();

/** Which hook a priority is — the warning names the one that loops. */
const LABELS: Record<number, string> = { 25: 'useLayoutEffect', 50: 'render', 75: 'useEffect' };

const loopWarning = (pass: HookPass) => {
  /** Held again after a run its last hold queued: one more consecutive frame. Anything else starts a new count. */
  pass._s = pass._hf ? pass._s! + 1 : 1;
  pass._hf = 0;
  const element = pass._o;
  if (pass._s < LIMIT || !element || exempt.has(element) || warned.has(element)) return;
  warned.add(element);
  const writer = pass._b ?? pass;
  console.warn(
    `[vera] ${LABELS[Math.floor(writer._k / 1e9)] ?? 'a hook'} on <${element.localName}> has re-run for ${LIMIT} ` +
      `consecutive frames because it writes state it also reads — this will keep running for as long as the page ` +
      `is open.\nGuard the write (\`if (next !== state.x) state.x = next\`), or move it out of the pass. More than ` +
      `one hook may be involved: a template reading what an effect writes is caught here too.\nIf it is deliberate ` +
      `— an animation driven by one store write per frame — silence it with \`allowRenderLoop(this)\` from ` +
      `@verajs/core, or drive it with \`requestAnimationFrame\`.`
  );
};

/**
 * **Marks a component's self-feeding loop as deliberate**, silencing the development warning about it — an animation
 * written as one store write per pass. A hook that writes what it reads runs twice per flush and then once more per
 * frame; `requestAnimationFrame` is the plainer way to drive a frame loop. A no-op in production, where the warning
 * does not exist to silence.
 *
 * ```js
 * init(this);
 * allowRenderLoop(this);
 * useEffect(() => { state.t = state.t + 1 });
 * ```
 *
 * @param element The component whose loop is intentional
 */
export const allowRenderLoop = (element: ComponentElement) => {
  if (__DEV__) {
    if (!(element instanceof Element))
      throw new TypeError(`allowRenderLoop: expected the component element (\`this\`), received ${String(element)}.`);
    exempt.add(element);
  }
};
