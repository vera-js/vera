import { createProxy } from '../services/createProxy.js';
import type { Store } from '../types.js';

/**
 * Create a reactive store
 *
 * A primitive has nothing to proxy, so it is refused rather than quietly boxed: `ref(value)` is the
 * way to hold one value, and the error names it. Typed callers cannot get here (`T extends object`);
 * this is for JavaScript, which has no compiler to stop it.
 *
 * @param initialStore Defines the store's structure and types; the store proxies this object
 */
export const createStore = <T extends object>(initialStore: T) => {
  if (initialStore === null || (typeof initialStore !== 'object' && typeof initialStore !== 'function'))
    /** The throw is unconditional; only the explanation folds away in production. */
    throw new TypeError(
      __DEV__
        ? `createStore: expected an object and received ${String(initialStore)}. To hold one value, use ref(value).`
        : 'createStore: object required — use ref()'
    );
  return createProxy(initialStore) as Store<T>;
};
