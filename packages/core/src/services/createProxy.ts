import { hooksQueue, proxyCallbacks } from '../store/store.js';
import { getType, isWeakCollection } from '@verajs/shared-utils';
import { inserts } from '@verajs/inserts';
import type { StoreInsert, StoreKit } from '@verajs/inserts';
import type { Signal } from '../types.js';

/**
 * Records the running hook, if any, as depending on `obj[prop]`. A weak collection's subscriptions
 * are keyed by its own entry keys, so they are held in a `WeakMap` — a `Map` would keep every tracked
 * key alive as long as the collection, the retention the weak types exist to avoid. Decided once, on
 * the first tracked read of the object.
 */
const track = (obj: object, prop: unknown) => {
  const hook = hooksQueue[hooksQueue.length - 1];
  if (hook === undefined) return;
  let props = proxyCallbacks.get(obj);
  if (props === undefined) {
    props = (isWeakCollection(obj) ? new WeakMap() : new Map()) as Map<unknown, never>;
    proxyCallbacks.set(obj, props);
  }
  let hooks = props.get(prop);
  if (hooks === undefined) props.set(prop, (hooks = new Set()));
  hooks.add(hook);
};

/** Wakes every live hook that read `obj[prop]`, dropping the ones whose element is gone. */
const trigger = (obj: object, prop: unknown, value: unknown, prevValue: unknown) => {
  const hooks = proxyCallbacks.get(obj)?.get(prop);
  if (hooks === undefined) return;
  for (const ref of hooks) {
    const hook = ref.deref();
    if (hook === undefined) hooks.delete(ref);
    else hook({ prop: prop as string, value, prevValue } as Signal<unknown>);
  }
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
 * What core's own handler serves: plain objects (class instances included) and arrays. Everything else
 * — a `Map`, a `Date`, a `URL`, a typed array, a DOM element — has internal slots a proxy in front of it
 * breaks (`this is not a Date object`), so it is handed back as it went in unless a `'store'` insert
 * claims it (`@verajs/store/collections` claims the keyed collections). A value handed back changes by
 * being replaced, which a store does see.
 */
const PLAIN = /^(object|array)$/;

/**
 * **How a value is reactive, decided once — the first time a store meets it.** Core's handler for
 * plain objects and arrays, nothing for the rest, and then every `'store'` insert in priority order,
 * each handed the handler chosen so far: it may return a different one — claiming a type core leaves
 * alone, or composing core's `get`/`set` for batching, transactions, persistence or devtools — or
 * nothing to leave it. Asked on the cache miss only, so an ordinary read or write pays nothing for the
 * seam existing, and a store module never runs on the hot path unless it put itself there.
 *
 * The decision is per value and final: a module wired after a value was first wrapped does not reach
 * it. Store modules are wired at the app entry, before the values they apply to are read.
 */
const handlerFor = (value: object) => {
  let chosen: ProxyHandler<object> | undefined = PLAIN.test(getType(value)) ? handler : undefined;
  inserts.get('store')?.forEach((insert) => {
    chosen = (insert as StoreInsert)(value, chosen, kit) ?? chosen;
  });
  return chosen;
};

/**
 * One handler for every store: a read subscribes, and a write that changes something wakes the
 * readers — through every door the language has, not only `=`: `in`, enumeration, `delete` and
 * `Object.defineProperty` each read or change what a template can show.
 */
const handler: ProxyHandler<object> = {
  get(obj: object, prop, receiver) {
    const value = Reflect.get(obj, prop, receiver);
    track(obj, prop);
    /**
     * **A property the language says must be returned verbatim is.** A non-writable,
     * non-configurable data property may not be answered with a substitute — the engine throws — and
     * every property of a frozen object is one, so reading a nested object out of
     * `createStore(Object.freeze(config))` threw. A non-extensible parent is handed back raw without
     * asking further (no allocation on the read path); an extensible one can still carry an explicitly
     * readonly slot, which is caught on the cache miss and remembered as `null` — "never wrap" — so
     * the descriptor is read once per value, never per read. A value nothing wraps (`handlerFor`)
     * is remembered the same way.
     */
    if (value === null || typeof value !== 'object' || !Object.isExtensible(obj)) return value;
    let proxy = proxies.get(value);
    if (proxy === undefined) {
      const own = Reflect.getOwnPropertyDescriptor(obj, prop);
      const chosen = own && !own.writable && !own.configurable ? undefined : handlerFor(value);
      proxies.set(value, (proxy = chosen ? wrap(value, chosen) : null));
    }
    return proxy ?? value;
  },
  /** `key in state.form` decides what renders, so it subscribes like a read. */
  has(obj, prop) {
    track(obj, prop);
    return Reflect.has(obj, prop);
  },
  ownKeys(obj) {
    track(obj, GLOBAL);
    return Reflect.ownKeys(obj);
  },
  set(obj, prop, value, receiver) {
    const prevValue = Reflect.get(obj, prop, receiver);
    if (prevValue === value) return true;
    /**
     * **The same nested object, read back and assigned, is not a change either.** Reads hand out the
     * proxy while the target holds the raw object, so `state.o = state.o` arrives as proxy-against-raw
     * — and `state.items = update(state.items)`, returning its input when there is nothing to do, is
     * how "no change" is normally written. It also stops the proxy being written into the target.
     */
    if (value !== null && typeof value === 'object' && proxies.get(prevValue as object) === value) return true;
    const added = !Object.prototype.hasOwnProperty.call(obj, prop);
    /**
     * Assigning past the end of an array moves `length` as an internal consequence, never through
     * this trap — so `push` and `unshift` notified nothing that read `length`. Captured before the write.
     */
    const grew = Array.isArray(obj) && +(prop as string) >= obj.length;
    writingObj = obj;
    writingProp = prop;
    let written;
    try {
      written = Reflect.set(obj, prop, value, receiver);
    } finally {
      writingObj = null;
    }
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
    const previous = Reflect.getOwnPropertyDescriptor(obj, prop);
    const defined = Reflect.defineProperty(obj, prop, descriptor);
    if (defined) {
      if (!previous || descriptor.value !== previous.value || descriptor.get !== previous.get)
        trigger(obj, prop, descriptor.value, previous?.value);
      if (!previous) trigger(obj, GLOBAL, descriptor.value, undefined);
    }
    return defined;
  },
  /** Deleting a key changes both the key's value (to `undefined`, what a read now returns) and the shape. */
  deleteProperty(obj, prop) {
    const had = prop in obj;
    const prevValue = had ? Reflect.get(obj, prop) : undefined;
    const deleted = Reflect.deleteProperty(obj, prop);
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
 * One map serves all stores because a value's handler is decided by the value (`handlerFor`), never
 * by which store reached it. **Each proxy also maps to itself**, so a store placed inside another store —
 * `state.child = otherStore` — is recognized and handed back as it is, never wrapped a second time
 * (which tracked every read twice and notified every write twice). That is the whole job the old
 * `_isSignal` marker property did, done by the map that was already being consulted.
 */
const proxies = new WeakMap<object, object | null>();

/** A new proxy over `data`, registered as mapping to itself — see `proxies`. */
const wrap = (data: object, chosen: ProxyHandler<object>) => {
  const proxy = new Proxy(data, chosen);
  proxies.set(proxy, proxy);
  return proxy;
};

/** A reactive view of `data`: reads inside a hook subscribe it, writes re-run it. Nested objects are reactive too. */
export const createProxy = <T extends object>(data: T): T => {
  let proxy = proxies.get(data);
  if (proxy) return proxy as T;
  /**
   * A value nothing wraps is handed back as it is — not reactive, and not pretending to be. `null`
   * cached for a nested value means "hand back verbatim" there; asked for as a store in its own right it
   * is decided afresh, since a frozen *slot* says nothing about the object itself.
   */
  const chosen = handlerFor(data);
  if (!chosen) return data;
  proxy = wrap(data, chosen);
  if (proxies.get(data) === undefined) proxies.set(data, proxy);
  return proxy as T;
};
