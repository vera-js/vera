/** **@vera-components/spinner's diagnostics: DEVELOPMENT ONLY prose.** */
import type { Prose } from '@verajs/shared-utils';

/**
 * This package's own codes. `defined-twice` is shared-utils' (one text for every component, one code in one
 * namespace), so it is never repeated here: two packages that each listed it would be refused by `sync-diagnostics`.
 * The subject (the tag) is printed by `diagnostic` before each message, so a message never repeats it.
 */
export const PROSE: Record<string, Prose> = {
  'spinner-silent': () => [
    'has no label and no aria-busy owner, so a screen reader is told nothing while it spins.',
    'Give it a label, such as label="Loading", or set aria-busy="true" on the element that is loading.',
  ],
};
