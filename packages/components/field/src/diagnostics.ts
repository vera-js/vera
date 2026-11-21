/** **@vera-components/field's diagnostics: DEVELOPMENT ONLY prose.** */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  /** The subject (the tag) is printed by `diagnostic` before the message, so the message never repeats it. */
  'defined-twice': () => [
    'is already defined by another copy or version of @vera-components/field, so the first is kept.',
    'Align the versions, or import @vera-components/field/element and define it under your own tag.',
  ],
};
