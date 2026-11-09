/** Core's own traps: what a read, a write and a whole-array method do to a record or an array in a store. */
import { proxyCallbacks } from '../store/store.js';
import { misuse } from '@verajs/shared-utils';
import type { StoreInsert } from '@verajs/inserts';
import type { Change, Slot } from '../types.js';
import { PROSE } from '../diagnostics.js';
import { mapped } from './autoMap.js';
import { createProxy } from './createProxy.js';
import { claimed, handlerFor, useDefaults } from './door.js';
import { FIXED, MARK, PROXY, RAW, cached, dataRecord, proxies, remember, unclassify, wrap } from './identity.js';
import { GLOBAL, nextWake, operation, track, trigger, wake } from './track.js';

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
 * **A built-in that writes several slots notifies ONCE, after it finishes.** Called through the proxy, `splice`,
 * `shift`, `sort` … write index by index through the `set` trap, and a hook that runs on each write (a raw hook, a
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
 * **What a store keeps of a value written into it: raw, one level deep.** The ONE place a write (`set`) and a
 * whole-array method's inserted values (`atomic`) are made raw, so raw data never holds a proxy (why: the `set` trap's
 * "stored RAW"). A store proxy → its raw object. A plain array or plain object holding this store's proxies ONE level
 * down → a raw COPY: `state.rows = state.rows.filter(…)` (also `slice`, `[...rows].sort()`) hands back an array of the
 * proxies the reads produced, and stored as it is, every later list walk would meet a proxy in every slot;
 * `state.rows[i] = { ...r, label }` copies a nested `r.user` in as a proxy the same way.
 *
 * - **Copied only when a proxy is found, never rewritten in place:** the user's own array or object is never changed
 *   behind their back. The rule a reader can rely on: an assigned value is stored AS IT IS (aliased) unless it holds
 *   this store's proxies, and then a raw copy is stored.
 *
 * - **One level:** a proxy two levels down (`{ a: { b: proxy } }`) is kept; a deep scan of every written object would
 *   tax every write, and the idioms above are one level.
 *
 * - **Plain containers only** (an `Array` or an object whose prototype is `Object.prototype` or `null`, extensible): a
 *   class instance, a frozen object, a collection is stored as it is. A copy keeps an array's holes; an array's
 *   non-index properties and an object's non-enumerable ones are not copied (a plain container has none in practice).
 *
 * - A proxy of another kind or of another copy of core does not answer `RAW` and stays as it is.
 */
const unwrap = (value: unknown) =>
  value !== null && typeof value === 'object' ? ((value as Record<symbol, unknown>)[RAW] ?? rawCopy(value)) : value;
/** A store proxy's raw object, or `undefined` for anything else. */
const rawOfProxy = (value: unknown) =>
  value !== null && typeof value === 'object' ? ((value as Record<symbol, unknown>)[RAW] as object | undefined) : undefined;
/** `container` with this store's proxies one level down replaced by their raw objects — a copy, or `container` itself. */
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
  } else if ((proto === Object.prototype || proto === null) && Object.isExtensible(container)) {
    const record = container as Record<string, unknown>;
    for (const key in record)
      if (Object.hasOwn(record, key) && rawOfProxy(record[key]) !== undefined) {
        const copy: Record<string, unknown> = proto === null ? Object.assign(Object.create(null), record) : { ...record };
        for (const k in copy) copy[k] = rawOfProxy(copy[k]) ?? copy[k];
        return copy;
      }
  }
  return container;
};
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
       * The touched indices go through whichever is SHORTER: the range, or the keys anyone subscribed to. A list
       * rendered through a raw walk subscribes no index at all (`ITEMS` instead), so its splice checks a handful of
       * keys, not 1000.
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
    if (result === obj) return proxy;
    return name === 'splice' ? (result as unknown[]).map(toStore) : toStore(result);
  };
/**
 * **A write or delete the LANGUAGE refused, explained — development only**.
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
 * An object-valued read hands back its store: cached per value, decided on the first miss. ONE function for the object
 * handler, the array handler and the raw walk, so the frozen-slot and store-in-a-store rules cannot diverge between them.
 */
export const nested = (obj: object, prop: PropertyKey, value: object) => {
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
     * the cache), but the raw data never holds a proxy, so a walk over it never meets one (a read on a proxy is a trap
     * call the engine cannot cache). Raw, one level deep (`unwrap`). A store of another copy of core does not answer
     * `RAW` and is kept as it is.
     */
    if (value !== null && typeof value === 'object') value = unwrap(value);
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
    /** NOT inlined: with this its one caller, the minifier pastes `dataRecord` into the write trap as an immediately-invoked arrow. */
    const fast = prop !== '__proto__' && /*@__NOINLINE__*/ dataRecord(obj);
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
       * **The proxy is the receiver only where a setter could run.** Passing it is what binds a setter's `this` to the
       * proxy (so writes inside one are tracked), and for a plain data property it makes the language re-enter
       * `defineProperty` through this proxy: a second trap call on every write. An own writable DATA property, or a key
       * the object does not have anywhere on its chain, runs no setter, so it is written directly, at about half the
       * cost. An own or inherited accessor keeps the receiver.
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
    /**
     * The value being deleted, from the OWN descriptor: deleting never runs a getter in the language, so it never does
     * here (a getter that throws would have made `delete` throw). An accessor's previous value is not known: `undefined`.
     */
    const own = Reflect.getOwnPropertyDescriptor(obj, prop);
    const prevValue = own !== undefined && 'value' in own ? own.value : undefined;
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
  if (cell !== undefined && cell.n !== 0) wake(cell, { prop: GLOBAL, value: obj } as Change<unknown>, nextWake());
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
 * **This copy's own handlers, handed to the door** (its first link, before the shared chain): arrays get their own
 * (`arrayHandler`: a leaner read, the whole-array methods, the `ITEMS` channel), records keep the full one, and every other
 * type starts with none. Every `'store'` insert still sees and may wrap either.
 */
useDefaults(((type, chosen) => (type === 'array' ? arrayHandler : type === 'object' ? handler : chosen)) as StoreInsert);
