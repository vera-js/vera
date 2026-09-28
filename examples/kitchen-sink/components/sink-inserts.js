/**
 * The extension points, used the way a third-party module would use them.
 *
 * A `'store'` insert wraps core's handler for the values a store meets — here counting every read and
 * every write, and taking one write off the notification path (written to the raw target, so nobody
 * hears it) — and `error` receives anything a hook throws. Registered at priorities that do not
 * collide with other modules' — registering at a taken priority *replaces*, which is the trap this
 * file exists to keep visible.
 */
import { wire } from '@verajs/core';

/** Observable counters, so a test can assert the chain actually ran rather than merely registered. */
export const observed = { reads: 0, writes: 0, errors: [], suppressed: 0 };

/** A write of the reserved sentinel is written to the raw target, which notifies nobody. */
export const SUPPRESS = '__sink_suppress__';

export const installSinkInserts = () => {
  wire([
    {
      on: 'store',
      priority: 30,
      fn: (type, handler) =>
        handler?.set && {
          ...handler,
          get(obj, prop, receiver) {
            observed.reads++;
            return handler.get(obj, prop, receiver);
          },
          set(obj, prop, next, receiver) {
            observed.writes++;
            if (next !== SUPPRESS) return handler.set(obj, prop, next, receiver);
            observed.suppressed++;
            return Reflect.set(obj, prop, next);
          },
        },
    },
    {
      on: 'error',
      priority: 30,
      fn: (error) => {
        observed.errors.push(String(error?.message ?? error));
      },
    },
  ]);
};
