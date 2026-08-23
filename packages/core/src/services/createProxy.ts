import { ProxyObject, StoreProxyKeys } from '@verajs/shared-types';
import { getType, isSetOrMap, isWeakCollection, prioritySlot } from '@verajs/shared-utils';
import { inserts, ProxyHandlerInsert, SetHandlerInsert } from '@verajs/inserts';
import { hooksQueue, proxyCallbacks } from '../store/store.js';
import { collectionMethod } from './collections.js';
import { Signal } from '../types.js';

/**
 * Priorities parallel to each element's callback array, keeping those arrays dense. `runCallbacks`
 * walks them on every write.
 */
const callbackPriorities = new WeakMap<Set<WeakRef<never>>[], number[]>();

/**
 * Adds a callback to the proxyCallbacks WeakMap for an obj/prop combo using the element, callback,
 * and priority from the current hook in the hooksQueue
 *
 * @param obj Obj to target
 * @param prop Prop to target
 */
const addCallback = <T>(obj: T & StoreProxyKeys, prop: Extract<keyof T, string>) => {
  /** Indexed rather than `.at(-1)`, and no `|| {}` fallback — this runs on every tracked read. */
  const hook = hooksQueue[hooksQueue.length - 1];
  if (!hook) return;

  const { element: elementWeakRef, callback: callbackWeakRef, priority } = hook;
  if (!elementWeakRef || !callbackWeakRef || !priority) return;

  /**
   * Walked by hand with lazy creation, the way Vue's `track()` does.
   *
   * The previous `get(x).get(...).get(...)` chain allocated five wrapper objects (each holding a
   * closure) per call, plus two Maps, an array and a Set passed as **eagerly evaluated** default
   * arguments — so they were constructed and thrown away even when every key already existed.
   * Steady state here is now allocation-free.
   */
  let props = proxyCallbacks.get(obj);
  if (props === undefined) {
    /**
     * A `WeakMap` for a weak collection, a `Map` for everything else — decided once, on the first
     * tracked read, so the hot path never pays for the check.
     *
     * This is what makes `WeakMap` and `WeakSet` supportable at all. Keys here are the collection's
     * own entry keys, so holding them in a `Map` would keep every tracked key alive for as long as
     * the collection is — exactly the retention the weak types exist to avoid. Storing them weakly
     * costs nothing and leaks nothing.
     *
     * The two shapes stay interchangeable because only `get` and `set` are ever called on this
     * container, and a weak collection never reaches the string `'_global'` channel: `set`/`add`/
     * `delete` *notify* it, which is a `get` and misses harmlessly, while only `entries`/`keys`/
     * `values`/`forEach` *track* it — and none of those exist on a weak collection.
     */
    proxyCallbacks.set(
      obj,
      (props = (isWeakCollection(obj) ? new WeakMap() : new Map()) as NonNullable<typeof props>)
    );
  }

  let elements = props.get(prop);
  if (elements === undefined) props.set(prop, (elements = new Map()));

  let byPriority = elements.get(elementWeakRef);
  if (byPriority === undefined) elements.set(elementWeakRef, (byPriority = []));

  let order = callbackPriorities.get(byPriority as never);
  if (order === undefined) callbackPriorities.set(byPriority as never, (order = []));

  prioritySlot(byPriority, order, priority, () => new Set()).add(callbackWeakRef);
};

/**
 * Runs all callbacks for an object/prop combo
 *
 * @param obj Obj to target
 * @param prop Prop to target
 * @param value Value to send as data with the prop to the callback. This can be used in the callback to check
 * what changed
 */
const runCallbacks = <T extends object>(
  obj: T,
  prop: Extract<keyof T, string>,
  value: T[Extract<keyof T, string>],
  prevValue: T[Extract<keyof T, string>]
) => {
  const propCallbacks = proxyCallbacks.get(obj)?.get(prop);
  if (!propCallbacks) return;
  for (const [elementWeakRef, priorityArray] of propCallbacks) {
    const element = elementWeakRef.deref();
    if (element?.isConnected === false) continue;
    if (!element) {
      propCallbacks.delete(elementWeakRef);
      continue;
    }
    priorityArray.forEach((callbacks, index) => {
      for (const callbackWeakRef of callbacks) {
        const callback = callbackWeakRef.deref();
        if (!callback) {
          propCallbacks.get(elementWeakRef)?.[index].delete(callbackWeakRef);
        } else {
          callback({ prop, value, prevValue } as Signal<T[keyof T]>);
        }
      }
    });
  }
};

/**
 * Whether a value should be wrapped in a reactive proxy. Only ever called on a cache miss, so the
 * `getType` string work happens once per object rather than once per read.
 */
const isProxyable = (value: unknown) => {
  const type = getType(value);
  return (
    type === 'object' || type === 'array' || type === 'map' || type === 'set' ||
    type === 'weakmap' || type === 'weakset'
  );
};

/**
 * Create a Proxy handler object
 *
 * @param  data The data object
 * @param  proxyCache Raw object -> its proxy, shared across the whole store. `null` marks a value
 * that was checked and is not proxyable, so the type check is not repeated.
 * @returns The handler object
 */
const createHandler = <T extends object>(
  data: T,
  proxyCache: WeakMap<object, object | null>
): ProxyHandler<T | { value: T }> => {
  return {
    get(obj: T & StoreProxyKeys, prop: Extract<keyof T, string>, receiver) {
      /** The handler will always return true for _isSignal */
      if (prop === '_isSignal') return true;
      /**
       * `size` is an accessor and must be read off the raw target — but the read still
       * subscribes, under the `'_global'` channel that every Map/Set mutation notifies (see
       * `collections.ts`). Returning without tracking meant `${state.map.size}` in a template
       * never updated.
       */
      if (prop === 'size' && isSetOrMap(obj)) {
        addCallback(obj, '_global' as Extract<keyof T, string>);
        return obj[prop];
      }
      let propValue = Reflect.get(obj, prop, receiver) as ProxyObject<T>;

      /** Map/Set methods: re-bound and tracked — see `collections.ts` for the full contract. */
      if (typeof propValue === 'function' && isSetOrMap(obj)) {
        return collectionMethod(obj, prop, propValue, addCallback as never, runCallbacks as never) as ProxyObject<T>;
      }

      /** Ignored properties won't set up proxy listeners any deeper */
      if (!data) return propValue;

      /**
       * Only objects can be proxied or carry the marker props, so primitives skip all of this.
       * The typeof test is a cheap gate in front of the expensive `getType` check below.
       */
      if (propValue !== null && typeof propValue === 'object') {
        /** If the _ignore prop is set, this proxy should not be reactive - we skip setting the handler */
        if ((propValue as StoreProxyKeys)._ignore === true) return propValue;

        /**
         * A container marked `_ignore` is **shallow**, not inert: reads of it are still tracked, but
         * what comes back is the raw value rather than a proxy. This is what `shallowRef` is for and
         * it previously did nothing, because only the returned value was checked and never the owner.
         *
         * The cost of getting this wrong is large. Holding a 1 000-row list in a deep store made a
         * single render pass over it 2.6 ms against 0.041 ms for a plain array — 63x, paid on every
         * render, for objects that never mutate.
         */
        if ((obj as StoreProxyKeys)._ignore === true) {
          addCallback(obj, prop);
          return propValue;
        }

        /**
         * Cached so repeated reads hand back the SAME proxy — as Vue's `reactiveMap` does.
         * Previously every read of a nested object allocated a fresh Proxy *and* a fresh handler
         * holding three closures, and `state.a === state.a` was false, which silently broke any
         * identity comparison in consumer code.
         */
        let cached = proxyCache.get(propValue);
        if (cached === undefined) {
          cached =
            !(propValue as StoreProxyKeys)._isSignal && isProxyable(propValue)
              ? new Proxy(propValue, createHandler(data, proxyCache))
              : null;
          proxyCache.set(propValue, cached);
        }
        if (cached !== null) propValue = cached as ProxyObject<T>;
      }

      inserts.get('proxy-handler')?.forEach((insertCallback) => {
        propValue =
          (insertCallback as ProxyHandlerInsert)?.(obj, prop, propValue, addCallback, runCallbacks) ?? propValue;
      });

      addCallback(obj, prop);

      // if (prop === 'value' && propValue && typeof propValue === 'object' && 'value' in propValue) {
      //   return (propValue as { value: unknown }).value;
      // }

      return propValue;
    },

    set(obj: T, prop: Extract<keyof T, string>, value: T[Extract<keyof T, string>], receiver) {
      const prevValue = Reflect.get(obj, prop, receiver);
      if (prevValue === value) return true;
      /**
       * Appending to an array moves `length` without ever passing through this trap: assigning
       * `list[3]` on a three-element array updates `length` as an internal consequence, so a hook
       * that read `length` was never told. `push` and `unshift` were silently inert while `splice`
       * and `pop` worked, because those assign `length` explicitly.
       *
       * Captured before the write, since the length is what changes.
       */
      const grew = Array.isArray(obj) && +prop >= (obj as unknown[]).length;
      const result = Reflect.set(obj, prop, value, receiver);

      if (result) {
        /**
         * Extension point for anything that wants to take over propagation — batching,
         * transactions, undo/redo, persistence, time-travel devtools. Returning `false` from a
         * handler means it has taken responsibility and the default below is skipped.
         */
        let deferred = false;
        inserts.get('set-handler')?.forEach((insertCallback) => {
          if ((insertCallback as SetHandlerInsert)?.(obj, prop, value, prevValue, runCallbacks) === false) {
            deferred = true;
          }
        });

        if (!deferred) runCallbacks(obj, prop, value, prevValue);
        /** The implicit `length` change an append causes, which nothing else reports. */
        if (grew) {
          const length = (obj as unknown[]).length as T[Extract<keyof T, string>];
          runCallbacks(obj, 'length' as Extract<keyof T, string>, length, +prop as never);
        }
      }

      return result;
    },
    /**
     * Deleting a tracked property notified nothing at all, so a hook reading it kept the value it
     * last saw. `undefined` is the correct new value — it is what a read returns afterwards.
     */
    deleteProperty(obj: T & StoreProxyKeys, prop: Extract<keyof T, string>) {
      const had = prop in obj;
      const prevValue = had ? Reflect.get(obj, prop) : undefined;
      const success = Reflect.deleteProperty(obj, prop);
      if (success && had) {
        runCallbacks(obj, prop, undefined as T[Extract<keyof T, string>], prevValue);
      }
      return success;
    },
  };
};

/**
 * Create a new proxy
 *
 * @param  data - The data object
 * @return The new proxy
 */
export const createProxy = <T extends object>(data: T) => {
  /** Same four-way test as the get trap, so it reuses `isProxyable` rather than repeating it. */
  const proxyData = isProxyable(data) ? data : ({ value: data } as unknown as T);
  /** One cache per store, threaded through every nested handler so identity is stable throughout. */
  return new Proxy(proxyData, createHandler(proxyData, new WeakMap<object, object | null>()));
};
