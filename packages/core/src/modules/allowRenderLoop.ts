import { hooksQueue } from '../store/store.js';
import { ComponentElement } from '../types.js';

/**
 * Detects a render or effect that feeds itself, and says so once — **without stopping it**.
 *
 * The hazard: `useEffect(() => { state.total = sum(state.rows) })` next to a template reading
 * `state.total` re-runs on every frame for as long as the page is open, with no error, no warning
 * and nothing to search the console for. `useSyncEffect` can guard this unconditionally because a
 * *synchronous* self-feeding write is never intentional; the coalesced path cannot, because an
 * animation is a self-feeding loop **on purpose**.
 *
 * ## What is counted, and what is not
 *
 * Not frames — *consecutive passes that scheduled themselves*, reset the moment one does not. This
 * is React's `nestedUpdateCount` rule (`react-dom`'s `NESTED_PASSIVE_UPDATE_LIMIT`), and the reset
 * is the whole reason the check is safe next to animation code:
 *
 * | written | counter |
 * | --- | --- |
 * | `useEffect(() => { requestAnimationFrame(() => state.t++) })` | **resets every pass** — the write lands outside the pass |
 * | `useEffect(() => { state.total = sum(state.rows) })` | climbs — the write lands *during* the pass |
 *
 * An animation driven by its own frame callback, timer or event never trips this at any threshold.
 * Only a pass whose own body feeds it does.
 *
 * "Fed" means a write reached *any* hook while the pass was in flight, not just the one that owns
 * the pass, so the two-party case is caught too — a template writing what an effect reads, where the
 * effect writes what the template reads. Neither hook feeds *itself* there, and a counter that only
 * noticed a hook re-entering would see nothing.
 *
 * ## Why it warns rather than throws
 *
 * React throws on the synchronous cascade and only `console.error`s on the coalesced one, and ships
 * neither to production. Lit warns and never stops, naming the legitimate case inside the warning
 * text. Both land on the same rule for the ambiguous path, and Vera needs it more than either: the
 * default scheduler **is** `requestAnimationFrame`, so a self-feeding `useEffect` already runs once
 * per frame and is the most natural way to write a frame loop here. Hence the warning names that
 * case, and `allowRenderLoop` exists to silence it.
 *
 * ## Cost
 *
 * `__DEV__`-only, and shaped to stay that way. The call sites hand their pass body to `guardPass`
 * behind a `__DEV__ ?` ternary rather than wrapping in place, so the wrapper — and with it the only
 * `try`/`finally` on these paths — folds away with the branch instead of surviving as an empty
 * block, and the labels fold away as unused arguments.
 *
 * Measured on `@verajs/core`, gzipped, against 2799 B: **+14 B for the detection** (the hoisted pass
 * bodies the ternary needs) and **+12 B for `allowRenderLoop`** — an exported name and an empty
 * function, which is what a public escape hatch costs a build that has nothing to escape. Marking
 * the three collections `@__PURE__` is worth 10 B of that; see below.
 */

/** Matches React's `NESTED_PASSIVE_UPDATE_LIMIT`, and the depth `useSyncEffect` already stops at. */
const LIMIT = 50;

/**
 * Elements whose self-feeding loop is deliberate, and elements already warned about — the second so
 * a runaway prints once rather than every fiftieth frame.
 *
 * `@__PURE__` is load-bearing, not decoration. Both are read only from `__DEV__` branches, but a
 * bare `new WeakSet()` at module scope is a constructor call terser must assume has side effects, so
 * production kept **both allocations** with their bindings dropped: `new WeakSet,new WeakSet;`, 23 B
 * gzipped of objects nothing can ever reach. The annotation is what lets the branch take them with
 * it.
 */
const exempt = /* @__PURE__ */ new WeakSet<ComponentElement>();
const warned = /* @__PURE__ */ new WeakSet<ComponentElement>();

/** Scheduled passes currently running. Nonzero only inside a deferred render or effect. */
let passDepth = 0;

/** Set when a tracked write reaches a hook while a pass is in flight. */
let fed = false;

/**
 * Consecutive self-feeding passes, keyed by **element and then by which hook was running**. A pass
 * that does not feed itself clears its own entry and nobody else's.
 *
 * Both halves of that key were arrived at by getting it wrong:
 *
 * - *Globally*, fifty unrelated components that each write once during a pass look exactly like one
 *   component looping fifty times. Keying on the **last element to feed** instead — React's
 *   `rootWithNestedUpdates !== root` reset — fixes that but introduces a worse error: two instances
 *   of one buggy component alternate, so neither accumulates and a loop running on both goes
 *   unreported. A component used twice is not an exotic case, so it is a map, not a last-seen check.
 * - *Per element alone* is still wrong, because a component has more than one pass. A looping
 *   `useEffect` on an element whose template renders normally never warns: the innocent render pass
 *   settles with nothing fed and clears the streak the effect had built. Not reasoned — the first
 *   version was keyed that way and `tests/core-render-loop-guard.test.mjs` caught it looping for
 *   sixty straight frames in silence. Narrowing the key to one line turns that suite green.
 *
 * The two-party case survives the narrower key. A template writing what an effect reads feeds on
 * *its* pass, and the effect writing what the template reads feeds on *its*, so both climb.
 */
const streaks = /* @__PURE__ */ new WeakMap<ComponentElement, Record<string, number>>();

/**
 * Records that a write reached a hook. Called on the change path, so it does the least possible
 * work: one comparison, and nothing at all outside a pass.
 */
export const noteWrite = () => {
  if (passDepth) fed = true;
};

/**
 * Settles the streak once a pass has finished, and warns if it has crossed.
 *
 * Only the **outermost** pass settles: a synchronous scheduler (`setRenderScheduler((run) => run())`,
 * the `flushSync` recipe) makes scheduling and running the same act, so passes genuinely nest there.
 *
 * The element is dereferenced only in the warn branch. `WeakRef.deref()` on a per-pass path measured
 * as a 31% write regression when `deferInHookContext` did it eagerly, and this runs on the same
 * cadence.
 *
 * @param label Which hook was running when the streak crossed
 */
const settle = (label: string) => {
  if (--passDepth) return;

  const selfFed = fed;
  fed = false;

  /**
   * Read from the queue rather than passed in: `guardPass` runs inside `deferInHookContext`, which
   * re-pushes the scheduling hook's entry precisely so deferred work keeps its context.
   *
   * This `deref` runs on every scheduled pass, which is the shape that measured as a 31% write
   * regression when `deferInHookContext` did it eagerly — but that was per **write**, and this is
   * per **frame, per component**, in development only. A pass that did not feed itself still has to
   * clear its element's streak, or thirty frames of looping, a pause, and thirty more would warn.
   */
  const element = hooksQueue[hooksQueue.length - 1]?.element?.deref();
  if (!element) return;

  let counts = streaks.get(element);
  if (!selfFed) {
    /** Nothing is allocated for the overwhelmingly common case of a pass that behaved. */
    if (counts) counts[label] = 0;
    return;
  }
  if (!counts) streaks.set(element, (counts = {}));

  const streak = (counts[label] ?? 0) + 1;
  if (streak <= LIMIT) {
    counts[label] = streak;
    return;
  }
  /** Cleared so a hook that opts out later, or a second loop after this one, is measured afresh. */
  counts[label] = 0;

  /**
   * Dedupe and exemption are both per **element** — the element is the thing an author goes and
   * fixes, and two looping hooks on one component are one problem, not two.
   */
  if (exempt.has(element) || warned.has(element)) return;
  warned.add(element);

  console.warn(
    `[vera] ${label} has re-run for ${LIMIT} consecutive frames because it writes state it also ` +
      `reads — this will keep running for as long as the page is open.\n` +
      `Guard the write (\`if (next !== state.x) state.x = next\`), or move it out of the pass.\n` +
      `More than one hook may be involved: renders and effects are counted together, so a template ` +
      `reading what an effect writes is caught here too.\n` +
      `If it is deliberate — an animation driven by one store write per frame — silence it with ` +
      `\`allowRenderLoop(this)\` from @verajs/core.`
  );
};

/**
 * Wraps a deferred pass body so the loop above can measure it. **Dev-only** — every call site
 * selects it with `__DEV__ ? guardPass(body, …) : body`, so production references the bare body and
 * this function is dropped whole.
 *
 * @param body The pass to measure
 * @param label Which hook it belongs to, named in the warning
 * @return The body, wrapped
 */
export const guardPass =
  <A extends unknown[]>(body: (...args: A) => void, label: string) =>
  (...args: A) => {
    passDepth++;
    try {
      body(...args);
    } finally {
      settle(label);
    }
  };

/**
 * Marks an element's self-feeding render loop as deliberate, silencing the warning above for it.
 *
 * For an animation: a store written once per frame *is* an infinite render loop, and that is the
 * point. Lit ships the same escape hatch as `ReactiveElement.disableWarning('change-in-update')`;
 * React ships none, because React's answer is "do not write state in an effect" — which is not
 * Vera's answer, since the default scheduler is already a frame.
 *
 * ```js
 * init(this);
 * allowRenderLoop(this);
 * useEffect(() => { state.t = state.t + 1 });
 * ```
 *
 * A **no-op in production**, where the warning does not exist to silence.
 *
 * @param element The component whose loop is intentional
 */
export const allowRenderLoop = (element: ComponentElement) => {
  if (__DEV__) {
    /**
     * Checked here rather than where it is read. Everything this touches is deferred, so a bad
     * argument would otherwise surface as the warning simply never being silenced — the silent
     * failure mode the setters were given guards for after an upgrade across a rename left them
     * holding `undefined` and saying nothing.
     */
    if (!element || typeof (element as { addEventListener?: unknown }).addEventListener !== 'function')
      throw new Error(
        `allowRenderLoop: expected a component element and received ${String(element)}. Pass the ` +
          `element whose loop is intentional — \`allowRenderLoop(this)\` inside the component.`
      );
    exempt.add(element);
  }
};
