/** **@vera-components/dialog's diagnostics: DEVELOPMENT ONLY prose.** */
import type { Prose } from '@verajs/shared-utils';

/**
 * This package's own codes. `defined-twice` is shared-utils' (one text for every component, one code in one
 * namespace), so it is never repeated here: two packages that each listed it would be refused by `sync-diagnostics`.
 * The subject (the tag) is printed by `diagnostic` before each message, so a message never repeats it. Each is said
 * once per element.
 */
export const PROSE: Record<string, Prose> = {
  'dialog-no-dialog': () => [
    'has no direct child <dialog>, so there is nothing to open: the element wires the author\'s own <dialog> and renders none.',
    'Put a <dialog> inside it, as its direct child.',
  ],
  'dialog-no-label': () => [
    'has a dialog with no aria-label, no aria-labelledby and no heading, so a screen reader announces an unnamed dialog.',
    'Start the dialog with a heading (it becomes the name), or give the <dialog> an aria-label.',
  ],
  'dialog-alert-no-autofocus': () => [
    'is an alertdialog with no autofocus, so focus lands on its first focusable element, which may be the destructive action.',
    'Put autofocus on the least destructive button, such as Cancel.',
  ],
  'dialog-alert-no-description': () => [
    'is an alertdialog with no description, so a screen reader announces its title but not the message it asks about.',
    'Mark the message data-vera-part="description", or give the <dialog> an aria-describedby.',
  ],
};
