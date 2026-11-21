/** **`@vera-hooks/labeled`'s diagnostics — DEVELOPMENT ONLY prose.** Published as `packages/hooks/labeled/diagnostics.json`. */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'labeled-cross-root': (part) => [
    `its ${part} is in a different root from the control, so it was not wired: an id reference cannot cross a shadow boundary.`,
    'Put the part and the control in the same root.',
  ],
  'labeled-unnamed': () => [
    'the control has no accessible name after wiring: no label, no wrapping <label>, and no aria-label, aria-labelledby or title.',
    'Hand labeled a label, or name the control yourself.',
  ],
  'labeled-id-token': (part) => [
    `its ${part}'s id holds whitespace, so it cannot be one token of aria-describedby or aria-labelledby, and was left out.`,
    'Give the part an id without spaces, or none and labeled will give it one.',
  ],
};
