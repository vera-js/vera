/** **@vera-components/field's diagnostics: DEVELOPMENT ONLY prose.** */
import type { Prose } from '@verajs/shared-utils';

/**
 * This package's own codes. `defined-twice` is shared-utils' (one text for every component, one code in one
 * namespace), so it is never repeated here: two packages that each listed it would be refused by `sync-diagnostics`.
 */
export const PROSE: Record<string, Prose> = {
  'field-unknown-when': (when, keys) => [
    `an error part says data-when=${when}, which no ValidityState key matches, so it is never chosen.`,
    `Use one of ${keys}, "server" for an error the server rendered, or no data-when for the catch-all.`,
  ],
};
