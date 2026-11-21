/** **@vera-components/input's diagnostics: DEVELOPMENT ONLY prose.** */
import type { Prose } from '@verajs/shared-utils';

/**
 * This package's own codes. `defined-twice` is shared-utils' (one text for every component, one code in one
 * namespace), so it is never repeated here: two packages that each listed it would be refused by `sync-diagnostics`.
 * The subject (the tag) is printed by `diagnostic` before each message, so a message never repeats it.
 */
export const PROSE: Record<string, Prose> = {
  'input-no-name': () => [
    'holds an input with no accessible name (no label, aria-label, aria-labelledby or title), so a screen reader announces only its type.',
    'Put it in a <label>, give it a <label for>, or wrap it in <vera-field> with a <label>.',
  ],
  'input-reveal-not-password': (type) => [
    `has reveal on an input of type ${type}, which shows its text already, so reveal does nothing.`,
    'Use reveal only with type="password".',
  ],
  'input-size-on-host': () => [
    'has a size attribute, which <vera-input> does not read (on <input> it means a width in characters).',
    'Use scale="sm|md|lg" for the size, or put size on the <input> itself.',
  ],
  'input-host-changed': (name) => [
    `had ${name} changed after it rendered its default input, which keeps the value it was made with.`,
    'Change the input itself (it is the source of truth once rendered), or write your own <input> inside.',
  ],
};
