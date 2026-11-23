import { misuse, warnOnce } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import type { ComponentElement, HookRecord, RenderScheduler } from '../types.js';

/** A plain microtask — every flush at once, however many land in a frame. THE DEFAULT (Brian, 2026-10-09). */
export const microtask: RenderScheduler = (run) => queueMicrotask(run);

/**
 * **One queue, drained by one flush.** Every deferred hook pass — a layout effect, a render, an effect — joins ONE
 * queue, and ONE scheduled flush runs it all; a scheduler decides only when a flush runs (Brian, 2026-10-08, after the
 * flood probe in the scheduler plan). The queue runs in KEY order: a pass's PRIORITY (render 50 → layout
 * 60 → effect 75), then its hook's CREATION — a parent's hooks are created before the children its render makes, so a child
 * re-rendered by its parent's new props runs once, after the parent; and one component's hooks run in the order it
 * registered them. Passes queued in key order — a store write waking renders — never reorder at all: that path is one
 * comparison per pass. A pass arriving OUT of order marks the queue, and the rest of it is REGROUPED before the next
 * pass is taken (`regroup`, below) — linear, where a sort was n log n.
 *
 * **The scheduler's state, shared by every function in this module** (one queue and one flush per copy of core):
 * - `queue`, `next`, `unsorted`, `spare`: the queue of passes; the index of the next pass to take; whether a pass arrived
 *   out of key order (the rest is regrouped before the next take); and the array a regroup fills, swapped with `queue`,
 *   so a regroup allocates nothing; `priorities`, the distinct priorities a regroup found, ascending (in practice two or
 *   three), refilled by each regroup.
 * - `windowStart`, `spent`: `frameBudget`'s 16 ms window and the flush work spent in it.
 * - `renderScheduler`: when flushes run (`setRenderScheduler`); a live binding, read whenever one is scheduled.
 * - `scheduled`, `flushing`, `flushes`: a flush is coming; one is running; how many have run (each pass is stamped
 *   with its flush, to count its runs there).
 * - `running` (development): the pass running now. (A nested `flush()` is reported once through shared-utils' `warnOnce`.)
 */
let queue: HookRecord[] = [];
let next = 0;
let unsorted = false;
let spare: HookRecord[] = [];
const priorities: number[] = [];
let windowStart = -Infinity;
let spent = 0;
let renderScheduler: RenderScheduler = microtask;
let scheduled = false;
let flushing = false;
let flushes = 0;
let running: HookRecord | undefined;

/** Run order: priority (`_priority`), then creation (`_sequence`) — two fields, never packed into one number (see `HookRecord`). */
const runsBefore = (a: HookRecord, b: HookRecord) => a._priority < b._priority || (a._priority === b._priority && a._sequence < b._sequence);
const created = (a: HookRecord, b: HookRecord) => a._sequence - b._sequence;

/**
 * **Puts the rest of the queue back in run order — in linear time, without a sort** (2026-10-16). A
 * write read by components that each render AND run an effect queues render, effect, render, effect…: out of order at
 * every second pass, so every such flush copied and SORTED the whole queue (2–10% of the flush, measured at 10, 50 and
 * 1000 components). But within one priority, passes arrive in creation order (a write wakes its readers in the order
 * they subscribed) — only the priorities interleave. So the rest is regrouped: one walk per priority present (in
 * practice two or three), each appending its passes in the order they stand, which keeps creation order. A group whose
 * creation order WAS broken — rare — is sorted on its own. Appending in order keeps the array dense (a counting sort's
 * scattered writes would leave holes, which tax every read). A flush in key order never reaches this.
 */
const regroup = () => {
  const end = queue.length;
  priorities.length = 0;
  for (let i = next; i < end; i++) {
    const y = queue[i]!._priority;
    let at = priorities.length;
    while (at > 0 && priorities[at - 1]! > y) at--;
    if (priorities[at - 1] !== y) priorities.splice(at, 0, y);
  }
  spare.length = 0;
  for (let p = 0; p < priorities.length; p++) {
    const y = priorities[p]!;
    const start = spare.length;
    let previous = -1;
    let broken = false;
    for (let i = next; i < end; i++) {
      const pass = queue[i]!;
      if (pass._priority !== y) continue;
      if (pass._sequence < previous) broken = true;
      previous = pass._sequence;
      spare.push(pass);
    }
    if (broken) {
      const group = spare.splice(start).sort(created);
      for (let i = 0; i < group.length; i++) spare.push(group[i]!);
    }
  }
  const taken = queue;
  queue = spare;
  spare = taken;
  spare.length = 0;
  next = 0;
  unsorted = false;
};

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

/**
 * Queues a hook's pass, once, and makes sure a flush is coming. A pass already queued is not queued twice. A flush
 * already running drains it; otherwise one is scheduled — and if the scheduler throws, the pass stays queued and the
 * next write asks again, so a broken scheduler never freezes a component for good.
 */
export const enqueue = (pass: HookRecord) => {
  /** Development: which pass's run queued this one — the hook a loop warning names is the one that WRITES. */
  if (__DEV__) pass._heldBy = flushing ? running : undefined;
  if (!pass._queued) {
    pass._queued = true;
    /** Only a pass arriving OUT of key order needs a sort — passes queued in creation order never pay one. */
    if (next < queue.length && runsBefore(pass, queue[queue.length - 1]!)) unsorted = true;
    queue.push(pass);
  }
  if (scheduled || flushing) return;
  scheduled = true;
  try {
    renderScheduler(drain, pass._owner ?? undefined);
  } catch (error) {
    scheduled = false;
    throw error;
  }
};

/**
 * **At most TWO runs of a hook per flush; a third waits for the next frame.** A hook scheduled again by its own run
 * gets one more pass in the same flush — a measure-then-set lands before paint, and converges, because its second
 * measurement writes the same value, which the store ignores — and a third is held for the element window's next frame
 * (or the timer), where it is queued again, so a self-feeding pass runs twice per frame, runaway or intended, and never
 * freezes the tab. (Main ran it once per frame; Vue allows a hundred re-runs; React throws.)
 *
 * **One frame per pass per flush** (Brian's ruling, 2026-11-12): a loop is not the only way here. A FAN-IN re-queues one pass many
 * times in one flush — an automatic list's parent, once per updated row, when the list cannot commit its rows itself —
 * and every re-queue past the second run used to ask for its own frame and timer (98 for a 100-row update); in a
 * browser each frame callback is followed by a microtask checkpoint, so each could drain the pass again. Only the FIRST
 * crossing (`_flushRuns === 3`) asks now; later re-queues in the same flush reach 4, 5, … and ask nothing. A new flush resets
 * `_flushRuns`, so a write in an unrelated flush still runs the pass there, and its frame still queues it, as before.
 * Not a field of its own: one more field per hook cost hook CREATION +2.4% on SpiderMonkey (measured, 12/12). Not `_queued`
 * either: marking a held pass "queued" would make every write ignore it until its frame, and a hidden tab's frame is a
 * timer throttled to a second or a minute, and `flush()` would skip it.
 */
const hold = (pass: HookRecord) => {
  if (pass._flushRuns !== 3) return;
  if (__DEV__) loopWarning(pass);
  frameOrTimer(() => {
    if (__DEV__) pass._heldAt = 1;
    enqueue(pass);
  }, pass._owner ?? undefined);
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
      if (unsorted) regroup();
      const pass = queue[next++];
      pass._queued = false;
      if (pass._flush !== flushId) {
        pass._flush = flushId;
        pass._flushRuns = 0;
      }
      if (++pass._flushRuns! > 2) hold(pass);
      else {
        if (__DEV__) running = pass;
        pass.$q();
      }
    }
  } catch (error) {
    /**
     * A pass that threw out of the flush (an `'error'` handler that rethrows) may have left passes unrun: see
     * `strandedNone`. Here, not in a `finally`: a `finally` that asked whether any were left cost WebKit 4.5% on a flush
     * per write (measured 2026-11-23); this way the path without a throw is the three resets below, as before.
     */
    /*@__NOINLINE__*/ strandedNone();
    throw error;
  }
  if (__DEV__) unhold();
  queue = [];
  next = 0;
  flushing = false;
};

/**
 * Development: `running` and each pass's `_heldBy` are read only DURING a flush (the loop warning names the writer), and
 * left set they kept the last hooks that ran — and through them their components — alive after removal, in
 * development only (found 2026-10-10 by tests/core-subscription-sweep's re-render row: one hook left, dev only).
 */
const unhold = () => {
  for (let i = 0; i < queue.length; i++) queue[i]._heldBy = undefined;
  running = undefined;
};

/**
 * **A flush that a throw ended strands nothing** (2026-11-23). An `'error'` handler that rethrows (`log(e); throw e`)
 * carries the error out of the pass, the flush and the scheduler; the passes queued after it were dropped with the
 * queue but stayed marked queued, so no later write could queue them again, and hooks on unrelated signals never ran
 * again. They are put back, in order, and a flush asked for (the error still goes on to whoever runs the flush). Cold:
 * only a throw reaches it.
 */
const strandedNone = () => {
  if (__DEV__) unhold();
  if (next >= queue.length) {
    queue = [];
    next = 0;
    flushing = false;
    return;
  }
  const rest = queue.slice(next);
  queue = rest;
  next = 0;
  flushing = false;
  scheduled = true;
  try {
    renderScheduler(drain, rest[0]._owner ?? undefined);
  } catch (error) {
    /**
     * No flush is promised, so the next write asks again. What was thrown is not dropped: a scheduler that runs the
     * flush at once throws the NEXT failing pass's error here, as uncaught as the first, so it is thrown where the
     * platform reports an uncaught error, after this one has left.
     */
    scheduled = false;
    queueMicrotask(() => {
      throw error;
    });
  }
};

/**
 * **`flush()`, as core exports it: runs everything queued, synchronously** — a test, or work that must see the DOM now.
 * Called from inside a running flush (a hook, a render) it does nothing, and development says so once (Brian,
 * 2026-10-09): everything queued still runs before that flush ends — to read what a render made, read it in
 * a `'layout'` effect, which runs right after the render. In production this IS `drain`: zero bytes for the warning.
 */
export const flush = __DEV__
  ? () => {
      if (flushing) warnOnce('core', 'flush()', 'nested-flush', __DEV__ && (() => PROSE['nested-flush']()));
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
  /**
   * Not during a flush (2026-11-23): that flush drains what is queued, and a scheduler that runs `drain` at once found it
   * flushing and returned, leaving `scheduled` set for good, so no write asked for a flush again and nothing rendered.
   */
  scheduled = !flushing && next < queue.length;
  if (scheduled) scheduler(drain);
  return previous;
};

/* ── development: a self-feeding loop is named, once ─────────────────────────────────────────────────────────────── */

/** Consecutive frames a pass was held, before a development warning: React's `NESTED_PASSIVE_UPDATE_LIMIT`. */
const LIMIT = 50;
/** `@__PURE__`: read only in development, so production drops the allocation with the branch. */
const exempt = /* @__PURE__ */ new WeakSet<Element>();

/** Which hook a priority is — the warning names the one that loops. */
const LABELS: Record<number, string> = { 50: 'render', 60: "a 'layout' effect", 75: 'an effect' };

const loopWarning = (pass: HookRecord) => {
  /** Held again after a run its last hold queued: one more consecutive frame. Anything else starts a new count. */
  pass._heldFrames = pass._heldAt ? pass._heldFrames! + 1 : 1;
  pass._heldAt = 0;
  const element = pass._owner;
  if (pass._heldFrames < LIMIT || !element || exempt.has(element)) return;
  const writer = pass._heldBy ?? pass;
  /**
   * Once per element: each looping component is its own mistake. A hook owned by a plain object (a module's `effect`) has
   * no tag to name, as the hook's own labels say: it printed "on <undefined>".
   */
  warnOnce('core', `${LABELS[writer._priority] ?? 'a hook'}${element.localName ? ` on <${element.localName}>` : ''}`, 'render-loop', __DEV__ && (() => PROSE['render-loop'](String(LIMIT))), element);
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
 * effect(() => { state.t = state.t + 1 });
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
