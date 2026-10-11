import type { ComponentElement, Hook, HookCallback, HookCleanup, HookRecord, Signal, Subscribers } from '../types.js';
import { currentInstance, hooksQueue, mine } from '../store/store.js';
import { enqueue } from './scheduler.js';
import { diagnostic, prioritySlot, reportUncaught } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { inserts } from '@verajs/inserts';
import type { ErrorInsert } from '@verajs/inserts';

/**
 * **No component being set up: THROWS, in every build** (Brian, 2026-10-09 — one rule for every "no owner" case). A
 * hook, `render()` or `mount()` with none used to be dropped silently, or — after an `await` in setup — attached to
 * whichever component connected meanwhile. `init()` now ends setup at the end of its microtask turn, so the answer no
 * longer depends on what else connected: it fails here, the same way every time.
 */
export const noOwner = (subject: string) => diagnostic('core', subject, 'no-owner', __DEV__ && PROSE['no-owner']());

/** Hoisted, so `prioritySlot` is not handed a fresh closure per registration. */
const newSet = () => new Set<HookRecord>();

/**
 * Hands a thrown hook error to the `'error'` insert chain, or reports it the way the platform reports
 * an uncaught error when nothing is registered — through `reportError`, so `window.onerror` and
 * page-error listeners see it (see `reportUncaught`).
 *
 * Never rethrown: an owner's hooks run in one loop, so an escaping error stopped every hook after
 * the failing one — a single bad effect took out its siblings.
 */
/** A deliberate twin of shared-utils' `reportTo` (the same rule, +11 B there): change both together. */
export const reportHookError = (error: unknown, element: ComponentElement | undefined, line: string) => {
  const handlers = inserts.get('error');
  if (handlers?.length) handlers.forEach((handler) => (handler as ErrorInsert)(error, element));
  else reportUncaught(error, line);
};

/**
 * The priority `useRender` registers at — before `useLayoutEffect` (60) and the effects (75), so a component's first
 * pass draws before its layout effects measure it.
 */
export const RENDER_PRIORITY = 50;

/**
 * Retires every subscription `owner` carries: each hook leaves exactly the Sets it joined. Run on a component's real
 * removal and on a re-init (a new generation) — never on a move, which keeps the component and its subscriptions.
 */
export const retire = (owner: ComponentElement) => {
  /** Every hook the generation registered is in its priority Sets; each carries its record (`s`). */
  const all = owner._$h$;
  if (all !== undefined)
    for (let i = 0; i < all.length; i++)
      for (const hook of all[i]!) {
        const w = hook.w;
        const d = hook.d;
        hook.a?.delete(w);
        hook.b?.delete(w);
        if (d !== undefined) for (let k = 0; k < d.length; k++) d[k]!.delete(w);
        hook.a = hook.b = hook.d = undefined;
      }
  /** One level only: what a setup created is never itself an element being set up, so it owns no further owners. */
  const owned = owner._$o$;
  if (owned !== undefined) {
    owner._$o$ = undefined;
    for (let i = 0; i < owned.length; i++) retire(owned[i]!);
  }
};

/**
 * Runs a cleanup, reported on its own if it throws — a throwing teardown must neither stop the run it
 * precedes (one bad cleanup silenced its effect for good) nor the removal sweeping its siblings.
 */
export const runCleanup = (cleanup: HookCleanup, owner?: ComponentElement | null) => {
  try {
    cleanup();
  } catch (error) {
    /** Named as a CLEANUP (main did): the hook ran fine — what threw is what it returned. */
    reportHookError(error, owner ?? undefined, __DEV__ ? diagnostic('core', 'a cleanup', 'cleanup-threw', __DEV__ && PROSE['cleanup-threw']()) : '[vera] cleanup-threw');
  }
};

const threw = (error: unknown, owner: ComponentElement) =>
  reportHookError(error, owner, __DEV__ ? diagnostic('core', 'a hook', 'hook-threw', __DEV__ && PROSE['hook-threw']()) : '[vera] hook-threw');

/**
 * How a hook runs: inside every write it hears (`createHook`), once per flush, or at once per write (`useSyncEffect`).
 * Module-local, because `$n` reads them on every write — an exported binding is a live one, which V8 reaches less
 * directly (CLAUDE.md); `coalesce` takes the aliases.
 */
const RAW = 0;
const QUEUED = 1;
const SYNC = 2;
export const MODE_QUEUED = QUEUED;
export const MODE_SYNC = SYNC;

/** Every hook's creation, in order: the second half of the queue's key (`_k`). */
let created = 0;

/**
 * **A hook — ONE object** (work queue 5, step 1): what was three closures, two contexts, a `WeakRef` and expandos on a
 * function is this record and its `WeakRef`. Every field is assigned in the constructor, in one order, so every hook
 * has one shape (the development-only fields are added in development only).
 *
 * **A hook belongs to its owner's generation.** `init()` starts a new one every time an element reconnects, and a hook
 * from an older generation does nothing — otherwise the store, which only holds it weakly, kept running it until a
 * collection happened, and every reconnect doubled the element's renders and effects. Bumping `_$g$` is also how an
 * owner retires its hooks deliberately (`@verajs/directives` does, as teardown).
 *
 * **A change reaching an owner that is out of the tree runs nothing** — a write would otherwise walk every component no
 * one can see. The first pass always runs (a component rendered into a detached container has never been connected,
 * and must still draw), and an owner that is not an element (a `computed`'s) has no `isConnected` to be false. Coming
 * back is what catches it up: `connectedCallback` runs `init()` and a fresh first pass, reading the store as it is now.
 *
 * A throw is isolated here (`reportHookError`): every run goes through `$t`, so no caller needs its own catch.
 */
class HookState implements HookRecord {
  declare _o: ComponentElement;
  declare _g: number | undefined;
  declare _k: number;
  declare _m: number;
  declare _c: HookCleanup | undefined;
  declare _q: Signal<unknown> | undefined;
  declare _in: boolean;
  declare _f: number;
  declare _r: number;
  declare w: WeakRef<HookRecord>;
  declare a: Subscribers | undefined;
  declare b: Subscribers | undefined;
  declare d: Subscribers[] | undefined;
  /** The callback: the effect, or a render pass. */
  declare _cb: HookCallback;
  /** Development: an async callback is named once per hook, and how deep a SYNC hook's own writes re-entered it. */
  declare _wa?: boolean;
  declare _dp?: number;
  declare _hf?: number;
  declare _s?: number;
  declare _b?: HookRecord;

  constructor(owner: ComponentElement, callback: HookCallback, priority: number, mode: number) {
    this._o = owner;
    this._g = owner._$g$;
    this._k = priority * 1e9 + ++created;
    this._m = mode;
    this._c = undefined;
    this._q = undefined;
    this._in = false;
    this._f = 0;
    this._r = 0;
    this.w = new WeakRef(this);
    this.a = undefined;
    this.b = undefined;
    this.d = undefined;
    this._cb = callback;
  }

  $n(signal?: Signal<unknown>, init?: boolean) {
    const owner = this._o;
    if (owner._$g$ !== this._g || (!init && owner.isConnected === false)) return;
    if (init || this._m === RAW) return this.$t(signal, init);
    /** A write: remembered, then queued — or, for a sync hook, run at once. */
    this._q ??= signal;
    if (this._m === QUEUED) {
      try {
        enqueue(this);
      } catch (error) {
        threw(error, owner);
      }
      return;
    }
    /**
     * **A self-feeding `useSyncEffect` is stopped and named at depth 50, in development** — it runs inside every
     * write, so an unguarded write to what it reads recursed to a stack overflow, which names the trap and not the
     * cause. Production carries neither the counter nor the check.
     */
    if (__DEV__) {
      const depth = this._dp ?? 0;
      if (depth >= 50) {
        this._q = undefined;
        console.error(diagnostic('core', 'useSyncEffect', 'sync-loop', __DEV__ && PROSE['sync-loop']()));
        return;
      }
      this._dp = depth + 1;
      try {
        this.$q();
      } finally {
        this._dp = depth;
      }
    } else this.$q();
  }

  $q() {
    const signal = this._q;
    this._q = undefined;
    const owner = this._o;
    if (owner._$g$ === this._g && owner.isConnected !== false) this.$t(signal);
  }

  /**
   * **The run, tracked**: what it reads subscribes it. A raw hook just runs; any other runs its previous cleanup first
   * and keeps a returned FUNCTION as the next — an `async` callback returns a promise, which was called as a cleanup on
   * the next run and on removal (`[vera] a hook threw:` twice, measured 2026-10-09); now an async effect just runs.
   * The cleanup is also kept in the owner's `_$c$`, which removal sweeps (see `init`); an owner that removed itself
   * during this very run has already been swept, so its cleanup runs at once rather than into a Set nothing drains.
   */
  $t(signal?: Signal<unknown>, init?: boolean) {
    const owner = this._o;
    hooksQueue.push(this);
    try {
      if (this._m === RAW) {
        this._cb(signal, init);
        return;
      }
      const spent = this._c;
      if (spent !== undefined) {
        owner._$c$?.delete(spent);
        /** Cleared first, so a callback that throws does not leave a spent cleanup to run again. */
        this._c = undefined;
        runCleanup(spent, owner);
      }
      const out = this._cb(signal, init);
      const cleanup = typeof out === 'function' ? out : undefined;
      this._c = cleanup;
      if (__DEV__ && !this._wa && typeof (out as { then?: unknown } | undefined)?.then === 'function') {
        this._wa = true;
        const priority = Math.floor(this._k / 1e9);
        const hook = priority === 60 ? 'useLayoutEffect' : priority === 75 ? (this._m === SYNC ? 'useSyncEffect' : 'useEffect') : 'useHook';
        console.warn(diagnostic('core', `${hook}${owner.localName ? ` on <${owner.localName}>` : ''}`, 'async-callback', __DEV__ && PROSE['async-callback']()));
      }
      if (cleanup !== undefined) {
        if (owner._$x$) runCleanup(cleanup, owner);
        /** The Set on the FIRST cleanup — most components register none, so none pay for it. Elements `init` set up only. */
        else if (mine.has(owner)) (owner._$c$ ??= new Set()).add(cleanup);
      }
    } catch (error) {
      threw(error, owner);
    } finally {
      hooksQueue.pop();
    }
  }
}

/**
 * Registers a hook on `owner` at `priority` and returns it. A hook created while a component is being set up, for an
 * owner that is not an element — a `computed` in its setup — is retired with that component. An element owner is never
 * listed: it retires itself, and listing a live child component here would strip its subscriptions when the parent left.
 */
export const register = (owner: ComponentElement, callback: HookCallback, priority: number, mode: number) => {
  const hook = new HookState(owner, callback, priority, mode);
  const host = currentInstance.element;
  if (host !== null && host !== owner && (owner as Partial<Node>).nodeType === undefined)
    (host._$o$ ??= []).push(owner);
  prioritySlot((owner._$h$ ??= []), (owner._$p$ ??= []), priority, newSet).add(hook);
  return hook;
};

/** What `createHook` and `useHook` hand their caller: a function running the hook — `run(undefined, true)` is its first pass. */
export const callable = (hook: HookRecord) => (signal?: Signal<unknown>, init?: boolean) => hook.$n(signal, init);

/**
 * **The raw hook primitive**: registers a hook on its owner — the element being set up, or `element` when given — and
 * returns a function running it: run it and it records what it reads, which is how it is subscribed. A component never
 * needs the return value (its commit runs the first pass); anything owning its own reactive value does, and a
 * `computed`'s owner is a plain object rather than an element. It runs inside every write it hears, unbatched.
 *
 * The owner holds the hook strongly, ordered by `priority` (lower runs first; `0` is legal and earliest), and the store
 * holds one weak reference to it — one per hook, so repeated runs add the same entry to a subscription set. The
 * generation and out-of-tree rules are the hook's (`HookState`).
 *
 * THROWS when there is no owner (`noOwner`, above). Refused, returning `undefined`, when there is no callback or the
 * priority is not a finite number — `NaN` is what `parseInt` of a config value produces.
 */
export const createHook = ({ callback, priority, element }: Hook): HookCallback | undefined => {
  const owner = element ?? currentInstance.element;
  if (!owner) throw new Error(noOwner('a hook'));
  if (!callback || !Number.isFinite(priority)) return;
  return callable(register(owner, callback, priority as number, RAW)) as HookCallback;
};
