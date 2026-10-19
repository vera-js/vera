import { proxyCallbacks, tracking, unlinkFrom } from '../store/store.js';
import { isWeakCollection, misuse } from '@verajs/shared-utils';
import { inserts } from '@verajs/inserts';
import type { StoreInsert, StoreKit } from '@verajs/inserts';
import type { Cell, HookRecord, Signal } from '../types.js';
import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';

/**
 * Records the running hook, if any, as depending on `obj[prop]`. A weak collection's subscriptions
 * are keyed by its own entry keys, so they are held in a `WeakMap` — a `Map` would keep every tracked
 * key alive as long as the collection, the retention the weak types exist to avoid. Decided once, on
 * the first tracked read of the object.
 */
const track = (obj: object, prop: unknown) => {
  const sub = tracking.hook;
  if (sub === undefined) return;
  let props = proxyCallbacks.get(obj);
  if (props === undefined) {
    props = (isWeakCollection(obj) ? new WeakMap() : new Map()) as Map<unknown, never>;
    proxyCallbacks.set(obj, props);
  }
  let cell = props.get(prop);
  if (cell === undefined) props.set(prop, (cell = [0]));
  /**
   * PROTOTYPE (probe/cells), **lazy in-order link reuse** (DESIGN-WEAK-CELLS §12). A hook's FIRST run links each read
   * directly, skipping only a consecutive repeat: a hook never re-run (most rows of a big list) pays nothing for reuse. A
   * RE-run walks its previous sources in order: a read matching the cursor just advances it; a repeat of one already
   * linked this run is skipped (below); the first read that DIFFERS unlinks every source not yet matched and links directly from
   * there, so every read is linked at once (a run that reads a key and then writes it hears its own write). The common
   * paths stay INLINE: out of line, a stable re-render paid a call per read (+28%, Node), and `track` must stay small
   * enough for V8 to inline into the traps (BROWSER-LEDGER, the inlining budget).
   */
  const s = sub.s;
  const i = sub.i;
  /**
   * **Already linked, without a stamp:** the cell's LAST link is this hook's, and (on a re-run) it sits in the part of
   * `s` this run already matched, so it is this run's. That covers a repeat however far apart, as long as no other hook
   * linked the key in between: a parent rendering 1000 rows that each read `state.selected` gave that key 1000 links
   * from one hook (vera-5a, 2026-10-19; measured, `.probe/cells/dups.mjs`), now 1. A link BEYOND the cursor is last
   * run's and may be about to leave, so it never counts. A repeat it misses only costs a duplicate link.
   */
  const n = cell.length;
  if (i < 0) {
    if (n > 1 && cell[n - 2] === sub) return;
  } else {
    if (i < s.length && s[i] === cell) {
      sub.i = i + 2;
      return;
    }
    if (n > 1 && cell[n - 2] === sub && (cell[n - 1] as number) < i) return;
    unlinkFrom(sub, i);
    sub.i = -2;
  }
  const at = cell.length;
  cell.push(sub, s.length);
  s.push(cell, at);
};

/**
 * The wake counter: every notification (one write, or one whole-array operation across all its keys) takes a new number,
 * and a hook it reached carries it (`e`), so the operation wakes each hook ONCE. It replaced the `seen` Set an
 * operation allocated.
 */
let wakes = 0;

/**
 * Wakes every hook in `cell` with `signal`. The ONE place a notification goes out, for a single write and a whole-array
 * operation alike. ONE signal per write, shared by every subscriber — it is read, never written (a write to a key with
 * 500 readers made 500).
 *
 * **In insertion order, as the `Set` it replaced** (PROTOTYPE): a raw or sync hook runs inside this loop, in this order
 * (a priority-0 `createHook` runs first), and its run may make a hook LEAVE this cell, which moves the cell's last hook
 * into the leaver's slot, possibly behind the walk. So a leave (the count at index 0 changed) restarts the walk from the start: every hook
 * already reached carries this wake's number and is skipped, so none is missed and none runs twice. A hook that JOINS
 * during the walk is reached too, as a `Set` reached an entry added while it was being iterated.
 */
const wake = (cell: Cell, signal: Signal<unknown>, epoch: number) => {
  let m = cell[0];
  for (let i = 1; i < cell.length; i += 2) {
    const hook = cell[i] as HookRecord;
    if (hook.e === epoch) continue;
    hook.e = epoch;
    hook.$n(signal);
    if (cell[0] !== m) {
      m = cell[0];
      i = -1;
    }
  }
};

/** Wakes every hook that read `obj[prop]`. */
const trigger = (obj: object, prop: unknown, value: unknown, prevValue: unknown) => {
  const cell = proxyCallbacks.get(obj)?.get(prop);
  if (cell !== undefined && cell.length > 1) wake(cell, { prop: prop as string, value, prevValue } as Signal<unknown>, ++wakes);
};

/**
 * The channel an object's **shape** is published on, as distinct from any one key: a key added or
 * removed. Anything that enumerates — `Object.keys`, `for…in`, `{ ...state.o }`, `JSON.stringify` —
 * depends on the set of keys, which no per-key subscription can describe, so it subscribes here.
 * Store modules are handed it in the kit rather than declaring the literal themselves — two bundles
 * declaring one string is a contract nothing checks.
 */
const GLOBAL = '_global';

/** What a `'store'` insert is handed: core's subscribe and notify, and the shape channel's name. */
const kit: StoreKit = { track, trigger, shape: GLOBAL };

/**
 * **A built-in that writes several slots notifies ONCE, after it finishes** (2026-10-18). Called through the proxy,
 * `splice`, `shift`, `sort` … write index by index through the `set` trap: a hook that runs on each write (a raw
 * `createHook`, `useSyncEffect`) ran BETWEEN those writes and saw the array half-shifted, a value twice or a hole, and
 * `splice(400, 1)` on 1000 rows sent 601 notifications. Here the method runs on the RAW array, so no trap fires midway,
 * and every hook subscribed to anything it changed (an index in the range; `length` and the shape when the length
 * moved) is told once, with one signal. What crosses back goes through the store as a read would: removed values and
 * `sort`'s comparator arguments are proxies, and the array itself comes back as the store array.
 *
 * What it does NOT cover, on purpose: a user's own multi-statement write (`Object.assign(store, …)`) is several writes
 * in the language's terms and stays so; a method called OFF the array (`Array.prototype.push.apply(state.rows, more)`)
 * never reads it through the store, so it still writes index by index — call `state.rows.push(...more)`; `sort` on a
 * SPARSE array moves its holes without changing its length, and enumeration readers are not told; a `sort` comparator
 * that WRITES to the store (caching a key on a row) is notified mid-sort, as any write is. Each read of a
 * mutator hands back a new function (`state.rows.push !== state.rows.push`).
 */
const MUTATORS = new Set(['splice', 'push', 'pop', 'shift', 'unshift', 'sort', 'reverse', 'fill', 'copyWithin']);
/**
 * A store proxy → the raw object it wraps; anything else as it is. Used where a whole-array method INSERTS values, so
 * raw data never holds a proxy (why: see the `set` trap's "stored RAW"). A proxy of another kind or another copy of core
 * does not answer `RAW` and passes through unchanged.
 */
const unwrap = (value: unknown) =>
  value !== null && typeof value === 'object' ? ((value as Record<symbol, unknown>)[RAW] ?? value) : value;
const toStore = (value: unknown) => (value !== null && typeof value === 'object' ? createProxy(value) : value);
const atomic = (obj: unknown[], name: string, method: (...args: unknown[]) => unknown, proxy: unknown) =>
  function (this: unknown, ...args: unknown[]) {
    /** Borrowed onto something else (`state.rows.push.call(other, x)`): that is not this store's write. */
    if (this !== proxy) return method.apply(this, args);
    const before = obj.length;
    const compare = args[0];
    if (name === 'sort' && typeof compare === 'function') args[0] = (a: unknown, b: unknown) => compare(toStore(a), toStore(b));
    /** What the method INSERTS is stored raw, as a `set` stores it (`push(state.rows[0])` hands in a proxy). */
    else for (let i = name === 'splice' ? 2 : 0; i < (name === 'fill' ? 1 : args.length); i++) args[i] = unwrap(args[i]);
    const result = method.apply(obj, args);
    const after = obj.length;
    const keys = proxyCallbacks.get(obj);
    if (keys !== undefined) {
      /**
       * The indices that can have changed, to the longer end: an append's and a pop's start at the tail; everything
       * else from 0. `splice` could start at its own start, but that cost 47 B and saves only a re-run of a hook that
       * reads an index BELOW it (`each` rows read their item, never an index: measured, the same rows re-render).
       */
      const lo = name === 'push' ? before : name === 'pop' ? after : 0;
      const hi = before > after ? before : after;
      /**
       * ONE signal for the whole operation, on the shape channel with the array as its value: "the contents changed,
       * re-read". Not `length`: `sort`, `reverse`, `fill` and a same-count `splice` keep it, and `1000 → 1000` would
       * read as nothing happened.
       */
      const signal = { prop: GLOBAL, value: obj } as Signal<unknown>;
      /** One wake number for the whole operation: a hook reached through several keys runs once. */
      const epoch = ++wakes;
      const send = (key: unknown) => {
        const cell = keys.get(key);
        if (cell !== undefined) wake(cell, signal, epoch);
      };
      /**
       * The touched indices, through whichever is SHORTER: the range, or the keys anyone subscribed to. A list rendered
       * through a raw walk subscribes no index at all (`ITEMS` instead), so its splice checks a handful of keys, not 1000.
       */
      if (keys.size < hi - lo) {
        for (const key of keys.keys())
          if (typeof key === 'string') {
            const index = +key;
            if (index >= lo && index < hi) send(key);
          }
      } else for (let i = lo; i < hi; i++) send(String(i));
      send(ITEMS);
      if (after !== before) {
        send('length');
        send(GLOBAL);
      }
    }
    if (result === obj) return proxy;
    return name === 'splice' ? (result as unknown[]).map(toStore) : toStore(result);
  };

/**
 * The exact property the `set` trap is writing, which `defineProperty` reads to recognize its own
 * re-entry. `Reflect.set` with the proxy as receiver — what makes a setter run with `this` bound to the
 * proxy, so writes inside one are tracked — routes the write through the receiver's
 * `[[DefineOwnProperty]]`, which re-enters that trap for a write `set` already reports. Matching on the
 * pair suppresses exactly that one duplicate: a setter that defines some *other* property still
 * notifies. Cleared in a `finally`, so a throwing setter cannot leave writes suppressed.
 */
let writingObj: object | null = null;
let writingProp: PropertyKey | null = null;

/**
 * **One handler per TYPE of value, owned here and shared by every proxy of that type** — keyed by the
 * engine's own tag (`Object.prototype.toString`, a constant string: no allocation on a lookup).
 *
 * Core's handler serves plain objects (class instances included) and arrays. Every other type — a
 * `Map`, a `Date`, a typed array, a DOM element — has internal slots a proxy in front of it breaks
 * (`this is not a Date object`), so it starts with an EMPTY handler: a store of one is transparent, and a
 * nested one is handed back raw. A `'store'` insert may claim a type or wrap core's handler.
 *
 * **A decision is made when its inputs change, never per store or per read.** A type is decided the
 * first time one is met; `wire` decides every known type again and writes the result INTO the owned
 * handler objects, so every existing proxy follows — a module wired after the app's stores exist (a
 * store at module scope, imported before the entry wires) reaches them all. The handlers are owned
 * copies because what a chain returns may be shared — core's own serves two types — and must never be
 * rewritten in place. Replaced per-store first-use placeholders, which cost ~2.6 µs of every component
 * with a store (measured): seven closures per store.
 */
const TAG = Object.prototype.toString;
const types = new Map<string, ProxyHandler<object>>();
/** The owned handlers some insert or core claimed — an empty one means "not reactive, hand back raw". */
const claimed = new WeakSet<object>();

/**
 * Store modules that threw while deciding: skipped for EVERY type until replaced — a module that fails
 * for one type is not half-installed across the others, and one bad module cannot make every later
 * `wire` throw. Replacing it (wiring a new function at its priority) is what brings it back.
 */
const broken = new WeakSet<StoreInsert>();

/** What the chain chooses for a type (by its tag): core's handler or nothing, then each insert in turn. */
const decide = (tag: string) => {
  const type = tag.slice(8, -1).toLowerCase();
  /**
   * Arrays get their own handler (`arrayHandler`: a leaner read, the whole-array methods, the `ITEMS` channel); records
   * keep the full one. Both are core's defaults and every `'store'` insert still sees and may wrap either.
   */
  let chosen: ProxyHandler<object> | undefined = type === 'array' ? arrayHandler : type === 'object' ? handler : undefined;
  /** A plain loop: `forEach` allocated a closure per decision — measured, once any module is wired. */
  const chain = inserts.get('store') as StoreInsert[] | undefined;
  if (chain)
    for (let i = 0; i < chain.length; i++) {
      const insert = chain[i];
      if (broken.has(insert)) continue;
      try {
        chosen = insert(type, chosen, kit) ?? chosen;
      } catch (error) {
        broken.add(insert);
        throw error;
      }
    }
  return chosen;
};

/**
 * **"Is this one of ours?" — asked of a value through the language, never a table.** Every store proxy
 * answers `MARK in proxy` with `true`: `settle` wraps each owned handler's `has` (a cold trap — the `in`
 * operator only), so the answer holds whatever handler a store module installed, and `shallowHandler`
 * answers it too. It replaced mapping every proxy to itself in `proxies`, which cost ~380 ns of a 514 ns
 * `createStore` — a WeakMap keyed by a PROXY is that expensive to insert into (measured, 74% of it).
 * Any target can answer it, frozen or not: the language checks a `has` trap only when it says `false`.
 */
const MARK = Symbol();
const marked = (has: ProxyHandler<object>['has']) => (target: object, prop: string | symbol) =>
  prop === MARK || (has ? has(target, prop) : Reflect.has(target, prop));

/**
 * **Decides `tags` and writes each into its type's owned handler** — every trap cleared, then the
 * chosen one's copied in, so every proxy of the type follows. When a module throws it is retired
 * (`broken`) and EVERY type is decided again without it — the types it had already joined included —
 * so each handler reflects exactly the healthy modules before the first failure is thrown: from the
 * `wire` that brought the module in, or the read that first met a new type — once.
 */
const settle = (tags: string[]) => {
  const errors: unknown[] = [];
  for (let i = 0; i < tags.length; i++) {
    const owned = types.get(tags[i]) as Record<string, unknown>;
    try {
      const chosen = decide(tags[i]);
      for (const trap in owned) owned[trap] = undefined;
      Object.assign(owned, chosen);
      owned.has = marked(chosen?.has);
      claimed[chosen ? 'add' : 'delete'](owned);
    } catch (error) {
      errors.push(error);
      tags = [...types.keys()];
      i = -1;
    }
  }
  if (errors.length) throw errors[0];
};

/**
 * **A write or delete the LANGUAGE refused, explained — development only** (main had this; the lean rebuild dropped it).
 * A proxy reports a refused write by returning `false`, and the engine turns that into "'set' on proxy: trap returned
 * falsish" — a message about the trap, framework internals the reader never wrote. `createStore(Object.freeze(x))` is
 * an ordinary thing to write. Every case is one of the language's own invariants (frozen; sealed or non-extensible with
 * a new key; a non-writable property; a getter with no setter), derived from the target. It throws either way, so the
 * two builds agree on what the program does; production folds the check out of the hot write path.
 */
const refusedWrite = (obj: object, prop: PropertyKey, verb: 'changed' | 'deleted') => {
  const key = `\`${String(prop)}\``;
  const own = Reflect.getOwnPropertyDescriptor(obj, prop);
  const state = Object.isFrozen(obj) ? 'frozen' : Object.isSealed(obj) ? 'sealed' : null;
  const why = !own
    ? `the object is ${state ?? 'not extensible'}, so ${key} cannot be added`
    : own.get && !own.set
      ? `${key} has a getter and no setter`
      : state
        ? `the object is ${state}, so ${key} cannot be ${verb}`
        : `${key} is not ${verb === 'deleted' ? 'configurable' : 'writable'}`;
  return new TypeError(misuse('createStore', 'store-refused', __DEV__ && PROSE['store-refused'](verb === 'deleted' ? 'delete' : 'write', why)));
};

/**
 * **A collection in a store with nothing to make it reactive is said once, in development** (main had this; the lean
 * rebuild dropped it). A `Map`/`Set` no `'store'` module claims is handed back RAW — it works and never updates the
 * page, the worst failure mode there is: silent. Checked when its TYPE is first decided (once per page, so once), a
 * microtask later — a module wired after a store was first read (supported: `wire` re-decides) is not a false alarm.
 */
let warnedNoCollections = false;
const COLLECTION = /^\[object (?:Weak)?(?:Map|Set)\]$/;

/** The owned handler for `value`'s type, deciding the type the first time one is met. */
const handlerFor = (value: object) => {
  const tag = TAG.call(value);
  let owned = types.get(tag);
  if (owned === undefined) {
    types.set(tag, (owned = {}));
    settle([tag]);
    if (__DEV__ && COLLECTION.test(tag) && !warnedNoCollections)
      queueMicrotask(() => {
        if (warnedNoCollections || claimed.has(types.get(tag)!)) return;
        warnedNoCollections = true;
        console.error(diagnostic('core', `a ${tag.slice(8, -1)} in a store`, 'no-collections', __DEV__ && PROSE['no-collections']()));
      });
  }
  return owned;
};

/** Every known type decided again — what `wire` calls when the `'store'` chain changed. */
export const redecideStores = () => settle([...types.keys()]);

/**
 * One handler for every store: a read subscribes, and a write that changes something wakes the
 * readers — through every door the language has, not only `=`: `in`, enumeration, `delete` and
 * `Object.defineProperty` each read or change what a template can show.
 */
/**
 * **Parents that are not extensible**, whose object-valued properties `get` hands back raw — marked where
 * they become so, never asked on the read path: `Object.isExtensible` in the trap cost ~170 ns on every
 * two-hop read (measured: 511 ns against 372 with this set), though the call alone is ~12 ns — its
 * presence changes how the engine compiles the trap. A value is marked when it is wrapped, and a target
 * when it is prevented from extending through the store (`preventExtensions`, which `Object.freeze` and
 * `Object.seal` call first). **Freezing the RAW object behind a
 * store, after the store has wrapped it, is not seen** — nothing in the store is told — and a later
 * object-valued read would then be refused by the engine; freeze a value before handing it to a store,
 * or through the store.
 */
const FIXED = new WeakSet<object>();
/**
 * An object-valued read hands back its store: cached per value, decided on the first miss. ONE function for the object
 * handler, the array handler and the raw walk, so the frozen-slot and store-in-a-store rules cannot diverge between them.
 */
const nested = (obj: object, prop: PropertyKey, value: object) => {
  let proxy = cached(value);
  /** A store in a slot answers itself: remembered in the WeakMap, never by defining through it (a trap). */
  if (proxy === undefined && MARK in value) proxies.set(value, (proxy = value));
  if (proxy === undefined) {
    const own = Reflect.getOwnPropertyDescriptor(obj, prop);
    const owned = own && !own.writable && !own.configurable ? undefined : handlerFor(value);
    remember(value, (proxy = owned && claimed.has(owned) ? wrap(value, owned) : null));
  }
  return proxy ?? value;
};
const handler: ProxyHandler<object> = {
  get(obj: object, prop, receiver) {
    /**
     * Core's two private keys, answered before anything is tracked: the cache field is never visible through a store
     * (and reading it on a proxy must not subscribe), and `RAW` is how core turns a store back into its object (`set`).
     */
    if (prop === PROXY) return undefined;
    if (prop === RAW) return obj;
    const value = Reflect.get(obj, prop, receiver);
    track(obj, prop);
    /**
     * **A property the language says must be returned verbatim is.** A non-writable,
     * non-configurable data property may not be answered with a substitute — the engine throws — and
     * every property of a frozen object is one, so reading a nested object out of
     * `createStore(Object.freeze(config))` threw. A non-extensible parent (`FIXED`) is handed back raw
     * without asking further; an extensible one can still carry an explicitly readonly slot, which is
     * caught on the cache miss and remembered as `null` — "never wrap" — so the descriptor is read once
     * per value, never per read. A value of a type nothing claims is remembered the same way.
     */
    return value === null || typeof value !== 'object' || FIXED.has(obj) ? value : nested(obj, prop, value);
  },
  /** `key in state.form` decides what renders, so it subscribes like a read. */
  has(obj, prop) {
    track(obj, prop);
    return Reflect.has(obj, prop);
  },
  ownKeys(obj) {
    track(obj, GLOBAL);
    const keys = Reflect.ownKeys(obj);
    /**
     * The cache field is left out only while that is LEGAL: a proxy must list every key of a non-extensible target, so
     * on an object frozen after the field was defined (outside the store, too) the field shows rather than throwing.
     */
    if (Object.isExtensible(obj)) {
      const at = keys.indexOf(PROXY);
      if (at !== -1) keys.splice(at, 1);
    }
    return keys;
  },
  set(obj, prop, value, receiver) {
    /**
     * **A store written into a store is stored RAW** (2026-10-18): what a read hands back is unchanged (one proxy per
     * object, from the cache), but the raw data never holds a proxy, so a walk over it never meets one (a read on a
     * proxy is a trap call the engine cannot cache: Chrome's swap paid +12% for two such slots). A store of another
     * kind (`createShallow`) does not answer `RAW` and is kept as it is.
     */
    if (value !== null && typeof value === 'object') {
      const raw = (value as Record<symbol, object | undefined>)[RAW];
      if (raw !== undefined) value = raw;
    }
    const prevValue = Reflect.get(obj, prop, receiver);
    if (prevValue === value) return true;
    /**
     * **The same nested object, read back and assigned, is not a change either.** Reads hand out the
     * proxy while the target holds the raw object, so `state.o = state.o` arrives as proxy-against-raw
     * — and `state.items = update(state.items)`, returning its input when there is nothing to do, is
     * how "no change" is normally written. It also stops the proxy being written into the target.
     */
    /** `cached` reads a field, so `prevValue` must be an object first (a primitive has no store). */
    if (value !== null && typeof value === 'object' && prevValue !== null && typeof prevValue === 'object' && cached(prevValue) === value) return true;
    /** A data record needs no descriptor: no setter can run, and "added" is just "not own" (`dataRecord`). */
    const fast = prop !== '__proto__' && dataRecord(obj);
    const own = fast ? undefined : Reflect.getOwnPropertyDescriptor(obj, prop);
    const added = fast ? !Object.hasOwn(obj, prop) : own === undefined;
    /**
     * Assigning past the end of an array moves `length` as an internal consequence, never through
     * this trap — so `push` and `unshift` notified nothing that read `length`. Captured before the write.
     */
    /** A symbol key (a library's tag on an array) is never an index — and `+symbol` throws. */
    const grew = Array.isArray(obj) && typeof prop === 'string' && +prop >= obj.length;
    writingObj = obj;
    writingProp = prop;
    let written;
    try {
      /**
       * **The proxy is the receiver only where a setter could run.** Passing it is what binds a setter's
       * `this` to the proxy (so writes inside one are tracked) — and for a plain data property it makes
       * the language re-enter `defineProperty` through this proxy: a second trap call on every write.
       * An own writable DATA property, or a key the object does not have anywhere on its chain, runs
       * no setter, so it is written directly — measured: a write 55% faster, a write-to-render update
       * 45% (448 → 200 ns, 609 → 332 ns). An own or inherited accessor keeps the receiver.
       */
      written = (fast || (own ? own.writable === true : !(prop in obj)))
        ? Reflect.set(obj, prop, value)
        : Reflect.set(obj, prop, value, receiver);
    } finally {
      writingObj = null;
    }
    if (__DEV__ && !written) throw refusedWrite(obj, prop, 'changed');
    if (written) {
      trigger(obj, prop, value, prevValue);
      if (added) trigger(obj, GLOBAL, value, prevValue);
      if (grew) trigger(obj, 'length', (obj as unknown[]).length, +(prop as string));
    }
    return written;
  },
  /**
   * The other way to write a property, which does not pass through `set` — how `Object.freeze` writes
   * and how adapters install accessors. Descriptors are compared, never read back: `Reflect.get` would
   * invoke an accessor at definition time, untracked, on the raw object.
   */
  defineProperty(obj, prop, descriptor) {
    if (obj === writingObj && prop === writingProp) return Reflect.defineProperty(obj, prop, descriptor);
    /** An accessor or a read-only property may make it no longer a data record (`dataRecord`). */
    if (descriptor.get !== undefined || descriptor.set !== undefined || descriptor.writable === false) unclassify(obj);
    const previous = Reflect.getOwnPropertyDescriptor(obj, prop);
    const defined = Reflect.defineProperty(obj, prop, descriptor);
    if (defined) {
      if (!previous || descriptor.value !== previous.value || descriptor.get !== previous.get)
        trigger(obj, prop, descriptor.value, previous?.value);
      if (!previous) trigger(obj, GLOBAL, descriptor.value, undefined);
    }
    return defined;
  },
  /**
   * Where a target stops being extensible through the store — `Object.preventExtensions`, and
   * `Object.freeze`/`Object.seal`, which call it first — so `get` knows (`FIXED`).
   */
  /** A new prototype may carry setters: the record is asked again (`dataRecord`). */
  setPrototypeOf(obj, proto) {
    unclassify(obj);
    return Reflect.setPrototypeOf(obj, proto);
  },
  preventExtensions(obj) {
    FIXED.add(obj);
    /** The cache field leaves first, for the WeakMap: a non-extensible target's keys could no longer hide it. */
    const slot = (obj as Record<symbol, Slot | undefined>)[PROXY];
    if (slot !== undefined && slot.o === obj && Reflect.deleteProperty(obj, PROXY)) proxies.set(obj, slot.p);
    return Reflect.preventExtensions(obj);
  },
  /** Deleting a key changes both the key's value (to `undefined`, what a read now returns) and the shape. */
  deleteProperty(obj, prop) {
    const had = prop in obj;
    const prevValue = had ? Reflect.get(obj, prop) : undefined;
    const deleted = Reflect.deleteProperty(obj, prop);
    if (__DEV__ && !deleted && had) throw refusedWrite(obj, prop, 'deleted');
    if (deleted && had) {
      trigger(obj, prop, undefined, prevValue);
      trigger(obj, GLOBAL, undefined, prevValue);
    }
    return deleted;
  },
};

/**
 * Raw object → its proxy, for every store at once. The same object always comes back as the same
 * proxy — `state.a === state.a`, and `createStore(config) === createStore(config)` — where a fresh
 * proxy per read broke every identity comparison in consumer code (a list re-keying, a memo missing).
 * One map serves all stores because a value's handler is decided by its type (`handlerFor`), never
 * by which store reached it. **A store placed inside another store** — `state.child = otherStore` — is
 * recognized (`MARK`, then remembered here as mapping to itself) and handed back as it is, never wrapped
 * a second time, which tracked every read twice and notified every write twice.
 */
const proxies = new WeakMap<object, object | null>();
/**
 * **The same cache, kept ON the raw object** for the items a walk meets (`promote`), where the language allows (Brian,
 * 2026-10-18): a field under a Symbol
 * private to this copy of core, defined non-enumerable, so `Object.keys`, `for…in`, spreading and `JSON.stringify`
 * never see it (`Object.getOwnPropertySymbols` on the RAW object does; the store's `ownKeys` filters it). A WeakMap
 * lookup was most of a store list's walk in Firefox (measured: swap −30%, remove −25%). The field names its owner, so
 * an object that merely INHERITS from a stored one never answers with the parent's proxy. Where it can't be defined (a
 * frozen, sealed or non-extensible object), the WeakMap above keeps the answer.
 */
const PROXY = Symbol();
/**
 * `o` the owner (inheritance-safe), `p` its store (or `null`: hand back verbatim), `d` whether it is a DATA RECORD —
 * `1` yes, `0` no, `undefined` not yet asked (`dataRecord`, on its first write through the store).
 */
type Slot = { o: object; p: object | null; d: 0 | 1 | undefined };
const cached = (value: object): object | null | undefined => {
  const slot = (value as Record<symbol, Slot | undefined>)[PROXY];
  return slot !== undefined && slot.o === value ? slot.p : proxies.get(value);
};
/**
 * **Is a write to `obj` free of setters, so it needs no property descriptor?** (2026-10-18) A DATA RECORD — its
 * prototype `Object.prototype`, `Array.prototype` or `null`, every own property a writable data property — has no
 * setter anywhere a write can reach (`__proto__` aside, which `set` routes the full way). Decided once, on the first
 * write through the store, and remembered on its field: the `set` trap's descriptor read was 5% of a store-row update
 * (measured: update every 10th, Chrome 189 → 180 µs, Firefox 222 → 210). What makes a record otherwise THROUGH the
 * store — defining an accessor or a read-only property, replacing the prototype — clears it (`defineProperty`,
 * `setPrototypeOf`). Done to the raw object behind the store's back, an accessor added later runs with the raw object
 * as `this`: a documented edge. An object without a field (frozen, sealed) is never one.
 */
const dataRecord = (obj: object): boolean => {
  const slot = (obj as Record<symbol, Slot | undefined>)[PROXY];
  if (slot === undefined || slot.o !== obj) return false;
  let d = slot.d;
  if (d === undefined) {
    const proto = Object.getPrototypeOf(obj);
    d = 0;
    if (proto === Object.prototype || proto === Array.prototype || proto === null) {
      d = 1;
      const all = Object.getOwnPropertyDescriptors(obj) as Record<PropertyKey, PropertyDescriptor>;
      for (const key of Reflect.ownKeys(all))
        if (all[key].writable !== true) {
          d = 0;
          break;
        }
    }
    slot.d = d;
  }
  return d === 1;
};
/** A record's classification is dropped where it may have stopped being one (it is asked again on the next write). */
const unclassify = (obj: object) => {
  const slot = (obj as Record<symbol, Slot | undefined>)[PROXY];
  if (slot !== undefined && slot.o === obj) slot.d = undefined;
};
const remember = (value: object, proxy: object | null) => {
  proxies.set(value, proxy);
};
/**
 * **The field is given only where a walk reads it** (2026-10-18): defining it on EVERY object at its first proxying cost
 * store rows without `each` 8% of creating 1 000 (Chrome; with it on the WeakMap only, the landed figure came back:
 * 3.59 → 3.33 vs 3.32 ms), while only `walkItems` gains from it (Firefox swap −29%, remove −24%). So `remember` keeps
 * the WeakMap, and the walk promotes the items it meets. Never onto a proxy (`MARK`'s self-mapping): defining through one
 * is its own trap. A non-extensible object refuses it and keeps the WeakMap.
 */
const promote = (value: object, proxy: object | null) => {
  Reflect.defineProperty(value, PROXY, { value: { o: value, p: proxy, d: undefined } satisfies Slot, writable: true, configurable: true });
};

/** A new proxy over `data` — over a non-extensible one, marked `FIXED`. */
const wrap = (data: object, chosen: ProxyHandler<object>) => {
  const proxy = new Proxy(data, chosen);
  if (!Object.isExtensible(data)) FIXED.add(data);
  return proxy;
};

/**
 * **An array's own handler** (2026-10-18): the object handler with a read path for arrays alone. A read is `obj[prop]`,
 * no receiver: an array's slots and `length` are data, and `Reflect.get` with a receiver cost 22% of every read
 * (measured, V8). An accessor DEFINED on a store array runs with the raw array as `this`, untracked: a documented edge.
 * The whole-array methods are recognized here only, so a record's function-valued read no longer tests for them.
 *
 * Every change to an array's CONTENTS also wakes its `ITEMS` channel: an index written, defined or deleted, `length`
 * moved (a truncating `length = 0` included), a whole-array method. A walk subscribes there ONCE (`walkItems`) instead of
 * once per index. Records never pay for it: only these traps fire it.
 */
const ITEMS = Symbol();
/**
 * Answered by the object and array handlers (core's own stores): the raw object behind the proxy. Two uses: a walk
 * reads a list's raw array in one trap (`walkItems`), and a store written into a store is stored raw (`set`).
 */
const RAW = Symbol();
/** Wakes whoever walks this array (`walkItems` subscribed them to `ITEMS`), with one "contents changed" signal. */
const items = (obj: object) => {
  const cell = proxyCallbacks.get(obj)?.get(ITEMS);
  if (cell !== undefined && cell.length > 1) wake(cell, { prop: GLOBAL, value: obj } as Signal<unknown>, ++wakes);
};
const arrayHandler: ProxyHandler<object> = {
  ...handler,
  get(obj: object, prop, receiver) {
    /** The private keys, as in the object handler. */
    if (prop === RAW) return obj;
    if (prop === PROXY) return undefined;
    const value = (obj as Record<PropertyKey, unknown>)[prop];
    track(obj, prop);
    if (value === null || typeof value !== 'object' || FIXED.has(obj))
      /** A built-in that writes several slots: run whole, notify once (`atomic`, above). */
      return typeof value === 'function' && MUTATORS.has(prop as string)
        ? atomic(obj as unknown[], prop as string, value as (...args: unknown[]) => unknown, receiver)
        : value;
    return nested(obj, prop, value);
  },
  /**
   * The three write traps add ONE thing to the object handler's: waking `ITEMS` when the contents actually changed. A
   * write of the same value, or a refused one, wakes nothing; `length` is compared too, since a truncating
   * `length = n` deletes indices without any index trap firing.
   */
  set(obj, prop, value, receiver) {
    const before = (obj as Record<PropertyKey, unknown>)[prop];
    const length = (obj as unknown[]).length;
    const written = handler.set!(obj, prop, value, receiver);
    if (written && ((obj as Record<PropertyKey, unknown>)[prop] !== before || (obj as unknown[]).length !== length)) items(obj);
    return written;
  },
  defineProperty(obj, prop, descriptor) {
    const defined = handler.defineProperty!(obj, prop, descriptor);
    /** The `set` trap's own re-entry is reported by `set`. */
    if (defined && !(obj === writingObj && prop === writingProp)) items(obj);
    return defined;
  },
  deleteProperty(obj, prop) {
    /** Only a key that was there: deleting a missing index changes nothing anyone walked. */
    const had = prop in obj;
    const deleted = handler.deleteProperty!(obj, prop);
    if (deleted && had) items(obj);
    return deleted;
  },
};

/**
 * **Walks a store array's RAW slots under ONE subscription** — what a keyed list's render does on every update. Through
 * the proxy each slot costs a trap (≈ 33 ns in V8 even with no trap function) plus a per-index subscription; here the
 * running hook subscribes to `ITEMS` once and `visit` gets each slot raw and as a read would hand it back. `false` when
 * `list` is not an array store (a plain array, a subclass): the caller walks it itself. Handed to modules as `$w`.
 */
export const walkItems = (list: unknown, visit: (raw: unknown, item: unknown) => void): boolean => {
  const raw = list !== null && typeof list === 'object' ? (list as Record<symbol, unknown[] | undefined>)[RAW] : undefined;
  if (raw === undefined || Object.getPrototypeOf(raw) !== Array.prototype) return false;
  track(raw, ITEMS);
  const fixed = FIXED.has(raw);
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i];
    if (value === null || typeof value !== 'object' || fixed) visit(value, value);
    else {
      /**
       * The cache field read HERE, not through `cached`: this site only ever meets one list's items, so the engine keeps
       * the read monomorphic; `cached`, shared by every object in the app, goes megamorphic (measured: Chrome swap +12%).
       */
      const slot = (value as Record<symbol, Slot | undefined>)[PROXY];
      if (slot !== undefined && slot.o === value) visit(value, slot.p ?? value);
      else {
        const item = nested(raw, i, value);
        if (item !== value) promote(value, item);
        visit(value, item);
      }
    }
  }
  return true;
};

/**
 * A SHALLOW view of `data`: reads subscribe and writes notify like any store, but what a read returns
 * is handed back as it is — never wrapped. `shallowRef`'s handler: a large immutable value (a list of
 * rows, a parsed document) behind a deep store costs a proxy and a subscription per nested read, for
 * objects that never mutate; replacing `.value` is the change that matters, and it notifies.
 */
const shallowHandler: ProxyHandler<object> = {
  ...handler,
  has: marked(handler.has),
  get(obj, prop, receiver) {
    track(obj, prop);
    return Reflect.get(obj, prop, receiver);
  },
};
export const createShallow = <T extends object>(data: T): T => wrap(data, shallowHandler) as T;

/** A reactive view of `data`: reads inside a hook subscribe it, writes re-run it. Nested objects are reactive too. */
export const createProxy = <T extends object>(data: T): T => {
  let proxy = cached(data);
  if (proxy) return proxy as T;
  if (MARK in data) return data;
  /**
   * Behind its type's handler, claimed or not: a store of a type nothing claims yet is transparent, and
   * becomes reactive the moment a module claiming the type is wired. `null` cached for a nested value
   * means "hand back verbatim" in that slot; asked for as a store in its own right the object is decided
   * afresh, since a frozen *slot* says nothing about the object itself.
   */
  proxy = wrap(data, handlerFor(data));
  if (cached(data) === undefined) remember(data, proxy);
  return proxy as T;
};
