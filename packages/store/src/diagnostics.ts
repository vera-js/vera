/** **`@verajs/store`'s diagnostics — DEVELOPMENT ONLY.** Published as `packages/store/diagnostics.json`. */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'computed-not-function': (received) => [
    `expected a function to derive the value from, and received ${received}.`,
    'Pass the expression as a function — computed(() => a + b), not computed(a + b).',
  ],
};
