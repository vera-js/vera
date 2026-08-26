import { createProxy } from '../services/createProxy.js';

/**
 * The cast mirrors `createStore`'s `as Store<T>`, and for the same reason. `createProxy` is typed
 * against `createHandler`'s `ProxyHandler<T | { value: T }>` — the union covers the wrap it performs
 * for a non-proxyable target (a Date, a function), so `new Proxy` infers the union and hands it back
 * as the return type. Here the argument is an object literal, which is always proxyable, so that
 * branch is unreachable and the union is noise. Without the cast a consumer's `count.value` types as
 * `T | { value: T }` and neither `count.value++` nor a plain assignment compiles.
 */
/**
 * **The argument is optional, because the documented way to make an element ref has none.**
 *
 * `<input ${myRef}>` assigns the element to `.value`, so the ref is created empty and filled by the
 * render — which is how the renderer's README, `llms.txt` and every example write it. The signature
 * required an initial value, so a TypeScript user following that documentation wrote
 * `ref<HTMLInputElement>()` and could not compile; the workaround is
 * `ref<HTMLInputElement | undefined>(undefined)`, which nobody arrives at from the docs.
 *
 * **Two call signatures on an interface rather than `function` overloads**, because the overload
 * form emits a function declaration where this emits the same arrow it always did — five gzipped
 * bytes, for a change that is entirely about types.
 *
 * The empty signature comes **first** so a no-argument call matches it, and the valued one **last**
 * so `ReturnType<typeof ref<T>>` still means the common case: TypeScript resolves a *call* against
 * the first applicable signature and `ReturnType` against the last one, and `tests/types/public-api.ts`
 * asks the second question.
 */
interface Ref {
  <T = undefined>(): { value: T | undefined };
  <T>(initialValue: T): { value: T };
}

export const ref: Ref = <T,>(initialValue?: T) => createProxy({ value: initialValue }) as { value: T };

/** Same shape as {@link ref}, and empty for the same reason. */
interface ShallowRef {
  <T = undefined>(): { value: T | undefined; _ignore: boolean };
  <T>(initialValue: T): { value: T; _ignore: boolean };
}

export const shallowRef: ShallowRef = <T,>(initialValue?: T) =>
  createProxy({ value: initialValue, _ignore: true }) as { value: T; _ignore: boolean };
