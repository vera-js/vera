import type { ComponentSurface } from '@verajs/shared-types';

/**
 * **<vera-menu>'s declared surface: every name a consumer can depend on, as data.** `custom-elements.json` is generated
 * from it (`scripts/generate-cem.mjs`; the gate's `--check` refuses a manifest that disagrees), so a name added to
 * the element is added here in the same change, and renaming one is a breaking change.
 */
export const menuSurface = {
  tag: 'vera-menu',
  description:
    "An action menu over the author's own markup: a trigger button and a slot=\"menu\" container of buttons, links, separators and groups, wired in place as a menu button and a popover menu placed by CSS anchor positioning. It opens from the keyboard or the pointer with focus by modality, moves by the arrows and typeahead, handles checkbox and radio items, fires a cancelable menuaction, and in context mode opens at the pointer over its target.",
  attributes: [
    { name: 'opener', description: 'Read at connect; Observed, but a later change is not taken. "context": the slot="target" child\'s context menu opens the menu at the pointer, and no trigger is used.' },
    { name: 'open', description: 'Reflected, never read: present while the menu is open.' },
  ],
  properties: [{ name: 'opener', type: 'string | null', description: 'The opener attribute.' }],
  events: [
    {
      name: 'menuaction',
      detail: "{ item: Element, value: string, checked: boolean | null, reason: 'pointer' | 'keyboard' }",
      description: "Bubbling and cancelable, fired after the item's own click. value is the item's value attribute, else its text; checked is a checkbox or radio item's state after the choice. Canceling keeps the menu open; it cannot undo the click.",
    },
  ],
  methods: [],
  slots: [
    { name: 'trigger', description: 'A direct child <button> that opens the menu (popovertarget). Not used with opener="context".' },
    { name: 'menu', description: 'A direct child container of the items: <button>, <a href>, <hr>, and groups (role="group" or <fieldset>).' },
    { name: 'target', description: 'With opener="context": the direct child whose context menu opens the menu.' },
  ],
  parts: [
    { name: 'menu', description: 'The slot="menu" container: role="menu", a popover, anchored to the trigger.' },
    { name: 'point', description: 'With opener="context": the one 0×0 node the menu is anchored to, moved to the pointer at each open.' },
  ],
  states: [],
  customStates: [],
  tokens: ['--vera-border', '--vera-radius', '--vera-bg', '--vera-fg', '--vera-fg-muted', '--vera-hover'],
} as const satisfies ComponentSurface;
