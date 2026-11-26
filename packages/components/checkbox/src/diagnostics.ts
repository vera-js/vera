/** **@vera-components/checkbox's diagnostics: DEVELOPMENT ONLY prose.** */
import type { Prose } from '@verajs/shared-utils';

/**
 * This package's own codes, for both tags (the subject printed before each message names which). `defined-twice` is
 * shared-utils' (one text for every component, one code in one namespace), so it is never repeated here: two packages
 * that each listed it would be refused by `sync-diagnostics`.
 */
export const PROSE: Record<string, Prose> = {
  'checkbox-no-control': () => [
    'holds no <input type="checkbox">, so it has nothing to serve: there is no default render, because a control the script made would be no control before the script runs.',
    'Write the input inside it: <vera-checkbox><label><input type="checkbox" name="…"> Label</label></vera-checkbox>.',
  ],
  'checkbox-no-name': () => [
    'holds an input with no accessible name (its labels, aria-label, aria-labelledby and title give no text), so a screen reader announces only "checkbox".',
    'Put text in its <label>, give it a <label for>, or wrap it in <vera-field> with a <label>.',
  ],
};
