import { ComponentElement, ComponentHook, Hook, Signal } from '../types.js';
import { hooksQueue, currentInstance } from '../store/store.js';
import { prioritySlot } from '@verajs/shared-utils';
import { ErrorInsert, inserts } from '@verajs/inserts';

/**
 * Hands a thrown hook error to the `'error'` insert chain, or reports it if nothing is registered.
 *
 * Core deliberately does not rethrow. Hooks on one element run in a single loop, so letting an
 * error escape stopped every hook after the failing one — a single bad effect took out its
 * siblings. Isolating here keeps the rest running while leaving the failure visible.
 */
export const reportHookError = (error: unknown, element?: ComponentElement) => {
  const handlers = inserts.get('error');
  if (handlers?.length) handlers.forEach((handler) => (handler as ErrorInsert)?.(error, element));
  else console.error(error);
};

/**
 * Wraps deferred work so it still runs inside the tracking context of the hook that scheduled it.
 *
 * Must be called **synchronously inside a hook callback**, where the hook's own entry is on top of
 * `hooksQueue`. It captures that entry and re-pushes it around the deferred work.
 *
 * Without this, every hook that defers (`useRender` and `useEffect` via `requestAnimationFrame`,
 * `useLayoutEffect` via a microtask) evaluates its body after the wrapper has already popped, so
 * `addCallback` finds an empty queue and registers nothing. The consequence is that any property
 * **first read during a re-render** is never tracked — which silently breaks conditional rendering:
 * revealing a branch works once, and subsequent changes to state inside that branch do nothing.
 *
 * @param work Function to run later, inside the current hook's context
 * @return A wrapped function safe to hand to rAF or a microtask
 */
export const deferInHookContext = <A extends unknown[]>(work: (...args: A) => void) => {
  const entry = hooksQueue[hooksQueue.length - 1];
  return (...args: A) => {
    if (entry) hooksQueue.push(entry);
    try {
      work(...args);
    } catch (error) {
      /**
       * Deferred work runs outside the hook loop, so it needs its own isolation. The element is
       * dereferenced here rather than when the wrapper is built — this runs on every write, and a
       * `WeakRef.deref()` on that path measured as a 31% write regression on its own.
       */
      reportHookError(error, entry?.element?.deref());
    } finally {
      if (entry) hooksQueue.pop();
    }
  };
};

/**
 * Creates a hook that will trigger a callback whenever any state that is inside the hook changes.
 * Each hook needs a callback and a priority level where lower runs earlier and higher runs later.
 *
 * @param hook
 */
export function createHook(hook: Hook) {
  const { element, priority, callback } = hook;
  const componentElement = element ? new WeakRef(element) : currentInstance.element;
  const derefElement = componentElement?.deref();

  /**
   * `Number.isFinite` rather than a truthiness test. **Priority `0` is legal** — lower runs earlier,
   * so zero is the highest-priority hook there is, and `prioritySlot` places it correctly. A falsy
   * check rejected it, so a hook that had to run before everything else silently never registered:
   * the one value most likely to be chosen for "first" was the one value that did not work.
   *
   * `NaN` is the case worth failing on, and it is what `parseInt` of a config value produces. The
   * same rule as `wire`, which refuses a non-finite priority for the same reason. One test covers
   * `null` and `undefined` too — `Number.isFinite` is false for both — so the narrowing that TypeScript
   * wants is a cast at the two use sites rather than a second runtime comparison on this path.
   *
   * The warning is `__DEV__`-only, like every other guard here — the silent no-op this replaced was
   * confusing because nothing said anything *anywhere*, not because production was quiet. The usual
   * cause is a hook registered after the setup was committed: hooks belong between `init()` and
   * the `render()` or `mount()` that closes it, or must be given their element explicitly.
   */
  if (!derefElement || !componentElement || !Number.isFinite(priority) || !callback) {
    if (__DEV__) {
      console.warn(
        `[vera] hook ignored — register between init() and the render() or mount() that ends setup, ` +
          `or pass the element.` +
          (Number.isFinite(priority) ? '' : ` (priority was ${String(priority)}, which is not a finite number)`)
      );
    }
    return;
  }

  /**
   * One entry per hook, reused for every invocation — load-bearing rather than a micro-opt.
   *
   * `addCallback` records whatever `WeakRef` is on the queue into the dependency `Set` for each
   * property the hook reads. Building a **new** `WeakRef` per invocation meant those additions never
   * deduped, and they were never collected either since their target stays alive. The set grew by
   * one entry per hook run per tracked property, and every write walked all of it: 692 ns rising to
   * 1.25 ms after 2 000 re-runs, a 1 810x degradation. Reusing one entry lets `Set.add` dedupe.
   */
  const queueEntry: ComponentHook = { callback: null, priority: priority as number, element: componentElement };

  /**
   * Establishes the tracking context around every run of the hook — both the initial `runHooks`
   * pass and every change-driven run from `runCallbacks`.
   *
   * @param signal Signal data passed to the hook, for optionally conditional effects
   */
  const generation = derefElement._gen;

  const hookCallback = <V>(signal?: Signal<V>, init?: boolean) => {
    /**
     * A hook from a previous `init()` — see the note there. The element is alive and connected, so
     * nothing else would stop this running; the store still holds it only because a `WeakRef` has
     * not been collected yet.
     */
    if (derefElement._gen !== generation) return;
    try {
      hooksQueue.push(queueEntry);
      callback!(signal, init);
    } catch (error) {
      /**
       * Isolated rather than rethrown. `runHooks` and `runCallbacks` both iterate an element's hooks
       * in one loop, so an escaping error skipped every hook after the failing one.
       */
      reportHookError(error, derefElement);
    } finally {
      /** Ensures hook is always popped, even if an error occurs in the callback */
      hooksQueue.pop();
    }
  };

  /**
   * The entry references the **wrapper**, not the raw callback, and that is a correctness fix.
   *
   * `runCallbacks` derefs whatever this holds and invokes it directly. Pointing it at the raw
   * callback meant change-driven runs skipped `hookCallback` entirely, so `hooksQueue` was never
   * pushed and `addCallback` registered nothing — dependencies were only ever recorded during the
   * initial `runHooks` pass. Anything first read on a later render stayed untracked forever, which
   * silently froze conditional branches.
   *
   * Assigned after the fact because the wrapper and the entry reference each other. The wrapper is
   * held strongly by the element's `_hooks`, so this WeakRef stays live exactly as long as the
   * element does — a better lifetime than the raw callback, which a consumer might retain elsewhere.
   */
  queueEntry.callback = new WeakRef(hookCallback);

  /** Dense and priority-sorted; `runHooks` walks this on every render. */
  derefElement._hooks ??= [];
  derefElement._hookPriorities ??= [];
  prioritySlot(derefElement._hooks, derefElement._hookPriorities, priority as number, () => new Set()).add(hookCallback);

  /**
   * Handed back so a caller can run the hook itself, which is the only way to record what it reads:
   * tracking happens while `hooksQueue` holds this entry, and that only happens inside this wrapper.
   * A component never needs it — `render()` drives the first pass — but anything owning its own
   * reactive value does, and reaching into `element._hooks` for it is not an API.
   *
   * The function already exists; returning it is the difference between a module being able to
   * build on core and having to reach inside it.
   */
  return hookCallback;
}
