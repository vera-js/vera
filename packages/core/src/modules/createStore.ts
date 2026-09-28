import { createProxy } from '../services/createProxy.js';
import type { Store } from '../types.js';

/**
 * Create a reactive store
 *
 * @param initialStore Defines the store's structure and types; the store proxies this object
 */
export const createStore = <T extends object>(initialStore: T) => createProxy(initialStore) as Store<T>;
