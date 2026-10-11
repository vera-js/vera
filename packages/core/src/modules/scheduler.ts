import { diagnostic, misuse } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import type { ComponentElement, HookPass, RenderScheduler } from '../types.js';

/**
 * **One queue, drained by one flush.** Every deferred hook pass — a layout effect, a render, an effect — joins ONE
 * queue, and ONE scheduled flush runs it all; a scheduler decides only when a flush runs (Brian, 2026-10-08, after the
 * flood probe in the scheduler plan). The queue runs in KEY order: a pass's PRIORITY (render 50 → layout
 * 60 → effect 75), then its hook's CREATION — a parent's hooks are created before the children its render makes, so a child
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

/** A plain microtask — every flush at once, however many land in a frame. THE DEFAULT (Brian, 2026-10-09). */
export const microtask: RenderScheduler = (run) => queueMicrotask(run);

/**
 * **The opt-in flood scheduler: ~4 ms of flush work per 16 ms, by the clock.** Within it a flush runs as a microtask;
 * past it, the next flush waits for the element window's frame (or a timer), so a burst of data arriving as many tasks
 * in one frame renders about once per frame. Measured 2026-10-09: it buys nothing on user input (the browser already
 * merges it — 300 raw mouse moves reached the page as 2 events) and 2–4× on a data burst — 50 messages as 50 tasks,
 * time to final DOM: Chrome 18 vs 61 ms, Firefox 19 vs 142, WebKit 32 vs 115 — the only scheduler that merges the burst
 * on all three engines. The trade, and why it is not the default: past the budget, `await` resolves before the DOM is
 * current; code reading it then calls `flush()`. Its accounting lives HERE, so the default pays nothing for it.
 *
 * The CLOCK is the one deliberate exception to "always the element's own window": one budget for the one event loop
 * every same-origin window shares, and each window's `performance.now()` counts from its own origin — a start read in
 * the opener and a "now" read in a pop-out would subtract to an offset, not a duration.
 */
const BUDGET = 4;
const WINDOW = 16;
let windowStart = -Infinity;
let spent = 0;
export const frameBudget: RenderScheduler = (run, element) => {
  const now = performance.now();
  if (now - windowStart >= WINDOW) {
    windowStart = now;
    spent = 0;
  }
  const timed = () => {
    const start = performance.now();
    run();
    spent += performance.now() - start;
  };
  if (spent < BUDGET) queueMicrotask(timed);
  else frameOrTimer(timed, element);
};

/** When flushes run. A live binding, read whenever one is scheduled. */
let renderScheduler: RenderScheduler = microtask;

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
    renderScheduler(drain, pass._o ?? undefined);
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
 * **Runs every queued pass, now** — what a scheduler runs. A call from inside a running flush does nothing: that flush
 * is already draining, and draining again from inside a hook would re-enter the renderer mid-commit (React's
 * `flushSync` makes the same choice).
 */
const drain = () => {
  if (flushing) return;
  scheduled = false;
  flushing = true;
  const flushId = ++flushes;
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
    /**
     * Development: `running` and each pass's `_b` are read only DURING a flush (the loop warning names the writer), and
     * left set they kept the last hooks that ran — and through them their components — alive after removal, in
     * development only (found 2026-10-10 by tests/core-subscription-sweep's re-render row: one hook left, dev only).
     */
    if (__DEV__) {
      for (let i = 0; i < queue.length; i++) queue[i]._b = undefined;
      running = undefined;
    }
    queue = [];
    next = 0;
    flushing = false;
  }
};

/**
 * **`flush()`, as core exports it: runs everything queued, synchronously** — a test, or work that must see the DOM now.
 * Called from inside a running flush (a hook, a render) it does nothing, and development says so once (Brian,
 * 2026-10-09): everything queued still runs before that flush ends — to read what a render made, read it in
 * `useLayoutEffect`, which runs right after the render. In production this IS `drain`: zero bytes for the warning.
 */
let warnedNested = false;
export const flush = __DEV__
  ? () => {
      if (flushing && !warnedNested) {
        warnedNested = true;
        console.warn(diagnostic('core', 'flush()', 'nested-flush', __DEV__ && PROSE['nested-flush']()));
      }
      drain();
    }
  : drain;

/**
 * Replaces the scheduler of FLUSHES and returns the one it replaced. A flush the old one was holding is asked of the
 * new one, so a scheduler that dropped it strands nothing (a second run finds the queue empty).
 *
 * @param scheduler Receives the flush, and the element whose pass asked for it, and decides when to run it — never
 *   whether. The default, `microtask`, runs every flush at once; `frameBudget` opts into merging floods of data.
 */
export const setRenderScheduler = (scheduler: RenderScheduler) => {
  if (__DEV__ && typeof scheduler !== 'function')
    throw new TypeError(misuse('setRenderScheduler', 'scheduler-not-function', __DEV__ && PROSE['scheduler-not-function'](String(scheduler))));
  const previous = renderScheduler;
  renderScheduler = scheduler;
  scheduled = next < queue.length;
  if (scheduled) scheduler(drain);
  return previous;
};

/* ── development: a self-feeding loop is named, once ─────────────────────────────────────────────────────────────── */

/** Consecutive frames a pass was held, before a development warning: React's `NESTED_PASSIVE_UPDATE_LIMIT`. */
const LIMIT = 50;
/** `@__PURE__`: read only in development, so production drops the allocations with the branch. */
const exempt = /* @__PURE__ */ new WeakSet<Element>();
const warned = /* @__PURE__ */ new WeakSet<Element>();

/** Which hook a priority is — the warning names the one that loops. */
const LABELS: Record<number, string> = { 50: 'render', 60: 'useLayoutEffect', 75: 'useEffect' };

const loopWarning = (pass: HookPass) => {
  /** Held again after a run its last hold queued: one more consecutive frame. Anything else starts a new count. */
  pass._s = pass._hf ? pass._s! + 1 : 1;
  pass._hf = 0;
  const element = pass._o;
  if (pass._s < LIMIT || !element || exempt.has(element) || warned.has(element)) return;
  warned.add(element);
  const writer = pass._b ?? pass;
  console.warn(
    diagnostic('core', `${LABELS[Math.floor(writer._k / 1e9)] ?? 'a hook'} on <${element.localName}>`, 'render-loop', __DEV__ && PROSE['render-loop'](String(LIMIT)))
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
    if ((element as Partial<Node> | null)?.nodeType !== 1)
      throw new TypeError(misuse('allowRenderLoop', 'allow-loop-not-element', __DEV__ && PROSE['allow-loop-not-element'](String(element))));
    exempt.add(element);
  }
};
