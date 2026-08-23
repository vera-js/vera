import { createProxy } from '../services/createProxy.js';

/**
 * The cast mirrors `createStore`'s `as Store<T>`, and for the same reason. `createProxy` is typed
 * against `createHandler`'s `ProxyHandler<T | { value: T }>` — the union covers the wrap it performs
 * for a non-proxyable target (a Date, a function), so `new Proxy` infers the union and hands it back
 * as the return type. Here the argument is an object literal, which is always proxyable, so that
 * branch is unreachable and the union is noise. Without the cast a consumer's `count.value` types as
 * `T | { value: T }` and neither `count.value++` nor a plain assignment compiles.
 */
export const ref = <T>(initialValue: T) => {
  return createProxy({ value: initialValue }) as { value: T };
};

export const shallowRef = <T>(initialValue: T) => {
  return createProxy({ value: initialValue, _ignore: true }) as { value: T; _ignore: boolean };
};
