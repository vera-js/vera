import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { createProxy } from '../services/createProxy.js';
import { createShallow } from '../services/traps.js';
import type { Signal } from '../types.js';

/** `signal`'s and `createStore`'s one option (2026-10-22): whether nested values are tracked. */
export type DeepOption = { deep?: boolean };

/**
 * **`deep` takes effect only as the boolean opposite of the default, in BOTH builds**; anything else (`'yes'`, `1`) is
 * the default, and development names it — one behavior everywhere, the words only in development.
 */
export const checkDeep = (subject: string, options: DeepOption | undefined) => {
  if (__DEV__ && options !== undefined && options.deep !== undefined && typeof options.deep !== 'boolean')
    console.warn(diagnostic('core', subject, 'deep-not-boolean', __DEV__ && PROSE['deep-not-boolean'](String(options.deep))));
};

/**
 * **The argument is optional, because the documented way to make an element ref has none.** `<input ${el}>` assigns
 * the element to `.value`, so the signal is created empty and filled by the render. Two call signatures on a type
 * rather than `function` overloads (the overload form emits a function declaration where this emits the same arrow);
 * the empty one FIRST so a no-argument call matches it, the valued one LAST so `ReturnType` means the common case.
 */
type SignalFactory = {
  <T = undefined>(): Signal<T | undefined>;
  <T>(initialValue: T, options?: DeepOption): Signal<T>;
};

/**
 * **A reactive box for one value, read and written as `.value`** (2026-10-22: what `ref` and `shallowRef` were, renamed — the
 * name the signals world and TC39 use). **Shallow by default**, as every signal is: reading `.value` subscribes and
 * replacing it notifies, while what it holds comes back as it is — mutating `.value.x` notifies nothing. `{ deep: true }`
 * tracks the contents too (what `ref` did): a value you both replace and mutate inside.
 */
export const signal: SignalFactory = <T,>(initialValue?: T, options?: DeepOption) => {
  if (__DEV__) checkDeep('signal', options);
  return (options?.deep === true ? createProxy : createShallow)({ value: initialValue }) as Signal<T>;
};
