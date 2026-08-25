import { ProxyObject, StoreProxyKeys } from '@verajs/shared-types';
import { getType, isSetOrMap, isWeakCollection, prioritySlot } from '@verajs/shared-utils';
import { inserts, ProxyHandlerInsert, SetHandlerInsert } from '@verajs/inserts';
import { hooksQueue, proxyCallbacks } from '../store/store.js';
import type { CollectionInsert } from '@verajs/inserts';

/**
 * The channel a container's **shape** is published on, as distinct from any one key: a Map or Set
 * mutation, and a plain object gaining or losing a key. Tracked here from `ownKeys` and from a
 * `size` read; notified by `@verajs/collections`, which declares the same literal rather than
 * importing this one — a production bundle inlines its dependencies, so an import would subscribe
 * to one string and notify another.
 */
const GLOBAL = '_global';

/**
 * Resolved once, on the first `Map`/`Set` method read in the process, and only ever reached behind
 * the `isSetOrMap` gate core already computes — so a plain-object read never touches it. That is
 * what makes reactive collections affordable outside core: the `'proxy-handler'` chain they used
 * to ride ran on every read of every store.
 */
let collectionInsert: CollectionInsert | undefined;
import { Signal } from '../types.js';

/**
 * Depth of writes currently inside the `set` trap, which the `defineProperty` trap reads.
 *
 * `Reflect.set(obj, prop, value, receiver)` does **not** write to `obj` when `receiver` is a
 * different object — and the receiver here is always the proxy. The spec routes the write through
 * `receiver.[[DefineOwnProperty]]`, so every ordinary assignment re-enters the `defineProperty`
 * trap, which would then notify a second time for a write `set` has already reported. Passing the
 * receiver is deliberate and load-bearing: it is what makes a **setter** run with `this` bound to
 * the proxy, so writes inside one are tracked like any other.
 *
 * A counter rather than a flag, because a setter may assign in turn, and `finally` because a
 * throwing setter must not leave writes suppressed for the rest of the page.
 */
let writing = 0;

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
       * `@verajs/collections`). Returning without tracking meant `${state.map.size}` in a template
       * never updated.
       */
      if (prop === 'size' && isSetOrMap(obj)) {
        addCallback(obj, GLOBAL as Extract<keyof T, string>);
        return obj[prop];
      }
      let propValue = Reflect.get(obj, prop, receiver) as ProxyObject<T>;

      /**
       * Map/Set methods: re-bound and tracked by `@verajs/collections`. Native collection methods
       * throw (`called on incompatible receiver`) when invoked on the proxy — their internal slots
       * live on the raw target — so without the package a collection in a store is inert rather
       * than reactive, and the error below says so the first time one is read.
       */
      if (typeof propValue === 'function' && isSetOrMap(obj)) {
        collectionInsert ??= inserts.get('collection')?.[0] as CollectionInsert | undefined;
        if (collectionInsert)
          return collectionInsert(obj, prop, propValue, addCallback as never, runCallbacks as never) as ProxyObject<T>;
        if (__DEV__)
          console.error(
            `[vera] a ${obj instanceof Map ? 'Map' : 'Set'} in a store needs @verajs/collections — ` +
              `\`import { collections } from '@verajs/collections'\` and add it to your \`wire([…])\` ` +
              `call. Without it its methods are not reactive and calling one throws.`
          );
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

    /**
     * `key in state.form` is a read, and a read that decides what renders. Untracked, a template
     * asking whether an optional field is present kept its first answer forever.
     */
    has(obj: T & StoreProxyKeys, prop: Extract<keyof T, string>) {
      addCallback(obj, prop);
      return Reflect.has(obj, prop);
    },
    /**
     * Anything that enumerates — `Object.keys`, `for…in`, `{ ...state.o }`, `JSON.stringify` —
     * depends on the **set of keys**, which no per-key subscription can describe. It subscribes to
     * the same `'_global'` channel a Map or a Set uses, and `set`/`deleteProperty` notify it when
     * the key set actually changes. Vue tracks the `ownKeys` trap under one iteration key for this
     * reason and no other.
     *
     * Without it, a key that did not exist when the component read the object could never be
     * tracked, so adding one notified nobody: `state.byId[newId] = row` and
     * `Object.assign(state.filters, patch)` both rendered once and then went quiet. Deleting a key
     * appeared to work only because the key had been read on the way in.
     */
    ownKeys(obj: T & StoreProxyKeys) {
      addCallback(obj, GLOBAL as Extract<keyof T, string>);
      return Reflect.ownKeys(obj);
    },

    set(obj: T, prop: Extract<keyof T, string>, value: T[Extract<keyof T, string>], receiver) {
      const prevValue = Reflect.get(obj, prop, receiver);
      if (prevValue === value) return true;
      /** Whether this write changes the key set, and so whether enumerators have to hear about it. */
      const added = !Object.prototype.hasOwnProperty.call(obj, prop);
      /**
       * Appending to an array moves `length` without ever passing through this trap: assigning
       * `list[3]` on a three-element array updates `length` as an internal consequence, so a hook
       * that read `length` was never told. `push` and `unshift` were silently inert while `splice`
       * and `pop` worked, because those assign `length` explicitly.
       *
       * Captured before the write, since the length is what changes.
       */
      const grew = Array.isArray(obj) && +prop >= (obj as unknown[]).length;
      writing++;
      let result;
      try {
        result = Reflect.set(obj, prop, value, receiver);
      } finally {
        writing--;
      }

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
        if (added) runCallbacks(obj, GLOBAL as Extract<keyof T, string>, value, prevValue);
        /** The implicit `length` change an append causes, which nothing else reports. */
        if (grew) {
          const length = (obj as unknown[]).length as T[Extract<keyof T, string>];
          runCallbacks(obj, 'length' as Extract<keyof T, string>, length, +prop as never);
        }
      }

      return result;
    },
    /**
     * `Object.defineProperty` is the other way to write a property, and it does not pass through
     * `set` — so a key defined rather than assigned changed nothing that anyone could see. It is
     * how `Object.freeze` writes, how decorators and adapters install accessors, and how any code
     * that wants a non-writable or lazily-computed field on a store puts one there.
     *
     * The new value is read back rather than taken from the descriptor, because an accessor
     * descriptor does not carry one.
     */
    defineProperty(obj: T & StoreProxyKeys, prop: Extract<keyof T, string>, descriptor: PropertyDescriptor) {
      /** An ordinary assignment landing here — see `writing`. The `set` trap reports it. */
      if (writing) return Reflect.defineProperty(obj, prop, descriptor);

      type Value = T[Extract<keyof T, string>];
      /**
       * Descriptors are compared, never read back. `Reflect.get` would **invoke** an accessor, and
       * defining a lazily-computed field is one of the reasons to reach for `defineProperty` at
       * all — evaluating it here would run it at definition time, on the raw object, untracked.
       * An accessor therefore reports `undefined` as its value, the same as a delete does; a
       * subscriber re-reads the property regardless.
       */
      const previous = Reflect.getOwnPropertyDescriptor(obj, prop);
      const success = Reflect.defineProperty(obj, prop, descriptor);
      if (success) {
        const value = descriptor.value as Value;
        const prevValue = previous?.value as Value;
        if (!previous || value !== prevValue || descriptor.get !== previous.get)
          runCallbacks(obj, prop, value, prevValue);
        if (!previous) runCallbacks(obj, GLOBAL as Extract<keyof T, string>, value, prevValue);
      }
      return success;
    },
    /**
     * Deleting a tracked property notified nothing at all, so a hook reading it kept the value it
     * last saw. `undefined` is the correct new value — it is what a read returns afterwards.
     */
    deleteProperty(obj: T & StoreProxyKeys, prop: Extract<keyof T, string>) {
      type Value = T[Extract<keyof T, string>];
      const had = prop in obj;
      const prevValue = (had ? Reflect.get(obj, prop) : undefined) as Value;
      const success = Reflect.deleteProperty(obj, prop);
      if (success && had) {
        runCallbacks(obj, prop, undefined as Value, prevValue);
        runCallbacks(obj, GLOBAL as Extract<keyof T, string>, undefined as Value, prevValue);
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
