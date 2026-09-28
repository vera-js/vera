import { createProxy, createShallow } from '../services/createProxy.js';

/**
 * **The argument is optional, because the documented way to make an element ref has none.**
 * `<input ${myRef}>` assigns the element to `.value`, so the ref is created empty and filled by the
 * render. Two call signatures on a type rather than `function` overloads, because the overload form
 * emits a function declaration where this emits the same arrow. The empty signature comes FIRST so a
 * no-argument call matches it, and the valued one LAST so `ReturnType<typeof ref<T>>` means the common
 * case — a call resolves against the first applicable signature, `ReturnType` against the last.
 */
type Ref = {
  <T = undefined>(): { value: T | undefined };
  <T>(initialValue: T): { value: T };
};

/** A reactive box for one value, read and written as `.value`; an object it holds is reactive too. */
export const ref: Ref = <T,>(initialValue?: T) => createProxy({ value: initialValue }) as { value: T };

/** Same shape as {@link ref}, and empty for the same reason. */
type ShallowRef = {
  <T = undefined>(): { value: T | undefined };
  <T>(initialValue: T): { value: T };
};

/**
 * Like {@link ref}, but what it holds is never proxied: reading `.value` subscribes and replacing it
 * notifies, while the contents come back raw — for large immutable data such as list rows.
 */
export const shallowRef: ShallowRef = <T,>(initialValue?: T) => createShallow({ value: initialValue }) as { value: T };
