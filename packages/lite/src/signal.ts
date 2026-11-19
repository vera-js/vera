import { warnOnce } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';
import { reading, queue } from './schedule.js';
import type { Signal, LiteElement } from './types.js';

/** Where a signal keeps its value and its readers: symbols private to this copy, so no key, spread or JSON shows them. */
const HELD = Symbol();
const READERS = Symbol();
type Held = { [HELD]: unknown; [READERS]?: Set<LiteElement> };

/**
 * **What every small-tier signal shares: one accessor pair on one frozen prototype — the full tier's (`@verajs/core`'s) shape** (`modules/signal.ts`),
 * so a signal reads, writes, stringifies and enumerates the same in every tier: `Object.keys` and `for…in` list nothing,
 * `JSON.stringify` writes the value, its tag is `[object Signal]`. Reading `.value` during a render subscribes that
 * component (`reading`); a write that differs by `Object.is` queues every subscriber. The component, not a graph, is
 * the unit: no computed, no effect, nothing to unlink but the components, which let go when they are retired.
 */
const SIGNAL = Object.freeze(
  Object.defineProperties(
    {},
    {
      [Symbol.toStringTag]: { value: 'Signal' },
      value: {
        get(this: Held) {
          const element = reading.element;
          if (element !== undefined) {
            const readers = (this[READERS] ??= new Set());
            readers.add(element);
            (element._$l$ ??= new Set()).add(readers);
          }
          return this[HELD];
        },
        set(this: Held, next: unknown) {
          if (Object.is(this[HELD], next)) return;
          this[HELD] = next;
          const readers = this[READERS];
          if (readers !== undefined) for (const element of readers) queue(element);
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

/** The empty call first so a no-argument call matches it, the valued one last so `ReturnType` means the common case (as core). */
type SignalFactory = {
  <T = undefined>(): Signal<T | undefined>;
  <T>(initialValue: T): Signal<T>;
};

/**
 * **A reactive box for one value, read and written as `.value`; shallow, as core's default.** Replacing `.value` re-renders
 * every component that read it; mutating inside it does not. Core's `{ deep: true }` is core's alone.
 */
export const signal: SignalFactory = <T,>(initialValue?: T, options?: unknown) => {
  if (__DEV__ && options !== undefined)
    warnOnce('lite', 'signal', 'tier-needs-core', __DEV__ && (() => PROSE['tier-needs-core']("`signal`'s options (`{ deep: true }`)")));
  const box = Object.create(SIGNAL) as Held;
  box[HELD] = initialValue;
  return box as unknown as Signal<T>;
};
