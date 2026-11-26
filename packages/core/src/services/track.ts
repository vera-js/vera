/** Subscribes the running hook to what it reads, and wakes the hooks that read what a write changed. */
import { claim, grow, placeAt, proxyCallbacks, readerAt, slotAt, tracking, unlinkFrom } from '../store/store.js';
import { isWeakCollection } from '@verajs/shared-utils';
import type { StoreKit } from '@verajs/inserts';
import type { Cell, Change } from '../types.js';
import { seams } from './seams.js';
import { uncaught } from '../modules/scheduler.js';

/**
 * The channel an object's **shape** is published on, as distinct from any one key: a key added or
 * removed. Anything that enumerates — `Object.keys`, `for…in`, `{ ...state.o }`, `JSON.stringify` —
 * depends on the set of keys, which no per-key subscription can describe, so it subscribes here.
 * Store modules are handed it in the kit rather than declaring the literal themselves — two bundles
 * declaring one string is a contract nothing checks.
 */
export const GLOBAL = '_global';
/**
 * **An object's key map is bounded: a cell no reader holds is deleted.** A cell outlives its readers in its object's
 * key map, so an object whose keys come and go (a dictionary, a cache, a selector's ids) would grow by every key it
 * ever had. `track` reaches this ONLY when it makes a new cell in a map of at least `SWEEP_FLOOR` keys (a row's two or
 * three keys never pass it), and the map is swept when it has grown to twice what the last sweep left, plus the floor:
 * a sweep is paid for by as many new cells, and a map holds at most about twice its live keys.
 *
 * - **Empty** is `n === d`: every slot a tombstone (a cell whose readers left but has not compacted yet). Whether the
 *   object still HAS the key does not matter: a read makes the cell again (and an `in` test would throw for a
 *   collection's null-prototype keys).
 *
 * - **Thresholds** live in a side table keyed by the map: an expando on the `Map` would change the shape `track`'s hot
 *   `props.get` reads, and a stateless rule (powers of two) would sweep the whole map on every new key while the live
 *   count sits just under a power.
 */
const SWEEP_FLOOR = 64;
/**
 * The wake counter: every notification (one write, or one whole-array operation across all its keys) takes a new
 * number, and a hook it reached carries it (`_lastWake`), so an operation wakes each hook ONCE without allocating a set of the
 * hooks it reached.
 */
let wakes = 0;
/** Each big key map's next sweep threshold (`SWEEP_FLOOR`), in a side table so the map keeps its shape. */
let due: WeakMap<object, number> | undefined;
/**
 * Records the running hook, if any, as depending on `obj[prop]`. A weak collection's subscriptions
 * are keyed by its own entry keys, so they are held in a `WeakMap` — a `Map` would keep every tracked
 * key alive as long as the collection, the retention the weak types exist to avoid. Decided once, on
 * the first tracked read of the object.
 */
export const track = (obj: object, prop: unknown) => {
  const sub = tracking.hook;
  if (sub === undefined) return;
  let props = proxyCallbacks.get(obj);
  if (props === undefined) {
    props = (isWeakCollection(obj) ? new WeakMap() : new Map()) as Map<unknown, never>;
    proxyCallbacks.set(obj, props);
  }
  let cell = props.get(prop);
  if (cell === undefined) {
    /**
     * A big key map is swept BEFORE its new cell exists (`sweepIfDue`, out of line): swept after, this new cell — empty,
     * its key often absent (a dictionary reads `dict[id]` before `dict[id] = …`) — would be dropped, and its reader
     * deaf to the write. A weak collection's container has no `size` and is never swept (its keys die with their
     * objects).
     */
    if (props.size >= SWEEP_FLOOR) sweepIfDue(props);
    props.set(prop, (cell = { _first: undefined, _firstAt: 0, _readers: undefined, _readerAt: undefined, _moves: 0, _positions: 0, _tombstones: 0 }));
  }
  /**
   * **Lazy in-order link reuse.** A hook's FIRST run links each read directly, skipping only a consecutive repeat: a
   * hook never re-run (most rows of a big list) pays nothing for reuse. A RE-run walks its previous sources in order: a
   * read matching the cursor just advances it; a repeat of one already linked this run is skipped (below); the first
   * read that DIFFERS unlinks every source not yet matched and links directly from there, so every read is linked at
   * once (a run that reads a key and then writes it hears its own write).
   *
   * The common paths stay inline, and `track` stays small enough for V8 to inline into the traps:
   * `tests/core-inlining-budget.test.mjs` prints its bytecode against the limit in both builds.
   */
  const s = sub._sources;
  const i = sub._cursor;
  const n = cell._positions;
  /** The key's LAST reader (position n − 1). */
  const last = n === 0 ? undefined : readerAt(cell, n - 1);
  if (i < 0) {
    if (last === sub) return;
  } else {
    if (i < s.length && s[i] === cell) {
      sub._cursor = i + 1;
      return;
    }
    if (last === sub) {
      const at = slotAt(cell, n - 1);
      if (at < i) return;
      claim(sub, cell, at, i);
      sub._cursor = i + 1;
      return;
    }
    unlinkFrom(sub, i);
    sub._cursor = -2;
  }
  const slot = s.length;
  s.push(cell);
  sub._places.push(n);
  if (n === 0) placeAt(cell, 0, sub, slot);
  else grow(cell, sub, slot);
  cell._positions = n + 1;
};


/**
 * Wakes every hook in `cell` with `signal`: the ONE place a notification goes out, for a single write and a whole-array
 * operation alike. One signal per write, shared by every subscriber; it is read, never written.
 *
 * **In insertion order.** A raw or sync hook runs inside this loop, in this order, and its run may make a hook LEAVE
 * this cell, which moves the cell's last hook into the leaver's slot, possibly behind the walk. So a leave (the count
 * at index 0 changed) restarts the walk from the start: every hook already reached carries this wake's number and is
 * skipped, so none is missed and none runs twice. A hook that JOINS during the walk is reached too.
 */
export const wake = (cell: Cell, signal: Change<unknown>, epoch: number) => {
  let m = cell._moves;
  for (let p = 0; p < cell._positions; p++) {
    const hook = readerAt(cell, p);
    /** A tombstone (a reader that left), or one this wake already reached. */
    if (hook === undefined || hook._lastWake === epoch) continue;
    hook._lastWake = epoch;
    try {
      hook.$n(signal);
    } catch (error) {
      /**
       * **A hook's error never leaves a write** (2026-11-23): an `'error'` handler that rethrows, under a `'sync'` effect
       * or a scheduler that runs the flush at once, threw out of this loop, and every subscriber after it missed the
       * write. It is reported as uncaught, as the default scheduler's flush reports it, and the loop goes on.
       */
      /*@__NOINLINE__*/ uncaught(error);
    }
    /**
     * **The stamp again, after the run.** A raw or sync hook runs INSIDE this call, and a write it makes to a key it
     * read wakes it again, nested, stamping it with that NEWER wake; this loop would then no longer recognize it and
     * would run it a second time through a second link to the same key. Re-stamping here restores what this loop gave
     * it, and only a write's loop pays for it, not every hook run.
     */
    hook._lastWake = epoch;
    if (cell._moves !== m) {
      m = cell._moves;
      p = -1;
    }
  }
};

/**
 * Wakes every hook that read `obj[prop]`. Its last two lines are also `triggerAt`'s (below), a second address on purpose:
 * an optional wake number here cost every plain write 0.4–0.6% (native cycles, SpiderMonkey and JSC), so the shared one
 * lives there; `tests/core-trigger-twins` fails if the two drift apart.
 */
export const trigger = (obj: object, prop: unknown, value: unknown, prevValue: unknown) => {
  const epoch = ++wakes;
  const cell = proxyCallbacks.get(obj)?.get(prop);
  if (cell !== undefined && cell._positions !== 0) wake(cell, { prop: prop as string, value, prevValue } as Change<unknown>, epoch);
  /**
   * **The count moves on EVERY write, read or not**: an unwatched `computed` caches its untracked value against it, and
   * its sources are often keys nobody reads, so counting only writes that woke someone would leave that cache stale. It
   * is one increment, first, with no gate in front of it: a gate on unread writes cost attribute writes more on Firefox
   * than it saved elsewhere.
   */
};


/**
 * **`trigger` with the wake number given**: for ONE write that notifies several channels (a key added: the key and the key
 * set; deleted; defined new; an index past the end: `length` too), so a hook that read more than one of them runs once,
 * as for a whole-array method (`operation`). Its two lines are `trigger`'s, a second address on purpose: an optional
 * `epoch` on `trigger` itself cost every plain write 0.4–0.6% (native cycles, SpiderMonkey and JSC).
 */
export const triggerAt = (obj: object, prop: unknown, value: unknown, prevValue: unknown, epoch: number) => {
  const cell = proxyCallbacks.get(obj)?.get(prop);
  if (cell !== undefined && cell._positions !== 0) wake(cell, { prop: prop as string, value, prevValue } as Change<unknown>, epoch);
};

const sweepIfDue = (keys: Map<unknown, Cell>) => {
  const at = (due ??= new WeakMap()).get(keys) ?? SWEEP_FLOOR;
  if (keys.size < at) return;
  for (const [key, cell] of keys) if (cell._positions === cell._tombstones) keys.delete(key);
  due.set(keys, 2 * keys.size + SWEEP_FLOOR);
};
/**
 * **ONE operation over several keys of `obj`**: the single choke point for every write that changes many keys at once.
 * One wake number and ONE shared change (the shape channel, the object: "re-read"), so a hook reached through many of
 * the keys runs once. Core's whole-array methods (`atomic`) and a collection's `clear` both send through it; a single
 * write keeps `trigger`, the hot path. The count moves even when nothing is subscribed (an unwatched `computed`'s cache
 * reads it). `undefined` when no key of `obj` was ever read.
 */
export const operation = (obj: object, found: Map<unknown, Cell> | undefined = proxyCallbacks.get(obj)) => {
  const at = ++wakes;
  if (found === undefined) return;
  /**
   * What the sender captures lives in THIS block, never in the function's scope: a captured function-scope binding
   * makes V8 allocate the context on EVERY call, the early return included. A block context is made only when the block
   * runs.
   */
  {
    const epoch = at;
    const cells = found;
    const change = { prop: GLOBAL, value: obj } as Change<unknown>;
    return (key: unknown) => {
      const cell = cells.get(key);
      if (cell !== undefined) wake(cell, change, epoch);
    };
  }
};
/** What a `'store'` insert is handed: core's subscribe and notify, the shape channel's name, and the operation. */
export const kit: StoreKit = { track, trigger, shape: GLOBAL, operation };
/**
 * **For `computed`**: the same subscribe and notify, and a read of the wake counter. ALIASES, never `export` on
 * `track`/`trigger` themselves: an exported binding is a live one, which V8 reaches less directly from the traps that
 * call them on every read and write.
 */
export const trackKey = track;
export const triggerKey = trigger;
export const wakeCount = () => wakes;
/**
 * **The ONE rule for "is this a change", and so for notifying: `Object.is`** (Brian's ruling, 2026-11-08), for stores,
 * signals and computeds alike, as TC39's `Signal` and Vue use. `NaN` over `NaN` is no change; `-0` over `0` (or back) is
 * one, stored and notified; every other value as `===`. The built-in itself, not a hand-written form: V8 lowers it to one
 * SameValue node, and a two-branch version with the extra checks on the rare branches cost more (instructions, V8:
 * no-change writes +2.2% vs +0.65%, swap +0.6% vs +0.1%). Bundled, this is a module-local constant, not a live binding.
 */
export const same = Object.is;
/** A new wake number, for a notification sent from outside this file (an unread array's operation; its `ITEMS` walkers). */
export const nextWake = () => ++wakes;
/**
 * The same kit handed to a module OFF the store chain (`$k`), so the keyed module's `createSelector` keeps one cell per
 * selection key on the one notification path. `$`-named: it survives mangling.
 */
seams.$k = kit;
