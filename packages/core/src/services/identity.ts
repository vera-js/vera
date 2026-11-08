/** One proxy per object: the cache from a raw object to its store, and what is known about that object. */
import type { Slot } from '../types.js';

/**
 * **"Is this one of ours?" — asked of a value through the language, never a table.** Every store proxy
 * answers `MARK in proxy` with `true`: `settle` wraps each owned handler's `has` (a cold trap — the `in`
 * operator only), so the answer holds whatever handler a store module installed, and `shallowHandler`
 * answers it too. It replaced mapping every proxy to itself in `proxies`, which cost ~380 ns of a 514 ns
 * `createStore` — a WeakMap keyed by a PROXY is that expensive to insert into (measured, 74% of it).
 * Any target can answer it, frozen or not: the language checks a `has` trap only when it says `false`.
 */
export const MARK = Symbol();
/**
 * Answered by the object and array handlers (core's own stores): the raw object behind the proxy. Two uses: a walk
 * reads a list's raw array in one trap (`walkItems`), and a store written into a store is stored raw (`set`).
 */
export const RAW = Symbol();
/**
 * Raw object → its proxy, for every store at once. The same object always comes back as the same
 * proxy — `state.a === state.a`, and `createStore(config) === createStore(config)` — where a fresh
 * proxy per read broke every identity comparison in consumer code (a list re-keying, a memo missing).
 * One map serves all stores because a value's handler is decided by its type (`handlerFor`), never
 * by which store reached it. **A store placed inside another store** — `state.child = otherStore` — is
 * recognized (`MARK`, then remembered here as mapping to itself) and handed back as it is, never wrapped
 * a second time, which tracked every read twice and notified every write twice.
 */
export const proxies = new WeakMap<object, object | null>();
/**
 * **The same cache, kept ON the raw object** for the items a walk meets (`promote`), where the language allows (Brian,
 * 2026-10-18): a field under a Symbol
 * private to this copy of core, defined non-enumerable, so `Object.keys`, `for…in`, spreading and `JSON.stringify`
 * never see it (`Object.getOwnPropertySymbols` on the RAW object does; the store's `ownKeys` filters it). A WeakMap
 * lookup was most of a store list's walk in Firefox (measured: swap −30%, remove −25%). The field names its owner, so
 * an object that merely INHERITS from a stored one never answers with the parent's proxy. Where it can't be defined (a
 * frozen, sealed or non-extensible object), the WeakMap above keeps the answer.
 */
export const PROXY = Symbol();
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
export const FIXED = new WeakSet<object>();
/** The store `value` already has: its own field first, else the WeakMap; `null` is "hand back verbatim", `undefined` "not decided". */
export const cached = (value: object): object | null | undefined => {
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
export const dataRecord = (obj: object): boolean => {
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
export const unclassify = (obj: object) => {
  const slot = (obj as Record<symbol, Slot | undefined>)[PROXY];
  if (slot !== undefined && slot.o === obj) slot.d = undefined;
};
export const remember = (value: object, proxy: object | null) => {
  proxies.set(value, proxy);
};
/**
 * **The field is given only where a walk reads it** (2026-10-18): defining it on EVERY object at its first proxying cost
 * store rows without `each` 8% of creating 1 000 (Chrome; with it on the WeakMap only, the baseline figure came back:
 * 3.59 → 3.33 vs 3.32 ms), while only `walkItems` gains from it (Firefox swap −29%, remove −24%). So `remember` keeps
 * the WeakMap, and the walk promotes the items it meets. Never onto a proxy (`MARK`'s self-mapping): defining through one
 * is its own trap. A non-extensible object refuses it and keeps the WeakMap.
 */
export const promote = (value: object, proxy: object | null) => {
  Reflect.defineProperty(value, PROXY, { value: { o: value, p: proxy, d: undefined } satisfies Slot, writable: true, configurable: true });
};

/** A new proxy over `data` — over a non-extensible one, marked `FIXED`. */
export const wrap = (data: object, chosen: ProxyHandler<object>) => {
  const proxy = new Proxy(data, chosen);
  if (!Object.isExtensible(data)) FIXED.add(data);
  return proxy;
};
