/** **`@vera-hooks/labelled`'s diagnostics — DEVELOPMENT ONLY prose.** Published as `packages/hooks/labelled/diagnostics.json`. */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'labelled-cross-root': (part) => [
    `its ${part} is in a different root from the control, so it was not wired: an id reference cannot cross a shadow boundary.`,
    'Put the part and the control in the same root.',
  ],
  'labelled-unnamed': () => [
    'the control has no accessible name after wiring: no label, no wrapping <label>, and no aria-label, aria-labelledby or title.',
    'Hand labelled a label, or name the control yourself.',
  ],
  'labelled-id-token': (part) => [
    `its ${part}'s id holds whitespace, so it cannot be one token of aria-describedby or aria-labelledby, and was left out.`,
    'Give the part an id without spaces, or none and labelled will give it one.',
  ],
};
