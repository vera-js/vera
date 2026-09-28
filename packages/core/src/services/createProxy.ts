import { hooksQueue, proxyCallbacks } from '../store/store.js';
import { getType } from '@verajs/shared-utils';
import type { Signal } from '../types.js';

/** Records the running hook, if any, as depending on `obj[prop]`. */
const track = (obj: object, prop: PropertyKey) => {
  const hook = hooksQueue[hooksQueue.length - 1];
  if (hook === undefined) return;
  let props = proxyCallbacks.get(obj);
  if (props === undefined) proxyCallbacks.set(obj, (props = new Map()));
  let hooks = props.get(prop);
  if (hooks === undefined) props.set(prop, (hooks = new Set()));
  hooks.add(hook);
};

/** Wakes every live hook that read `obj[prop]`, dropping the ones whose element is gone. */
const trigger = (obj: object, prop: PropertyKey, value: unknown, prevValue: unknown) => {
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
 * `@verajs/store/collections` notifies the same literal for a Map or Set; a production bundle inlines
 * its dependencies, so an import would subscribe to one string and notify another.
 */
const GLOBAL = '_global';

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
 * What a store wraps: plain objects (class instances included), arrays and the keyed collections.
 * Everything else with internal slots — a `Date`, `RegExp`, `Promise`, `URL`, typed array, DOM
 * element — is handed back as it went in, because a proxy in front of it breaks its own methods
 * (`this is not a Date object`). Such a value changes by being replaced, which a store does see.
 */
const PROXYABLE = /^(object|array|(weak)?(map|set))$/;

/**
 * One handler for every store: a read subscribes, and a write that changes something wakes the
 * readers — through every door the language has, not only `=`: `in`, enumeration, `delete` and
 * `Object.defineProperty` each read or change what a template can show.
 */
const handler: ProxyHandler<object> = {
  get(obj, prop, receiver) {
    const value = Reflect.get(obj, prop, receiver);
    track(obj, prop);
    /**
     * **A property the language says must be returned verbatim is.** A non-writable,
     * non-configurable data property may not be answered with a substitute — the engine throws — and
     * every property of a frozen object is one, so reading a nested object out of
     * `createStore(Object.freeze(config))` threw. A non-extensible parent is handed back raw without
     * asking further (no allocation on the read path); an extensible one can still carry an explicitly
     * readonly slot, which is caught on the cache miss and remembered as `null` — "never wrap" — so
     * the descriptor is read once per value, never per read. A value that is not `PROXYABLE` is
     * remembered the same way.
     */
    if (value === null || typeof value !== 'object' || !Object.isExtensible(obj)) return value;
    let proxy = proxies.get(value);
    if (proxy === undefined) {
      const own = Reflect.getOwnPropertyDescriptor(obj, prop);
      proxies.set(
        value,
        (proxy =
          (own && !own.writable && !own.configurable) || !PROXYABLE.test(getType(value))
            ? null
            : wrap(value))
      );
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
 * One map serves all stores because there is one handler: nothing about a proxy depends on which
 * store reached it. **Each proxy also maps to itself**, so a store placed inside another store —
 * `state.child = otherStore` — is recognized and handed back as it is, never wrapped a second time
 * (which tracked every read twice and notified every write twice). That is the whole job the old
 * `_isSignal` marker property did, done by the map that was already being consulted.
 */
const proxies = new WeakMap<object, object | null>();

/** A new proxy over `data`, registered as mapping to itself — see `proxies`. */
const wrap = (data: object) => {
  const proxy = new Proxy(data, handler);
  proxies.set(proxy, proxy);
  return proxy;
};

/** A reactive view of `data`: reads inside a hook subscribe it, writes re-run it. Nested objects are reactive too. */
export const createProxy = <T extends object>(data: T): T => {
  let proxy = proxies.get(data);
  /** `null` is a nested value some store must hand back verbatim; asked for as a store itself, it is wrapped fresh. */
  if (proxy === null) return wrap(data) as T;
  if (proxy === undefined) proxies.set(data, (proxy = wrap(data)));
  return proxy as T;
};
