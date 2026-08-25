/**
 * The extension points, used the way a third-party module would use them.
 *
 * `proxy-handler` sees every property read, `set-handler` every write (and can suppress the default
 * propagation by returning `false`), and `error` receives anything a hook throws. Registered at
 * priorities that do not collide with core's own — registering at a taken priority *replaces*, which
 * is the trap this file exists to keep visible.
 */
import { wire } from '@verajs/core';

/** Observable counters, so a test can assert the chain actually ran rather than merely registered. */
export const observed = { reads: 0, writes: 0, errors: [], suppressed: 0 };

/** A write of the reserved sentinel is swallowed: `false` stops the default propagation. */
export const SUPPRESS = '__sink_suppress__';

export const installSinkInserts = () => {
  wire([
    {
      on: 'proxy-handler',
      priority: 30,
      fn: () => {
        observed.reads++;
      },
    },
    {
      on: 'set-handler',
      priority: 30,
      fn: (element, property, value) => {
        observed.writes++;
        if (value === SUPPRESS) {
          observed.suppressed++;
          return false;
        }
        return undefined;
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
