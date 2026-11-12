import type { Cell, ComponentElement, Hook, HookCallback, HookCleanup, HookRecord, Change, Owned } from '../types.js';
import { currentInstance, tracking, unlinkFrom } from '../store/store.js';
import { enqueue } from './scheduler.js';
import { diagnostic, misuse, reportUncaught } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { inserts } from '@verajs/inserts';
import type { ErrorInsert } from '@verajs/inserts';

/**
 * **No component being set up: THROWS, in every build** (Brian, 2026-10-09 — one rule for every "no owner" case). A
 * hook, `render()` or `mount()` with none used to be dropped silently, or — after an `await` in setup — attached to
 * whichever component connected meanwhile. `init()` now ends setup at the end of its microtask turn, so the answer no
 * longer depends on what else connected: it fails here, the same way every time.
 */
export const noOwner = (subject: string) => misuse(subject, 'no-owner', __DEV__ && PROSE['no-owner']());


/**
 * Hands a thrown hook error to the `'error'` insert chain, or reports it the way the platform reports
 * an uncaught error when nothing is registered — through `reportError`, so `window.onerror` and
 * page-error listeners see it (see `reportUncaught`).
 *
 * Never rethrown: an owner's hooks run in one loop, so an escaping error stopped every hook after
 * the failing one — a single bad effect took out its siblings.
 *
 * A deliberate twin of shared-utils' `reportTo` (the same rule, +11 B there): change both together.
 */
export const reportHookError = (error: unknown, element: ComponentElement | undefined, line: string) => {
  const handlers = inserts.get('error');
  if (handlers?.length) for (const handler of handlers) (handler as ErrorInsert)(error, element);
  else reportUncaught(error, line);
};

/**
 * The priority the setup's returned render registers at — before a `'layout'` effect (60) and the effects (75), so a component's first
 * pass draws before its layout effects measure it.
 */
export const RENDER_PRIORITY = 50;
/** The layout and the plain effect slots' priorities — by NAME, because a cross-window move re-runs exactly these two (`rehome`). */
export const LAYOUT_PRIORITY = 60;
export const EFFECT_PRIORITY = 75;

/**
 * **Retires every hook `owner` carries, in run order**: each leaves exactly the Sets it joined, then its last cleanup runs
 * (`runCleanup`: one that throws is reported and the rest still run). Run on a component's real removal and on a
 * re-init (a new generation) — never on a move, which keeps the component and its subscriptions.
 *
 * **A cleanup lives on its hook, as React keeps an effect's `destroy` on its effect** (Brian
 * 2026-10-11): each hook keeps the cleanup its LATEST run returned. They used to sit in one Set on the element, where a
 * re-run deleted its old cleanup and added the new one at the END — so after a layout effect re-ran, removal ran the
 * effect's cleanup before the layout effect's, the reverse of priority order. The list is in run order, so this walk is
 * in priority order by construction. Unsubscribed first, so a cleanup's own write cannot wake the hook it belongs to.
 */
export const retire = (owner: ComponentElement) => {
  /** Every hook the generation registered is in its one list, each carrying its own subscriptions. */
  const all = owner._$h$;
  if (all !== undefined)
    for (let i = 0; i < all.length; i++) {
      const hook = all[i]!;
      unlinkFrom(hook, 0);
      spend(hook);
      disposeOwned(hook);
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
    reportHookError(error, owner ?? undefined, diagnostic('core', 'a cleanup', 'cleanup-threw', __DEV__ && PROSE['cleanup-threw']()));
  }
};

/**
 * **Runs a hook's cleanup, once** — before its next run, at removal (`retire`), and at once when its owner was removed
 * during this very run. Cleared FIRST: a spent cleanup must neither run twice (a callback that throws next would leave it
 * to run again) nor keep alive what it captured.
 */
const spend = (hook: HookRecord) => {
  const cleanup = hook._cleanup;
  if (cleanup !== undefined) {
    hook._cleanup = undefined;
    runCleanup(cleanup, hook._owner);
  }
};

const threw = (error: unknown, owner: ComponentElement) =>
  reportHookError(error, owner, diagnostic('core', 'a hook', 'hook-threw', __DEV__ && PROSE['hook-threw']()));

/**
 * How a hook runs: inside every write it hears (core's immediate hook, internal), once per flush, or at once per write (a `'sync'` effect).
 * Module-local, because `$n` reads them on every write — an exported binding is a live one, which V8 reaches less
 * directly (CLAUDE.md); `coalesce` takes the aliases.
 */
const IMMEDIATE = 0;
const QUEUED = 1;
const SYNC = 2;
export const MODE_QUEUED = QUEUED;
export const MODE_SYNC = SYNC;
export const MODE_IMMEDIATE = IMMEDIATE;

/** Every hook's creation, in order: `_sequence`, which breaks ties within one priority. */
let created = 0;

/**
 * **A hook — ONE object**: what was three closures, two contexts, a `WeakRef` and expandos on a
 * function is this record (no longer a `WeakRef`, since cells hold hooks strongly). Every field is assigned in the constructor, in one order, so every hook
 * has one shape (the development-only fields are added in development only).
 *
 * **A hook belongs to its owner's generation.** `init()` starts a new one every time an element reconnects, and a hook
 * from an older generation does nothing — otherwise the store kept running it (when it held hooks weakly, until a
 * collection happened; with strong cells, until retirement), and every reconnect doubled the element's renders and effects. Bumping `_$g$` is also how an
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
  declare _owner: ComponentElement;
  declare _generation: number | undefined;
  declare _priority: number;
  declare _sequence: number;
  declare _mode: number;
  declare _cleanup: HookCleanup | undefined;
  declare _change: Change<unknown> | undefined;
  declare _queued: boolean;
  declare _flush: number;
  declare _flushRuns: number;
  declare _sources: Cell[];
  declare _places: number[];
  declare v: number;
  declare _cursor: number;
  declare _lastWake: number;
  /** The callback: the effect, or a render pass. */
  declare _cb: HookCallback;
  /** Development: an async callback is named once per hook, and how deep a SYNC hook's own writes re-entered it. */
  declare _wa?: boolean;
  declare _dp?: number;
  declare _heldAt?: number;
  declare _heldFrames?: number;
  declare _heldBy?: HookRecord;

  constructor(owner: ComponentElement, callback: HookCallback, priority: number, mode: number) {
    this._owner = owner;
    this._generation = owner._$g$;
    this._priority = priority;
    this._sequence = ++created;
    this._mode = mode;
    this._cleanup = undefined;
    this._change = undefined;
    this._queued = false;
    this._flush = 0;
    this._flushRuns = 0;
    this._sources = [];
    this._places = [];
    this.v = 0;
    this._cursor = 0;
    this._lastWake = 0;
    this._cb = callback;
    /**
     * Created BY a server render's tree — inside a running hook or a setup, or owned by a node — during its turn: unlinked
     * when the turn ends (`serverTurn`, below). A module first imported during the turn (a component's lazy
     * `await import()`) runs its top level with none of those, so its module-scope state stays the process's.
     */
    if (serverScope > 0 && (tracking.hook !== undefined || currentInstance.element !== null || (owner as Partial<Node>).nodeType !== undefined))
      born.push(this);
  }

  /**
   * **`effect()`'s handle** (2026-10-22): the record itself, so the handle allocates nothing. `run()` runs it now (a first
   * pass when it never ran); `stop()` ends it for good — out of every store, its cleanup run once (`retireHook`), and its
   * generation spent so `$n` returns on every path after (a write, a resume's first passes, a re-home).
   */
  run() {
    this.$n(undefined, true);
  }
  stop() {
    retireHook(this);
    this._generation = NaN;
  }

  $n(signal?: Change<unknown>, init?: boolean) {
    const owner = this._owner;
    if (owner._$g$ !== this._generation || (!init && owner.isConnected === false)) return;
    if (init || this._mode === IMMEDIATE) return this.$t(signal, init);
    /** A write: remembered, then queued — or, for a sync hook, run at once. */
    this._change ??= signal;
    if (this._mode === QUEUED) {
      try {
        enqueue(this);
      } catch (error) {
        threw(error, owner);
      }
      return;
    }
    /**
     * **A self-feeding a `'sync'` effect is stopped and named at depth 50, in development** — it runs inside every
     * write, so an unguarded write to what it reads recursed to a stack overflow, which names the trap and not the
     * cause. Production carries neither the counter nor the check.
     */
    if (__DEV__) {
      const depth = this._dp ?? 0;
      if (depth >= 50) {
        this._change = undefined;
        console.error(diagnostic('core', "a 'sync' effect", 'sync-loop', __DEV__ && PROSE['sync-loop']()));
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
    const signal = this._change;
    this._change = undefined;
    const owner = this._owner;
    if (owner._$g$ === this._generation && owner.isConnected !== false) this.$t(signal);
  }

  /**
   * **The run, tracked**: what it reads subscribes it. An immediate hook just runs; any other runs its previous cleanup first
   * and keeps a returned FUNCTION as the next — an `async` callback returns a promise, which was called as a cleanup on
   * the next run and on removal (`[vera] a hook threw:` twice, measured 2026-10-09); now an async effect just runs.
   * The cleanup stays ON the hook (`_cleanup`), where removal's walk finds it (`retire`); an owner that removed itself during
   * this very run has already been walked, so its cleanup runs at once rather than waiting on a walk that is over.
   */
  $t(signal?: Change<unknown>, init?: boolean) {
    const owner = this._owner;
    const outer = tracking.hook;
    tracking.hook = this;
    /**
     * The run's link bookkeeping. A FIRST run links each read directly (`i = -1`); a re-run
     * starts its cursor at 0 (`track`). `ok` turns true only when the callback returned: a run that THREW leaves the
     * links it did not reach in place, so the hook still hears what it read last time.
     *
     * **A run of THIS hook nested inside its own run** (an immediate hook or a `'sync'` effect writing what it read re-runs
     * synchronously) is part of the OUTER run: it carries on from the outer run's cursor and leaves it where its reads
     * end, and only the outermost run's end unlinks what nobody reached — outer prefix, nested reads and outer suffix
     * reconcile as ONE run, so nothing read by any of them is lost and the nesting links nothing twice. (A key re-read in
     * one run after ANOTHER hook read it can still hold a second link — over-subscription, never an extra run, thanks to the
     * wake loop's re-stamp (`createProxy.ts`); a dedupe in `track` would cost every read.) (2026-10-22: the nested
     * run used to restart the cursor and reconcile `_sources` to ITS reads alone, assuming it read at least what the outer run
     * had; a callback that guards against re-entry — `if (busy) return`, as `data-vd-list` does — reads NOTHING, which
     * unlinked every source and left the hook deaf. `tests/core-nested-run-links.test.mjs`.)
     */
    const nested = outer === this;
    const first = this.v === 0;
    this.v++;
    if (!nested) this._cursor = first ? -1 : 0;
    let ok = false;
    try {
      if (this._mode === IMMEDIATE) {
        this._cb(signal, init);
        ok = true;
        return;
      }
      spend(this);
      const out = this._cb(signal, init);
      const cleanup = typeof out === 'function' ? out : undefined;
      this._cleanup = cleanup;
      if (__DEV__ && !this._wa && typeof (out as { then?: unknown } | undefined)?.then === 'function') {
        this._wa = true;
        const priority = this._priority;
        const hook = priority === 60 ? "a 'layout' effect" : this._mode === SYNC ? "a 'sync' effect" : 'an effect';
        console.warn(diagnostic('core', `${hook}${owner.localName ? ` on <${owner.localName}>` : ''}`, 'async-callback', __DEV__ && PROSE['async-callback']()));
      }
      ok = true;
      /** `_$x$` is read only when there IS a cleanup: on a fresh element it is a miss, a walk down the DOM prototype chain. */
      if (cleanup !== undefined && owner._$x$) spend(this);
    } catch (error) {
      threw(error, owner);
    } finally {
      tracking.hook = outer;
      /** A re-run that matched its last run's reads to the end of what it read: the sources it no longer reached leave. */
      if (ok && !nested && this._cursor >= 0 && this._cursor < this._sources.length) unlinkFrom(this, this._cursor);
    }
  }
}

/**
 * **A BARE render hook for a keyed row** (2026-10-20, Brian: cut per-row memory now): the hook
 * is NOT pushed into its owner's hook list — a row owns exactly one hook, so the one-element `_$h$` array per row was pure
 * overhead — and it is retired directly (`retireHook`). Its callback is called as a METHOD of the hook (`this._cb(…)`), so
 * one shared function serves every row, reaching its row through `ownerOf` — no closure per row.
 */
export const bare = (owner: ComponentElement, callback: HookCallback): HookRecord => new HookState(owner, callback, RENDER_PRIORITY, QUEUED);
/**
 * **A server render's links end with it** (2026-10-21). A server needs links DURING a render — a write in the render (a
 * setup that loads data, a router's first navigation) must re-render before the markup is serialized (`@verajs/ssr`
 * frames.ts) — but none after it: every link a long-lived store kept to a rendered component only kept that component
 * alive (200 of 200 renders retained; the earlier weak links kept 0). So every hook created inside a server render's
 * TURN is recorded, and when the turn ends each leaves every cell it joined. Cleanups are not run: nothing was removed,
 * as the earlier engine never ran them either. `@verajs/ssr` opens and closes the turn (`$ss(1)` / `$ss(-1)`) around
 * each render — one at a time per process (its `takeTurn`), so the depth is the turn. A hook created while a turn
 * awaits — client code in the same process — is the documented edge (the ssr README's limits).
 */
let serverScope = 0;
let born: HookRecord[] = [];
/**
 * `$ss(1)` opens a server turn, `$ss(-1)` closes it, and **`$ss(0)` is the READ**: it answers the depth (truthy inside a
 * turn, `undefined` outside — where `born` is empty, so the close below unlinks nothing). `@verajs/store/resource` reads
 * it so a server render never starts a fetch nobody waits for. Do not turn the read into a no-op.
 */
export const serverTurn = (delta: number) => {
  /** The read allocates nothing: outside a turn it must not reach the close below. */
  if (delta === 0) return serverScope || undefined;
  serverScope += delta;
  if (serverScope !== 0) return serverScope;
  const all = born;
  born = [];
  for (let i = 0; i < all.length; i++) unlinkFrom(all[i]!, 0);
  return undefined;
};
export const retireHook = (hook: HookRecord) => {
  unlinkFrom(hook, 0);
  spend(hook);
};

/**
 * **What each hook's runs own** (2026-10-20): a side table, made at the first `own()`, so the hook class keeps
 * its shape and a page with nothing owned never builds it. Things a run creates or claims — an automatic `.map` list
 * today, a render-made computed next — are disposed when a run ENDS without claiming them, and when the
 * hook retires.
 */
let ownedBy: WeakMap<HookRecord, Owned[]> | undefined;
/** Claims `item` for `hook`'s CURRENT run (a module calls it during the run that uses the item). */
export const ownForRun = (hook: HookRecord, item: Owned) => {
  item.$r = hook.v;
  if (item.$h !== hook) {
    item.$h = hook;
    const table = (ownedBy ??= new WeakMap());
    const list = table.get(hook);
    if (list === undefined) table.set(hook, [item]);
    else list.push(item);
  }
};
/** After a run: keep what it claimed, dispose the rest — stable, in one pass. */
const settleOwned = (hook: HookRecord, o: Owned[]) => {
  let w = 0;
  for (let r = 0; r < o.length; r++) {
    const item = o[r]!;
    if (item.$r === hook.v) o[w++] = item;
    else {
      item.$h = undefined;
      item.$d();
    }
  }
  o.length = w;
  if (w === 0) ownedBy!.delete(hook);
};
/**
 * **Settled where the owning run ends, never in every hook's run** (2026-10-21): the earlier design checked the table
 * at the end of EVERY run, so a 10k list's 10 000 row runs each paid a lookup (Firefox create10k +4.7%, measured).
 * Things are owned only by a component's render (core's `drawInto` settles it, once per render) and by an automatic
 * list's row (keyed settles its own row, and only while some row owns a list). `all`: the owner is retiring — dispose
 * everything it owns.
 */
export const settle = (hook: HookRecord | undefined, all?: boolean) => {
  const o = hook && ownedBy?.get(hook);
  if (o !== undefined) {
    if (all) disposeOwned(hook!);
    else settleOwned(hook!, o);
  }
};
/** A retiring hook disposes everything it owns. */
const disposeOwned = (hook: HookRecord) => {
  const o = ownedBy?.get(hook);
  if (o === undefined) return;
  ownedBy!.delete(hook);
  for (let r = 0; r < o.length; r++) {
    o[r]!.$h = undefined;
    o[r]!.$d();
  }
};
export const ownerOf = (hook: HookRecord) => hook._owner;

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
  /**
   * ONE flat list in run order. Sequences only grow, so a hook joins at the end — unless a LOWER priority arrives after
   * a higher one (an `effect(fn, { priority: 25 })` registered after the render): then it moves back past the hooks that run after it.
   * An equal priority never moves: the one already there was created first.
   */
  const hooks = (owner._$h$ ??= []);
  let at = hooks.length;
  hooks.push(hook);
  while (at > 0 && hooks[at - 1]!._priority > hook._priority) {
    hooks[at] = hooks[at - 1]!;
    at--;
  }
  hooks[at] = hook;
  return hook;
};

/**
 * **A priority must be a finite number — otherwise the hook is REFUSED, in both builds, and development says why**
 * (Brian, 2026-10-11: the same behavior in both builds, the words only in development — one rule for a
 * priority wherever it is given, `wire` included). Refused silently before, so a `NaN` read from config left an effect
 * that never ran with nothing said; production still refuses silently (documented), development names it.
 */
export const finite = (priority: unknown, subject: string) => {
  if (Number.isFinite(priority)) return true;
  if (__DEV__) console.error(diagnostic('core', subject, 'priority-not-finite', __DEV__ && PROSE['priority-not-finite'](String(priority))));
  return false;
};

/** What the raw primitive (core-internal, `$s[2]`) hands its caller: a function running the hook — `run(undefined, true)` is its first pass. */
export const callable = (hook: HookRecord) => (signal?: Change<unknown>, init?: boolean) => hook.$n(signal, init);

/**
 * **The immediate hook primitive**: registers a hook on its owner — the element being set up, or `element` when given — and
 * returns a function running it: run it and it records what it reads, which is how it is subscribed. A component never
 * needs the return value (its commit runs the first pass); anything owning its own reactive value does, and a
 * `computed`'s owner is a plain object rather than an element. It runs inside every write it hears, unbatched.
 *
 * The owner holds the hook strongly, ordered by `priority` (lower runs first; `0` is legal and earliest), and so do the
 * cells it reads (strong links, released by retirement; it was one weak reference per hook). The
 * generation and out-of-tree rules are the hook's (`HookState`).
 *
 * THROWS when there is no owner (`noOwner`, above). Refused, returning `undefined`, when there is no callback or the
 * priority is not a finite number (`finite`, below — `NaN` is what `parseInt` of a missing config value produces;
 * development says so).
 */
export const createHook = ({ callback, priority, element }: Hook): HookCallback | undefined => {
  const owner = element ?? currentInstance.element;
  if (!owner) throw new Error(noOwner('a hook'));
  if (!callback || !finite(priority, 'createHook')) return;
  return callable(register(owner, callback, priority as number, IMMEDIATE)) as HookCallback;
};
