import { createProxy } from '../services/createProxy.js';
import { proxyCallbacks } from '../store/store.js';
import { Store } from '../types.js';

/**
 * **Whether a store needs to be reactive at all.**
 *
 * A server render is one shot: the markup is serialized and the process moves on, so subscriptions
 * created during it are never fired afterwards. Tracking every property read to build them is
 * therefore pure cost — and it is not a small one. Measured on a component rendering twenty rows,
 * the proxy is the *entire* reactivity overhead of a server render: about 40 µs against a 15 µs
 * baseline, where effects and the scheduler cost nothing measurable.
 *
 * With this on, `createStore` hands back the object it was given. Reads are ordinary property
 * access, which is as fast as it goes, and nothing is observed.
 *
 * **A store that is written to while this is on will not re-render anything**, so development wraps
 * it in a set-only proxy that throws rather than letting that pass silently. Production carries
 * neither the wrapper nor the message — the whole guard folds away with `__DEV__`.
 *
 * Only `@verajs/ssr` turns this on, around a render that declared itself static. Leaving it on in a
 * browser would give you a framework that does not update.
 */
let staticStores = false;

/** @param on Whether stores created from now on should be plain objects rather than reactive. */
export const setStaticStores = (on: boolean) => {
  staticStores = on;
};

/**
 * Create a reactive store
 *
 * @param arg defaultStore is used to create structure and types for store
 */
export const createStore = <T extends object>(initialStore: T) => {
  if (!initialStore) throw new Error('createStore: object required');

  /**
   * `_delete` severs every subscription for this store instantly — the old shape nulled two
   * closure locals and freed nothing (subscriptions kept firing). Defined non-enumerably on the
   * raw target, before proxying, so the set trap is never involved and the user's object never
   * shows the key in iteration or serialization. Primitive stores (proxied via a `{ value }`
   * carrier) skip it — GC via the WeakRef machinery is their deletion story.
   */
  /**
   * Guarded on extensibility. A **frozen or sealed** object is an ordinary thing to hand a store —
   * a config, a constant table, a payload frozen by the code that produced it — and defining on one
   * throws `Cannot define property _delete, object is not extensible`: a failure naming a property
   * the author never wrote, for a convenience they never asked for. A frozen store simply has no
   * `_delete`, which costs nothing, because severing subscriptions on an object that cannot change
   * is the one case where it has nothing to do.
   */
  if (typeof initialStore === 'object' && Object.isExtensible(initialStore)) {
    Object.defineProperty(initialStore, '_delete', {
      value: () => proxyCallbacks.delete(initialStore),
      configurable: true,
    });
  }

  if (staticStores) {
    /**
     * **The guard is not `__DEV__`-only, deliberately.** Everything else in this framework that only
     * warns in development does so because production is a browser the author has already tested in.
     * This one is the opposite: a server runs the *production* build, so folding the guard away
     * would remove it from the only place it matters, and a page declared static that writes to a
     * store would render markup reflecting none of those writes — silently, in production, on a
     * server.
     *
     * It is cheap enough to keep. There is no `get` trap, which is where the cost of a reactive
     * store actually is; reads pass straight through.
     */
    return new Proxy(initialStore, {
      set(_target, property) {
        /**
         * **The throw is unconditional; only the explanation folds away.** Carrying the full
         * sentence into production cost 167 gzipped bytes in core — most of the feature's whole
         * budget — for text a server operator reads once. The short form still names the cause, and
         * a development run gives the rest.
         */
        throw new TypeError(
          __DEV__
            ? `createStore: this render declared itself static, so its stores are not reactive and ` +
              `writing \`${String(property)}\` would change nothing. Remove \`static: true\` from ` +
              `renderToString, or stop writing to the store during the render.`
            : 'createStore: static render, store not reactive'
        );
      },
    }) as Store<T>;
  }

  return createProxy(initialStore) as Store<T>;
};
