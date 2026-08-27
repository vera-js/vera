import { deferInHookContext } from '../modules/createHook.js';
import { schedulerGeneration } from '../modules/setRenderScheduler.js';
import { guardPass, noteWrite } from '../modules/allowRenderLoop.js';
import { swapCleanup } from '../store/store.js';
import { HookCallback, HookCleanup, Signal, SignalChange } from '../types.js';

/**
 * Collapses every change in a tick into one deferred run.
 *
 * Without this, N writes scheduled N passes and the effect body ran N times — all of them *after*
 * every write had landed, so all N observed the same final state. Three writes produced three runs
 * that each read the same value: three times the work for one distinct observation.
 *
 * The signal handed to the coalesced run keeps `prop` / `value` / `prevValue` describing the **last**
 * change, and adds `changed`: every property touched during the batch, mapping to the value at the
 * **start** of the batch and the value at the end. That delta is more useful than the last pair
 * alone, and no other framework surfaces it at all.
 *
 * For per-change semantics — observing each intermediate value, as Solid and Preact signals do —
 * use `useSyncEffect` instead.
 *
 * @param callback The user's effect
 * @param schedule How to defer the run (an animation frame, a microtask)
 * @param label Which hook this is, named in the self-feeding-loop warning. Dev-only.
 * @return A hook callback that coalesces
 */
export const coalesce = (callback: HookCallback, schedule: (run: () => void) => void, label: string) => {
  let cleanup: void | HookCleanup;
  let scheduled = false;
  /** Which scheduler the queued run was handed to — see `schedulerGeneration`. */
  let scheduledUnder = 0;
  let changed = new Map<string, SignalChange>();
  let latest: Signal<unknown> | undefined;
  let run: (() => void) | undefined;

  const invoke = <V>(signal?: Signal<V>, init?: boolean) => {
    /** Tear down the previous pass before establishing the next one. */
    cleanup?.();
    const next = callback(signal, init);
    /** Registered on the element too, so disconnect can run it — see `swapCleanup`. */
    swapCleanup(cleanup, next);
    cleanup = next;
  };

  /**
   * Hoisted out of the scheduling path deliberately. Inside it, this closure is allocated on every
   * write and thrown away on all but the first — `run ??=` skips the *call*, not the argument.
   */
  const body = () => {
    scheduled = false;
    const batch = changed;
    changed = new Map();
    invoke({ ...latest, changed: batch } as Signal<unknown>);
  };

  return <V>(props?: Signal<V>, init?: boolean) => {
    if (init) {
      invoke(props, init);
      return;
    }

    /** A write reaching this hook *during* a pass is what makes the pass self-feeding. */
    if (__DEV__) noteWrite();

    if (props?.prop !== undefined) {
      const seen = changed.get(props.prop);
      /** First `prevValue` wins so the pair spans the whole batch; latest `value` wins. */
      changed.set(props.prop, {
        value: props.value,
        prevValue: seen ? seen.prevValue : props.prevValue,
      });
    }
    latest = props as Signal<unknown>;

    /** A run stranded by a scheduler that never ran it is re-queued — see `useRender`. */
    if (scheduled && scheduledUnder === schedulerGeneration) return;
    scheduled = true;
    scheduledUnder = schedulerGeneration;

    /**
     * Built once. `deferInHookContext` has to be called inside a hook callback to capture the
     * tracking context, but that context is stable per hook, so it never needs rebuilding.
     *
     * The guard wraps the body **behind the ternary**, not inside it. Written the other way, the
     * `try`/`finally` it needs survives minification as an empty block on the hottest deferred path
     * in the framework — 20 B gzipped in a build that can never warn.
     */
    run ??= deferInHookContext(__DEV__ ? guardPass(body, label) : body);

    /** Released if the scheduler throws, or the effect never runs again — see `useRender`. */
    try {
      schedule(run);
    } catch (error) {
      scheduled = false;
      throw error;
    }
  };
};
