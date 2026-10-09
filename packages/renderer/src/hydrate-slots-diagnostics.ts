/** **`@verajs/renderer/hydrate-slots`' diagnostics — DEVELOPMENT ONLY.** Its bundle's own table, merged into the renderer's json. */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'hydrate-slots-unwired': () => [
    'reads the light-DOM statement through `slots`, which is not wired.',
    'Wire `slots` beside it: `wire([renderer, hydration, slots, hydrateSlots])`.',
  ],
};
