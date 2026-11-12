/** Core's own traps: what a read, a write and a whole-array method do to a record or an array in a store. */
import { proxyCallbacks } from '../store/store.js';
import { diagnostic, errorOnce, misuse } from '@verajs/shared-utils';
import type { StoreInsert } from '@verajs/inserts';
import type { Change, Slot } from '../types.js';
import { PROSE } from '../diagnostics.js';
import { mapped } from './autoMap.js';
import { claimedHandlers, handedBackUnclaimed, handlerFor, useDefaults } from './door.js';
import { FIXED, MARK, PROXY, RAW, cached, dataRecord, proxies, remember, unclassify, wrap } from './identity.js';
import { GLOBAL, nextWake, operation, same, track, trigger, triggerAt, wake } from './track.js';

/**
 * The exact property the `set` trap is writing, which `defineProperty` reads to recognize its own
 * re-entry. `Reflect.set` with the proxy as receiver — what makes a setter run with `this` bound to the
 * proxy, so writes inside one are tracked — routes the write through the receiver's
 * `[[DefineOwnProperty]]`, which re-enters that trap for a write `set` already reports. Matching on the
 * pair suppresses exactly that one duplicate: a setter that defines some *other* property still
 * notifies. Cleared in a `finally`, so a throwing setter cannot leave writes suppressed. The pair: `writingObj` and
 * `writingProp`.
 */
let writingObj: object | null = null;
let writingProp: PropertyKey | null = null;
/** `Object.prototype.__lookupSetter__`: the setter of the first property named `key` along the chain, in one call. */
const LOOKUP_SETTER = (Object.prototype as unknown as { __lookupSetter__(this: object, key: PropertyKey): unknown }).__lookupSetter__;
/**
 * **A built-in that writes several slots notifies ONCE, after it finishes.** Called through the proxy, `splice`,
 * `shift`, `sort` … write index by index through the `set` trap, and a hook that runs on each write (an immediate hook, a
 * `'sync'` effect) would run BETWEEN those writes and see the array half-shifted, a value twice or a hole, with one
 * notification per slot moved. Here the method runs on the RAW array, so no trap fires midway, and every hook
 * subscribed to anything it changed (an index in the range; `length` and the shape when the length moved) is told once,
 * with one signal. What crosses back goes through the store as a read would: removed values and `sort`'s comparator
 * arguments are proxies, and the array itself comes back as the store array.
 *
 * What it does NOT cover, on purpose: a user's own multi-statement write (`Object.assign(store, …)`) is several writes
 * in the language's terms and stays so; a method called OFF the array (`Array.prototype.push.apply(state.rows, more)`)
 * never reads it through the store, so it still writes index by index (call `state.rows.push(...more)`); `sort` on a
 * SPARSE array moves its holes without changing its length, and enumeration readers are not told; a `sort` comparator
 * that WRITES to the store is notified mid-sort, as any write is. Each read of a mutator hands back a new function
 * (`state.rows.push !== state.rows.push`).
 */
const MUTATORS = new Set(['splice', 'push', 'pop', 'shift', 'unshift', 'sort', 'reverse', 'fill', 'copyWithin']);
/**
 * Development: the Array subclasses already SCANNED for an owned mutator: a cache of work done, not a warning flag (the
 * warning is `errorOnce`'s, once per class). A class that owns none is never scanned again on the reads that follow.
 * Module-level because it spans every store; read only under `__DEV__`, so production drops it with the check.
 */
const inspected = /* @__PURE__ */ new WeakSet<object>();
/**
 * **Development: an Array subclass that OWNS a mutator, met by a store** (Brian's ruling, 2026-11-11: a documented limit,
 * said once per class). Its override runs with the raw array as `this`, so a field it writes is not tracked (the items
 * and the length are, through the store's own notification). Called where a store first meets an array inside it
 * (`nested`, every read of one), and only under `__DEV__`: on no path of production's. Not from `createProxy` (a store
 * whose own root is the subclass): importing this there reorders the production bundle's modules, which changes code
 * the minifier emits elsewhere.
 */
const subclassMutator = (data: object) => {
  if (!Array.isArray(data)) return;
  const first = Object.getPrototypeOf(data) as object | null;
  if (first === Array.prototype || first === null || inspected.has(first)) return;
  inspected.add(first);
  for (let proto: object | null = first; proto !== null && proto !== Array.prototype; proto = Object.getPrototypeOf(proto))
    for (const name of MUTATORS)
      if (Object.hasOwn(proto, name)) {
        const cls = (first as { constructor?: { name?: string } }).constructor?.name || 'an Array subclass';
        errorOnce('core', `${cls} in a store`, 'subclass-mutator', __DEV__ && (() => PROSE['subclass-mutator'](cls, name)), first);
        return;
      }
};
/**
 * **What a store keeps of a value written into it.** The ONE place a write (`set`) and a whole-array method's inserted
 * values (`atomic`) decide it. A store proxy → its raw object, so raw data never holds this store's proxy at the top
 * (why: the `set` trap's "stored RAW"). A plain ARRAY holding this store's proxies one level down → a raw COPY:
 * `state.rows = state.rows.filter(…)` (also `slice`, `[...rows].sort()`) hands back an array of the proxies the reads
 * produced, and stored as it is, every later list walk would meet a proxy in every slot (measured: dropping this copy
 * cost a list replaced by a reordered copy of its own rows 4–8%, every engine). Anything else is stored AS GIVEN.
 *
 * - **A plain RECORD is stored as given, never scanned** (Brian, 2026-11-08): `state.row = { ...r, label }` keeps a
 *   nested store child as its proxy in the raw data. Scanning ran the record's getters on every write (a throwing one
 *   threw), and dropping the scan was faster on every engine (a record holding a store child, written and read through:
 *   SpiderMonkey −32%, JSC −16%, Node −10%; V8 −2%). Reading through the store is unchanged; only the raw data differs,
 *   and `snapshot` gives a plain copy at every depth.
 *
 * - **Copied only when a proxy is found, never rewritten in place:** the user's own array is never changed behind their
 *   back. **One level:** a proxy two levels down is kept. **Plain arrays only:** a subclass, a frozen array, a collection
 *   is stored as it is. A copy keeps holes; an array's non-index properties are not copied.
 *
 * - **A known limit:** the array scan reads every index, so a getter DEFINED on an array index
 *   (`Object.defineProperty(list, 0, { get })`) runs when that array is written into a store (a row pins it).
 *
 * - A proxy of another kind or of another copy of core does not answer `RAW` and stays as it is.
 */
const unwrap = (value: unknown) =>
  value !== null && typeof value === 'object' ? ((value as Record<symbol, unknown>)[RAW] ?? rawCopy(value)) : value;
/** A store proxy's raw object, or `undefined` for anything else. */
const rawOfProxy = (value: unknown) =>
  value !== null && typeof value === 'object' ? ((value as Record<symbol, unknown>)[RAW] as object | undefined) : undefined;
/** A plain array with this store's proxies one level down replaced by their raw objects (a copy), or `container` itself. */
const rawCopy = (container: object): object => {
  const proto = Object.getPrototypeOf(container);
  if (proto === Array.prototype) {
    const list = container as unknown[];
    for (let i = 0; i < list.length; i++)
      if (rawOfProxy(list[i]) !== undefined) {
        const copy = list.slice();
        for (let j = i; j < copy.length; j++) if (j in copy) copy[j] = rawOfProxy(copy[j]) ?? copy[j];
        return copy;
      }
  }
  return container;
};
/**
 * **What a mutator hands back, and what `sort` hands its comparator: the value a read of the index gives**, through the
 * read's own decision (`nested`), asked of no slot (`NO_SLOT` owns nothing, so nothing is locked): a store for a type a
 * module claims, the value as it is otherwise. It went through `createProxy`, which wraps any object behind its type's
 * handler, so a `Date` (or a `Map` nothing claims) came back as an empty proxy whose methods throw, and sorting a store of
 * `Date`s threw.
 */
const NO_SLOT = {};
const toStore = (value: unknown) => {
  if (value === null || typeof value !== 'object') return value;
  /** The hit, inline (a comparator's two arguments on every call): the cached store, or `null` for "as it is". */
  const known = cached(value);
  return known !== undefined ? (known ?? value) : nested(NO_SLOT, '', value);
};
/**
 * **The indices `[lo, hi)` of an array, sent through one operation**, through whichever is SHORTER: the range, or the keys
 * anyone subscribed to. A list rendered through a raw walk subscribes no index at all (`ITEMS` instead), so a splice on
 * 1000 rows checks a handful of keys, not 1000. For a truncating `length`; `atomic` keeps its own copy (see there).
 */
const span = (keys: Map<unknown, unknown>, send: (key: unknown) => void, lo: number, hi: number) => {
  if (keys.size < hi - lo) {
    for (const key of keys.keys())
      if (typeof key === 'string') {
        const index = +key;
        if (index >= lo && index < hi) send(key);
      }
  } else for (let i = lo; i < hi; i++) send(String(i));
};
const atomic = (obj: unknown[], name: string, method: (...args: unknown[]) => unknown, proxy: unknown) =>
  function (this: unknown, ...args: unknown[]) {
    /** Borrowed onto something else (`state.rows.push.call(other, x)`): that is not this store's write. */
    if (this !== proxy) return method.apply(this, args);
    const before = obj.length;
    const compare = args[0];
    if (name === 'sort' && typeof compare === 'function') args[0] = (a: unknown, b: unknown) => compare(toStore(a), toStore(b));
    /** What the method INSERTS is stored raw, as a `set` stores it (`push(state.rows[0])` hands in a proxy). */
    else for (let i = name === 'splice' ? 2 : 0; i < (name === 'fill' ? 1 : args.length); i++) args[i] = unwrap(args[i]);
    /**
     * **Notified even when the method throws**: a `sort` comparator, or a subclass's override, can throw after the
     * method has rewritten some slots; their readers are told anyway, in `finally`, and the error then propagates.
     */
    let result: unknown;
    try {
      result = method.apply(obj, args);
    } finally {
      const after = obj.length;
      /** ONE operation (`operation`): a hook reached through several keys runs once. */
      const keys = proxyCallbacks.get(obj);
      /**
       * Nobody ever read this array: only the count moves, inline. Reaching the shared sender costs an unread array's
       * `push` a context allocation, so it is reached only when there is someone to wake.
       */
      if (keys === undefined) nextWake();
      else {
        const send = operation(obj, keys);
        /**
         * The indices that can have changed, to the longer end: an append's and a pop's start at the tail; everything
         * else from 0. `splice` could start at its own start, but that costs bytes and saves only a re-run of a hook that
         * reads an index BELOW it (`each` rows read their item, never an index).
         */
        const lo = name === 'push' ? before : name === 'pop' ? after : 0;
        const hi = before > after ? before : after;
        /**
         * The change is the operation's (the shape channel, the array: "the contents changed, re-read"), not `length`:
         * `sort`, `reverse`, `fill` and a same-count `splice` keep it, and `1000 → 1000` would read as nothing happened.
         * The touched indices, through whichever is SHORTER: the range, or the keys anyone subscribed to. WRITTEN HERE, not
         * through `span` (a second address, deliberately): calling the shared walk with this sender cost a splice +66%
         * on JSC and +13% on SpiderMonkey (instructions), the sender no longer inlined; `span` serves the cold truncation.
         */
        if (keys.size < hi - lo) {
          for (const key of keys.keys())
            if (typeof key === 'string') {
              const index = +key;
              if (index >= lo && index < hi) send!(key);
            }
        } else for (let i = lo; i < hi; i++) send!(String(i));
        send!(ITEMS);
        if (after !== before) {
          send!('length');
          send!(GLOBAL);
        }
      }
    }
    if (result === obj) return proxy;
    return name === 'splice' ? (result as unknown[]).map(toStore) : toStore(result);
  };
/**
 * **A write or delete the LANGUAGE refused throws, in BOTH builds** (Brian's ruling, 2026-11-08), explained in development.
 * A proxy reports a refused write by returning `false`: strict code then throws "'set' on proxy: trap returned
 * falsish" (a message about the trap, framework internals the reader never wrote), and sloppy code loses the write
 * silently. `createStore(Object.freeze(x))` is an ordinary thing to write. Every case is one of the language's own
 * invariants (frozen; sealed or non-extensible with a new key; a non-writable property; a getter with no setter): the
 * error is coded in production (`store-refused`) and says which one in development (`refusal`), derived from the target.
 * The check runs only after a write was refused, never on a write that succeeded.
 */
/** Production's builder takes nothing: the target, key and verb only feed development's explanation. */
const refusedWrite: (obj: object, prop: PropertyKey, verb: 'changed' | 'deleted') => TypeError = __DEV__
  ? (obj, prop, verb) => new TypeError(misuse('createStore', 'store-refused', __DEV__ && PROSE['store-refused'](verb === 'deleted' ? 'delete' : 'write', refusal(obj, prop, verb))))
  : () => new TypeError(misuse('createStore', 'store-refused', false));
/**
 * Development: a same-value write onto a key the language would refuse to write (D14b, Brian's ruling 2026-11-11: a
 * documented limit). Production treats that write as no change, as for any key; development reports it once per key per
 * object (the pair key: the object and its property).
 */
const sameOntoLocked = (obj: object, prop: PropertyKey) => {
  if (Reflect.getOwnPropertyDescriptor(obj, prop)?.writable !== false && !Object.isFrozen(obj)) return;
  errorOnce('core', 'a store write', 'same-onto-locked', __DEV__ && (() => PROSE['same-onto-locked'](String(prop))), [obj, prop]);
};
/** Development: what the language refused the write or delete FOR, derived from the target. */
const refusal = (obj: object, prop: PropertyKey, verb: 'changed' | 'deleted') => {
  const key = `\`${String(prop)}\``;
  const ownDescriptor = Reflect.getOwnPropertyDescriptor(obj, prop);
  const state = Object.isFrozen(obj) ? 'frozen' : Object.isSealed(obj) ? 'sealed' : null;
  const why = !ownDescriptor
    ? `the object is ${state ?? 'not extensible'}, so ${key} cannot be added`
    : ownDescriptor.get && !ownDescriptor.set
      ? `${key} has a getter and no setter`
      : state
        ? `the object is ${state}, so ${key} cannot be ${verb}`
        : `${key} is not ${verb === 'deleted' ? 'configurable' : 'writable'}`;
  return why;
};
/**
 * An object-valued read hands back its store: cached per value, decided on the first miss. ONE function for the object
 * handler, the array handler and the raw walk, so the frozen-slot and store-in-a-store rules cannot diverge between them.
 */
export const nested = (obj: object, prop: PropertyKey, value: object) => {
  let proxy = cached(value);
  /** A store in a slot answers itself: remembered in the WeakMap, never by defining through it (a trap). */
  if (proxy === undefined && MARK in value) proxies.set(value, (proxy = value));
  if (proxy === undefined) {
    const ownDescriptor = Reflect.getOwnPropertyDescriptor(obj, prop);
    const locked = ownDescriptor !== undefined && !ownDescriptor.writable && !ownDescriptor.configurable;
    /**
     * **A LOCKED slot (non-writable, non-configurable) must be handed back exactly as it is**, so the object in it is not a
     * store and changes inside it render nothing. Production is unchanged; development says so once per object, naming the
     * key and the cure (Brian's ruling, 2026-11-06: silent non-reactivity is worse than a crash, so it is never silent).
     */
    if (__DEV__ && locked) console.error(diagnostic('core', 'a store read', 'readonly-slot', __DEV__ && PROSE['readonly-slot'](String(prop))));
    if (__DEV__) subclassMutator(value);
    const owned = locked ? undefined : handlerFor(value);
    remember(value, (proxy = owned && claimedHandlers.has(owned) ? wrap(value, owned) : null));
    if (__DEV__ && proxy === null && owned) handedBackUnclaimed(value);
  }
  return proxy ?? value;
};
/**
 * One handler for every store: a read subscribes, and a write that changes something wakes the readers, through every
 * door the language has, not only `=`: `in`, enumeration, `delete` and `Object.defineProperty` each read or change what a
 * template can show.
 */
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
     * **A store written into a store is stored RAW**: what a read hands back is unchanged (one proxy per object, from
     * the cache), and the raw data does not hold it, so a walk over it does not meet one (a read on a proxy is a trap
     * call the engine cannot cache). A plain array of this store's proxies is copied raw one level; a record is stored as
     * given (`unwrap`). A store of another copy of core does not answer `RAW` and is kept as it is.
     */
    if (value !== null && typeof value === 'object') value = unwrap(value);
    const prevValue = Reflect.get(obj, prop, receiver);
    /**
     * **No change: the value the key already gives, unless that value is an `undefined` the object neither owns nor gets
     * from a setter.** Writing `undefined` to an ABSENT key is a real write: the language creates the own key, and `in`,
     * `Object.keys` and `hasOwn` readers see it. Behind a setter it is no change and the setter does not run (the getter
     * already returns the value). **The same nested object, read back and assigned, is no change either**: reads hand out
     * the proxy while the target holds the raw object, so `state.o = state.o` arrives as proxy-against-raw, and
     * `state.items = update(state.items)`, returning its input when there is nothing to do, is how "no change" is normally
     * written. It also stops the proxy being written into the target. `cached` reads a field, so `prevValue` must be an
     * object first (a primitive has no store).
     *
     * **A DEFINED value an object inherits, written as itself, stays no change** (a decision, 2026-11-08), although the
     * language creates an own key there too. Telling it apart takes an own-key check on every same-value write, and that
     * cost the same-value write path 11–12% (instructions, V8 and Node); the inherited value written onto itself reads
     * the same through every door but the own-key ones (`hasOwn`, `Object.keys`, `JSON.stringify`). The `undefined` case
     * pays its check only when the value is `undefined`.
     */
    if (
      (same(prevValue, value) ||
        (value !== null && typeof value === 'object' && prevValue !== null && typeof prevValue === 'object' && cached(prevValue) === value)) &&
      (prevValue !== undefined || Object.hasOwn(obj, prop) || LOOKUP_SETTER.call(obj, prop) !== undefined)
    ) {
      /** A same value onto a key the language would refuse stays no change (D14b, Brian's ruling); development says so. */
      if (__DEV__) sameOntoLocked(obj, prop);
      return true;
    }
    /**
     * A data record needs no descriptor: no setter can run, and "added" is just "not own" (`dataRecord`). NOT inlined: with
     * this its one caller, the minifier pastes `dataRecord` into the write trap as an immediately-invoked arrow.
     */
    const fast = prop !== '__proto__' && /*@__NOINLINE__*/ dataRecord(obj);
    const ownDescriptor = fast ? undefined : Reflect.getOwnPropertyDescriptor(obj, prop);
    const added = fast ? !Object.hasOwn(obj, prop) : ownDescriptor === undefined;
    /**
     * Assigning past the end of an array moves `length` as an internal consequence, never through
     * this trap — so `push` and `unshift` notified nothing that read `length`. Captured before the write. A symbol key
     * (a library's tag on an array) is never an index — and `+symbol` throws.
     */
    const grew = Array.isArray(obj) && typeof prop === 'string' && +prop >= obj.length;
    writingObj = obj;
    writingProp = prop;
    let written;
    try {
      /**
       * **The proxy is the receiver only where a setter could run.** Passing it is what binds a setter's `this` to the
       * proxy (so writes inside one are tracked), and for a plain data property it makes the language re-enter
       * `defineProperty` through this proxy: a second trap call on every write. An own writable DATA property, or a key
       * the object does not have anywhere on its chain, runs no setter, so it is written directly, at about half the
       * cost. An own or inherited accessor keeps the receiver.
       */
      written = (fast || (ownDescriptor ? ownDescriptor.writable === true : !(prop in obj)))
        ? Reflect.set(obj, prop, value)
        : Reflect.set(obj, prop, value, receiver);
    } finally {
      writingObj = null;
    }
    /** A write the language refused throws, in BOTH builds (Brian's ruling): sloppy-mode code would otherwise lose it silently. */
    if (!written) throw refusedWrite(obj, prop, 'changed');
    if (written) {
      /**
       * One write, one wake number across the channels it changes (`trigger`): a hook that read two of them runs once. An
       * own key overwritten changes one channel and keeps the plain call.
       */
      if (added || grew) {
        const epoch = nextWake();
        triggerAt(obj, prop, value, prevValue, epoch);
        if (added) triggerAt(obj, GLOBAL, value, prevValue, epoch);
        if (grew) triggerAt(obj, 'length', (obj as unknown[]).length, +(prop as string), epoch);
      } else trigger(obj, prop, value, prevValue);
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
      const epoch = nextWake();
      if (!previous || !same(descriptor.value, previous.value) || descriptor.get !== previous.get)
        triggerAt(obj, prop, descriptor.value, previous?.value, epoch);
      if (!previous) triggerAt(obj, GLOBAL, descriptor.value, undefined, epoch);
      /** `Object.freeze` through the store locks each slot here, after `preventExtensions`: the last one makes it `FIXED`. */
      if (descriptor.writable === false && !Object.isExtensible(obj) && Object.isFrozen(obj)) FIXED.add(obj);
    }
    return defined;
  },
  /** A new prototype may carry setters: the record is asked again (`dataRecord`). */
  setPrototypeOf(obj, proto) {
    unclassify(obj);
    return Reflect.setPrototypeOf(obj, proto);
  },
  /**
   * Where a target stops being extensible through the store — `Object.preventExtensions`, and
   * `Object.freeze`/`Object.seal`, which call it first. Not `FIXED` here: only a FROZEN object is (its slots all locked),
   * marked by `defineProperty` as `Object.freeze` locks the last slot; a sealed one's children stay stores.
   */
  preventExtensions(obj) {
    /** The cache field leaves first, for the WeakMap: a non-extensible target's keys could no longer hide it. */
    const slot = (obj as Record<symbol, Slot | undefined>)[PROXY];
    if (slot !== undefined && slot._owner === obj && Reflect.deleteProperty(obj, PROXY)) proxies.set(obj, slot._store);
    return Reflect.preventExtensions(obj);
  },
  /** Deleting a key changes both the key's value (to `undefined`, what a read now returns) and the shape. */
  deleteProperty(obj, prop) {
    /**
     * The value being deleted, from the OWN descriptor: deleting never runs a getter in the language, so it never does
     * here (a getter that throws would have made `delete` throw). An accessor's previous value is not known: `undefined`.
     * Only an OWN key is deleted: a key the object merely inherits is untouched by `delete`, so nobody is woken.
     */
    const ownDescriptor = Reflect.getOwnPropertyDescriptor(obj, prop);
    const had = ownDescriptor !== undefined;
    const prevValue = ownDescriptor !== undefined && 'value' in ownDescriptor ? ownDescriptor.value : undefined;
    const deleted = Reflect.deleteProperty(obj, prop);
    if (!deleted && had) throw refusedWrite(obj, prop, 'deleted');
    if (deleted && had) {
      const epoch = nextWake();
      triggerAt(obj, prop, undefined, prevValue, epoch);
      triggerAt(obj, GLOBAL, undefined, prevValue, epoch);
    }
    return deleted;
  },
};
/**
 * **An array's own handler**: the object handler with a read path for arrays alone. A read is `obj[prop]`, no receiver:
 * an array's slots and `length` are data, and `Reflect.get` with a receiver costs a fifth of every read in V8. An
 * accessor DEFINED on a store array runs with the raw array as `this`, untracked: a documented edge. The whole-array
 * methods are recognized here only, so a record's function-valued read never tests for them.
 *
 * Every change to an array's CONTENTS also wakes its `ITEMS` channel: an index written, defined or deleted, `length`
 * moved (a truncating `length = 0` included), a whole-array method. A walk subscribes there ONCE (`walkItems`) instead
 * of once per index. Records never pay for it: only these traps fire it.
 */
export const ITEMS = Symbol();
/** Wakes whoever walks this array (`walkItems` subscribed them to `ITEMS`), with one "contents changed" signal. */
const items = (obj: object) => {
  const cell = proxyCallbacks.get(obj)?.get(ITEMS);
  if (cell !== undefined && cell._positions !== 0) wake(cell, { prop: GLOBAL, value: obj } as Change<unknown>, nextWake());
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
      return typeof value !== 'function'
        ? value
        : MUTATORS.has(prop as string)
          ? atomic(obj as unknown[], prop as string, value as (...args: unknown[]) => unknown, receiver)
          : prop === 'map'
            ? mapped(obj as unknown[], value as (...args: unknown[]) => unknown[], receiver)
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
    if (written) {
      const after = (obj as unknown[]).length;
      /**
       * **A truncating `length = n` deletes the indices past `n` without any index trap firing**: their readers, and
       * whoever read the key set, are told here, as one operation (the indices that were there and are gone).
       */
      if (after < length) {
        const keys = proxyCallbacks.get(obj);
        if (keys !== undefined) {
          const send = operation(obj, keys)!;
          /** NOT inlined: with this its one caller, the minifier pastes `span` here as an immediately-invoked arrow. */
          /*@__NOINLINE__*/ span(keys, send, after, length);
          send(GLOBAL);
        }
      }
      if (!same((obj as Record<PropertyKey, unknown>)[prop], before) || after !== length) items(obj);
    }
    return written;
  },
  defineProperty(obj, prop, descriptor) {
    /**
     * **An accessor defined on a store array through the store runs with the store as `this`** (2026-11-11). The read
     * trap takes a slot off the raw array (`obj[prop]`, its fast path), which would run a getter with the raw array as
     * `this`, untracked; the define is where the store sees it, so the getter is wrapped here, one function per accessor
     * defined and nothing per read. The raw array holds the wrapper (its descriptor's `get` is not the author's), and a
     * second copy of core over the same raw array reads through this copy's store. An accessor on the raw array before
     * it was wrapped is not seen (an Array subclass's getter: a documented limit).
     */
    if (descriptor.get !== undefined) {
      /** In this block, never the trap's scope: a captured binding there would allocate a context on every define. */
      const store = cached(obj);
      const get = descriptor.get;
      /** A copy: the caller's descriptor is never changed. */
      if (store != null) descriptor = { ...descriptor, get: () => get.call(store) };
    }
    const defined = handler.defineProperty!(obj, prop, descriptor);
    /** The `set` trap's own re-entry is reported by `set`. */
    if (defined && !(obj === writingObj && prop === writingProp)) items(obj);
    return defined;
  },
  deleteProperty(obj, prop) {
    /** Only an own key that was there: deleting a missing or inherited one changes nothing anyone walked. */
    const had = Object.hasOwn(obj, prop);
    const deleted = handler.deleteProperty!(obj, prop);
    if (deleted && had) items(obj);
    return deleted;
  },
};
/**
 * **This copy's own handlers, handed to the door** (its first link, before the shared chain): arrays get their own
 * (`arrayHandler`: a leaner read, the whole-array methods, the `ITEMS` channel), records keep the full one, and every other
 * type starts with none. Every `'store'` insert still sees and may wrap either.
 */
useDefaults(((type, chosen) => (type === 'array' ? arrayHandler : type === 'object' ? handler : chosen)) as StoreInsert);
