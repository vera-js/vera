import type { StoreInsert, StoreKit } from '@verajs/inserts';

/**
 * `@verajs/store/collections` — reactive `Map` and `Set` inside VeraJS stores.
 *
 * Wire it once, at your app entry, alongside the renderer:
 *
 * ```js
 * import { wire } from '@verajs/core';
 * import { renderer } from '@verajs/renderer';
 * import { collections } from '@verajs/store/collections';
 *
 * wire([renderer, collections]);
 * ```
 *
 * **Take `wire` from `@verajs/core`, never from `@verajs/inserts`.** A production `.min.js`
 * inlines its dependencies, so every bundle carries its own registry; registering through your own
 * copy writes where core never looks — working in development and silently doing nothing in
 * production. Core's own function writes to the map core reads, in every build.
 *
 * It lives outside core because most stores hold plain objects, and before the split every app
 * carried 367 B gzipped for collections it never created. Without it a `Map` or `Set` in a store is
 * handed back as it is — it works as a plain collection and nothing re-renders when it changes.
 *
 * **It imports nothing from core.** `computed` beside it is built *on* core and imports it; this is a
 * `'store'` insert, an extension point core defines, so core hands it its reactivity (the
 * {@link StoreKit}) when it asks. Which way round a module goes is decided by one question: does core
 * call you, or do you call core?
 */

/**
 * One wrapper per collection per method, cached so repeated reads return the SAME function —
 * `map.get === map.get` holds, and the read path (this runs inside the collection handler's `get`)
 * does not allocate a closure per read.
 */
const wrapperCache = new WeakMap<object, Map<PropertyKey, unknown>>();

/**
 * Returns a tracking wrapper for a Map/Set method read through a store proxy.
 *
 * Native collection methods throw (`called on incompatible receiver`) when invoked on the proxy —
 * their internal slots live on the raw target — so this re-bind is what makes collections in
 * stores work at all; the per-method change detection is what makes them reactive.
 *
 * History: this lived in `@verajs/map-support` as a `'proxy-handler'` insert, was integrated into
 * core on 2026-08-20, and moved back out here on 2026-08-24 — as its own `'collection'` insert
 * point rather than a `'proxy-handler'`, which is what makes the move pay. The two objections that
 * retired `map-support` were both about that shape, and both are answered:
 *
 * - *It threw until the insert was registered.* Wiring is now one entry in a list an app already
 *   maintains, and core raises a `__DEV__` error naming this package the moment a Map or Set
 *   reaches a store with nothing registered. It fails loudly, once, with the fix in the message.
 * - *The per-read insert-chain walk.* That cost belonged to `'proxy-handler'`, which ran on every
 *   read of every store. A `'store'` insert is asked once per TYPE, never per read, so a
 *   plain-object read never reaches it. Measured over 24 rotated rounds and 300 000 reads,
 *   a plain read got *faster* (139.3 → 129.9 ns/op) and a `Map.size` read stayed flat.
 *
 * Change detection is per method: `set` fires iff absent-or-different, `add` iff absent, `delete`
 * iff it returned true, `clear` iff non-empty (notifying every previous key). No-op mutations are
 * silent. `get`/`has` subscribe per key; `entries`/`keys`/`values`/`forEach`, `for…of` and spread
 * subscribe to every change. Reactivity is per-entry, not deep: values come back raw.
 */
const methodWrapper = (obj: object, prop: PropertyKey, propValue: unknown, kit: StoreKit) => {
  let wrappers = wrapperCache.get(obj);
  if (wrappers === undefined) wrapperCache.set(obj, (wrappers = new Map()));

  let wrapper = wrappers.get(prop);
  if (wrapper === undefined) {
    const collection = obj as unknown as Map<unknown, unknown> & Set<unknown>;
    const method = propValue as (...args: unknown[]) => unknown;
    const notify = (key: unknown, value: unknown, prevValue: unknown) => kit.trigger(obj, key, value, prevValue);
    const track = (key: unknown) => kit.track(obj, key);
    const GLOBAL = kit.shape;

    /**
     * **A `function`, not an arrow, because the receiver is the return value.**
     *
     * `Map.prototype.set` and `Set.prototype.add` return the collection so they can be chained, and
     * `method.apply(obj, args)` returns the **raw** one. So the second link of
     * `tags.add(1).add(2).add(3)` was called on the unproxied collection and every mutation after
     * the first went unseen: the data was right and nobody was told.
     *
     * A chain whose *first* call happens to change nothing — `add` of a value already present, `set`
     * of the value already there — notified **nobody at all**, and since nothing else was pending,
     * the render never happened. The collection held three items and the page showed one, until
     * something unrelated moved.
     */
    wrapper = function (this: unknown, ...args: unknown[]) {
      const [key, value] = args;
      switch (prop) {
        case 'set': {
          const had = collection.has(key);
          const prevValue = collection.get(key);
          const result = method.apply(obj, args);
          if (!had || prevValue !== value) {
            notify(key, value, prevValue);
            notify(GLOBAL, value, prevValue);
          }
          /** The proxy, so the next link of a chain is tracked too. `this` is absent only when the
           * method was pulled off the store and called bare, where the raw collection is what the
           * caller already had. */
          return this ?? result;
        }
        case 'add': {
          const had = collection.has(key);
          const result = method.apply(obj, args);
          if (!had) {
            notify(key, key, undefined);
            notify(GLOBAL, key, undefined);
          }
          return this ?? result;
        }
        case 'delete': {
          const prevValue = collection.get ? collection.get(key) : key;
          const result = method.apply(obj, args);
          if (result === true) {
            notify(key, undefined, prevValue);
            notify(GLOBAL, undefined, prevValue);
          }
          return result;
        }
        case 'clear': {
          /** Captured first: subscribers of individual keys must hear the clear too. */
          const previous = collection.size > 0 ? [...collection.entries()] : null;
          const result = method.apply(obj, args);
          if (previous) {
            for (const [key, prevValue] of previous) notify(key, undefined, prevValue);
            notify(GLOBAL, undefined, undefined);
          }
          return result;
        }
        case 'get':
        case 'has': {
          track(key);
          return method.apply(obj, args);
        }
        /**
         * Every read that sees the whole collection subscribes to every change — including
         * `Symbol.iterator`, which is **how a collection is actually read**.
         *
         * It is the same function as `entries` on a `Map` and `values` on a `Set`, and leaving it
         * out of this group meant `${[...state.tags]}` and `for (const t of state.tags)` — the two
         * most natural spellings — read the collection once and never heard about a change again.
         * Nothing failed: the first render was right and the list simply stopped moving. The
         * documented workaround was `[...state.tags.values()]`, which nobody arrives at from a
         * component that renders correctly the first time.
         */
        /**
         * `forEach` hands the collection to its callback as a third argument, and that was the raw
         * one — so a callback that wrote through it mutated past the proxy and notified nobody, the
         * same escape as the chained `set` above. The built-in passes the receiver, so this does.
         */
        case 'forEach': {
          track(GLOBAL);
          const self = this ?? obj;
          const [callback, thisArg] = args as [(...a: unknown[]) => void, unknown];
          return method.call(obj, (value: unknown, key: unknown) =>
            callback.call(thisArg, value, key, self)
          );
        }
        case 'entries':
        case 'keys':
        case 'values':
        case Symbol.iterator: {
          track(GLOBAL);
          return method.apply(obj, args);
        }
        default:
          return method.apply(obj, args);
      }
    };
    wrappers.set(prop, wrapper);
  }
  return wrapper;
};

/** One handler per kit (per core), built on first use. */
const handlers = new WeakMap<StoreKit, ProxyHandler<object>>();

/**
 * The handler for a collection in a store. `size` is an accessor on the raw target and subscribes to
 * the shape channel every mutation notifies; a method comes back as its tracking wrapper
 * (`methodWrapper`), since a native one called on a proxy throws `called on incompatible receiver`;
 * anything else is read off the target. Values come back raw — reactivity is per entry, not deep.
 */
const collectionHandler = (kit: StoreKit) => {
  let handler = handlers.get(kit);
  if (handler === undefined)
    handlers.set(
      kit,
      (handler = {
        get(obj, prop) {
          if (prop === 'size') {
            kit.track(obj, kit.shape);
            return (obj as Map<unknown, unknown>).size;
          }
          const value = Reflect.get(obj, prop, obj);
          return typeof value === 'function' ? methodWrapper(obj, prop, value, kit) : value;
        },
      })
    );
  return handler;
};

/**
 * The descriptor to hand `wire`: a `'store'` insert claiming `Map`, `Set`, `WeakMap` and `WeakSet`.
 * Priority 50 is the convention for a default implementation — register below 50 to run first, or at
 * 50 to replace this entirely.
 */
/** The type names (`Object.prototype.toString`, lower-cased) this module claims. */
const KEYED = /^(weak)?(map|set)$/;

export const collections = {
  name: '@verajs/store/collections',
  on: 'store' as const,
  fn: ((type, handler, kit) => (KEYED.test(type) ? collectionHandler(kit) : handler)) as StoreInsert,
  priority: 50,
};
