import { createProxy } from '../services/createProxy.js';
import { proxyCallbacks } from '../store/store.js';
import { Store } from '../types.js';

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
  if (typeof initialStore === 'object') {
    Object.defineProperty(initialStore, '_delete', {
      value: () => proxyCallbacks.delete(initialStore),
      configurable: true,
    });
  }

  return createProxy(initialStore) as Store<T>;
};
