/**
 * **The `./element` entry: <vera-kbd> under a tag of your own, with no side effect at import.** `defineAs` registers
 * the element under a tag (a tag in, the registered class out), so the options and the setup stay private and can
 * change freely. Beside it, the two pure functions the element itself renders from: `spellKeys` and `platformOf`, for
 * a caller holding only a string (a `title`, a toast, a command palette's own row) that wants the same spelling.
 */
import { define } from '@verajs/core';
import { options, setup } from './element.js';

export { spellKeys, platformOf } from './kbd/spell.js';
export type { Platform, SpelledKey } from './kbd/spell.js';

/** Registers the element under `tag` and returns the class that serves it. */
export const defineAs = (tag: string) => define({ ...options, tag }, setup);
