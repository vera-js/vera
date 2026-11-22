/** **@vera-components/menu's diagnostics: DEVELOPMENT ONLY prose.** */
import type { Prose } from '@verajs/shared-utils';

/**
 * This package's own codes. `defined-twice` is shared-utils' (one text for every component, one code in one
 * namespace), so it is never repeated here: two packages that each listed it would be refused by `sync-diagnostics`.
 * The subject (the tag) is printed by `diagnostic` before each message, so a message never repeats it. Each is said
 * once per element.
 */
export const PROSE: Record<string, Prose> = {
  'menu-no-list': () => [
    'has no direct child marked slot="menu", so there are no items to wire and nothing opens.',
    'Put the items in one container, such as <div slot="menu">.',
  ],
  'menu-no-trigger': () => [
    'has no direct child marked slot="trigger", so nothing opens the menu.',
    'Add <button slot="trigger">, or set opener="context" and mark the element whose context menu opens it slot="target".',
  ],
  'menu-no-target': () => [
    'has opener="context" but no direct child marked slot="target", so no context menu opens it. The menu never takes the native context menu of an element it was not given.',
    'Mark the element whose context menu opens the menu slot="target".',
  ],
  'menu-no-label': () => [
    'opens as a context menu with no trigger to name it, and its menu has no aria-label or aria-labelledby, so a screen reader announces an unnamed menu.',
    'Give the slot="menu" container an aria-label.',
  ],
  'menu-link-no-href': () => [
    'has an <a> item without href, which is not a link: it takes no focus and no key activates it.',
    'Give the link an href, or write the item as <button>.',
  ],
};
