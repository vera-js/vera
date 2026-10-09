import { misuse } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
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
    /**
     * Production keeps its own short text: the coded form (`createStore: <docs>store-not-object`) measured 1 B LONGER,
     * and a package converts only where its bundle measures smaller (Brian, 2026-10-02).
     */
    throw new TypeError(
      __DEV__
        ? misuse('createStore', 'store-not-object', __DEV__ && PROSE['store-not-object'](String(initialStore)))
        : 'createStore: object required — use ref()'
    );
  return createProxy(initialStore) as Store<T>;
};
