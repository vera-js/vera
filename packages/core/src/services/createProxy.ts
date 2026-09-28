import { hooksQueue, proxyCallbacks } from '../store/store.js';
import { isWeakCollection } from '@verajs/shared-utils';
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
  let chosen: ProxyHandler<object> | undefined = type === 'object' || type === 'array' ? handler : undefined;
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

/** Writes a decision into a type's owned handler: every trap cleared, then the chosen one's copied in. */
const install = (owned: Record<string, unknown>, chosen: ProxyHandler<object> | undefined) => {
  for (const trap of Object.keys(owned)) owned[trap] = undefined;
  Object.assign(owned, chosen);
  if (chosen) claimed.add(owned);
  else claimed.delete(owned);
};

/**
 * **Decides `tags`, all of them before any is written** — and once a module throws, every type again
 * without it, so each handler reflects exactly the healthy modules. The first failure is thrown after:
 * from the `wire` that brought the module in, or the read that first met a new type — once.
 */
const settle = (tags: string[]) => {
  let threw = false;
  let failure: unknown;
  let decided: (ProxyHandler<object> | undefined)[];
  for (;;) {
    try {
      decided = tags.map(decide);
      break;
    } catch (error) {
      if (!threw) (threw = true), (failure = error);
      tags = [...types.keys()];
    }
  }
  tags.forEach((tag, i) => install(types.get(tag) as Record<string, unknown>, decided[i]));
  if (threw) throw failure;
};

/** The owned handler for `value`'s type, deciding the type the first time one is met. */
const handlerFor = (value: object) => {
  const tag = TAG.call(value);
  let owned = types.get(tag);
  if (owned === undefined) {
    types.set(tag, (owned = {}));
    settle([tag]);
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
 * when a definition leaves it non-extensible (`Object.freeze(store)`: the language prevents extensions
 * first, then redefines every key, each through `defineProperty`). **Freezing the RAW object behind a
 * store, after the store has wrapped it, is not seen** — nothing in the store is told — and a later
 * object-valued read would then be refused by the engine; freeze a value before handing it to a store,
 * or through the store.
 */
const FIXED = new WeakSet<object>();
const handler: ProxyHandler<object> = {
  get(obj: object, prop, receiver) {
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
    if (value === null || typeof value !== 'object' || FIXED.has(obj)) return value;
    let proxy = proxies.get(value);
    if (proxy === undefined) {
      const own = Reflect.getOwnPropertyDescriptor(obj, prop);
      const owned = own && !own.writable && !own.configurable ? undefined : handlerFor(value);
      proxies.set(value, (proxy = owned && claimed.has(owned) ? wrap(value, owned) : null));
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
    if (!Object.isExtensible(obj)) FIXED.add(obj);
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
 * One map serves all stores because a value's handler is decided by its type (`handlerFor`), never
 * by which store reached it. **Each proxy also maps to itself**, so a store placed inside another store —
 * `state.child = otherStore` — is recognized and handed back as it is, never wrapped a second time
 * (which tracked every read twice and notified every write twice). That is the whole job the old
 * `_isSignal` marker property did, done by the map that was already being consulted.
 */
const proxies = new WeakMap<object, object | null>();

/** A new proxy over `data`, registered as mapping to itself — see `proxies`. */
const wrap = (data: object, chosen: ProxyHandler<object>) => {
  if (!Object.isExtensible(data)) FIXED.add(data);
  const proxy = new Proxy(data, chosen);
  proxies.set(proxy, proxy);
  return proxy;
};

/**
 * A SHALLOW view of `data`: reads subscribe and writes notify like any store, but what a read returns
 * is handed back as it is — never wrapped. `shallowRef`'s handler: a large immutable value (a list of
 * rows, a parsed document) behind a deep store costs a proxy and a subscription per nested read, for
 * objects that never mutate; replacing `.value` is the change that matters, and it notifies.
 */
const shallowHandler: ProxyHandler<object> = {
  ...handler,
  get(obj, prop, receiver) {
    track(obj, prop);
    return Reflect.get(obj, prop, receiver);
  },
};
export const createShallow = <T extends object>(data: T): T => wrap(data, shallowHandler) as T;

/** A reactive view of `data`: reads inside a hook subscribe it, writes re-run it. Nested objects are reactive too. */
export const createProxy = <T extends object>(data: T): T => {
  let proxy = proxies.get(data);
  if (proxy) return proxy as T;
  /**
   * Behind its type's handler, claimed or not: a store of a type nothing claims yet is transparent, and
   * becomes reactive the moment a module claiming the type is wired. `null` cached for a nested value
   * means "hand back verbatim" in that slot; asked for as a store in its own right the object is decided
   * afresh, since a frozen *slot* says nothing about the object itself.
   */
  proxy = wrap(data, handlerFor(data));
  if (proxies.get(data) === undefined) proxies.set(data, proxy);
  return proxy as T;
};
