/** **@vera-components/kbd's diagnostics: DEVELOPMENT ONLY prose.** */
import type { Prose } from '@verajs/shared-utils';

/**
 * This package's own codes. `defined-twice` is shared-utils' (one text for every component, one code in one
 * namespace), so it is never repeated here: two packages that each listed it would be refused by `sync-diagnostics`.
 * The subject (the tag) is printed by `diagnostic` before each message, so a message never repeats it.
 */
export const PROSE: Record<string, Prose> = {
  'kbd-no-keys': () => ['has no keys, so it shows nothing.', 'Give it keys, such as keys="Mod+K".'],
  'kbd-unknown-platform': (given) => [
    `has platform=${given}, which is not apple, windows or other, so the reader's own platform is used.`,
    'Use one of the three, or remove platform to follow the reader.',
  ],
};
