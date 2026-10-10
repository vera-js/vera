/** **`@verajs/renderer/elements`'s diagnostics — DEVELOPMENT ONLY.** Its bundle's own table, merged into the renderer's json. */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'claim-threw': (phase, outcome) => [
    `threw in ${phase}; its error is printed beside this line, and ${outcome}.`,
    "Fix the claim's callback, or wire an 'error' insert to handle what claims throw.",
  ],
  'elements-hook-replaced': () => [
    "a 'template' hook set an instance hook before `elements` (priority 10) and is replaced.",
    'Claim elements through the `element` insert instead of a second instance hook.',
  ],
};
