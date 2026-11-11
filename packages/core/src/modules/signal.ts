import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from '../diagnostics.js';
import { createProxy } from '../services/createProxy.js';
import { same, track, trigger } from '../services/track.js';
import type { DeepOption, Signal } from '../types.js';

/** Where a signal keeps its value: a symbol private to this copy of core, so no key, spread or JSON ever shows it. */
const HELD = Symbol();
type Held = { [HELD]: unknown };

/**
 * **What every signal shares: one accessor pair on one prototype** (CODE-PRINCIPLES §1, per-node hot-path machinery
 * where prototype sharing is a MEASURED win). A signal is made by `Object.create` plus one write, which measured
 * 54–75% fewer cycles to create than the shallow store it replaced, and 42–69% fewer per read and write, on node, d8,
 * SpiderMonkey and JSC; an own accessor pair per signal (no `this`) cost 2–5× the store's creation. The accessors read
 * the instance through `this`, which is that sharing; no class, nothing reaches every signal through it but these.
 * - `value` subscribes on read; a write `!==` the held value notifies (`NaN` over `NaN` does, `-0` over `0` is no write).
 * - `toJSON` is the held value, so `JSON.stringify(signal)` writes what it holds.
 * - Its tag, `[object Signal]`, keeps a store from wrapping one written into it (only records and arrays become stores).
 * - Every member is NON-enumerable, as a class prototype's are: `for…in` on a signal lists nothing, like `Object.keys`.
 */
const SIGNAL = Object.freeze(
  Object.defineProperties(
    {},
    {
      [Symbol.toStringTag]: { value: 'Signal' },
      value: {
        get(this: Held) {
          track(this, 'value');
          return this[HELD];
        },
        set(this: Held, next: unknown) {
          const previous = this[HELD];
          if (same(previous, next)) return;
          this[HELD] = next;
          trigger(this, 'value', next, previous);
        },
      },
      toJSON: {
        value(this: Held) {
          return this[HELD];
        },
      },
    },
  ),
);

/**
 * **`deep` takes effect only as `true`, in BOTH builds**; anything else (`'yes'`, `1`) is the default, and development
 * names it: one behavior everywhere, the words only in development.
 */
const checkDeep = (options: DeepOption | undefined) => {
  if (__DEV__ && options !== undefined && options.deep !== undefined && typeof options.deep !== 'boolean')
    console.warn(diagnostic('core', 'signal', 'deep-not-boolean', __DEV__ && PROSE['deep-not-boolean'](String(options.deep))));
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
 * **A reactive box for one value, read and written as `.value`**, the name the signals world and TC39 use. **Shallow by
 * default**, as every signal is: reading `.value` subscribes and replacing it notifies, while what it holds comes back as
 * it is; mutating `.value.x` notifies nothing. `{ deep: true }` holds the value in a store, so mutating inside it notifies
 * too: a value you both replace and mutate inside.
 */
export const signal: SignalFactory = <T,>(initialValue?: T, options?: DeepOption) => {
  if (__DEV__) checkDeep(options);
  if (options?.deep === true) return createProxy({ value: initialValue }) as Signal<T>;
  const box = Object.create(SIGNAL) as Held;
  box[HELD] = initialValue;
  return box as unknown as Signal<T>;
};
