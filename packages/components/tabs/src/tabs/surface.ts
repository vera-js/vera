import type { ComponentSurface } from '@verajs/shared-types';

/**
 * **<vera-tabs>'s declared surface: every name a consumer can depend on, as data.** `custom-elements.json` is generated
 * from it (`scripts/generate-cem.mjs`; the gate's `--check` refuses a manifest that disagrees), so a name added to
 * the element is added here in the same change, and renaming one is a breaking change.
 */
export const tabsSurface = {
  tag: 'vera-tabs',
  description:
    "Tabs over the author's own buttons and panels: a direct child marked slot=\"tabs\" holds the buttons, the host's other children are the panels. Before the script runs they are buttons and sections; after it, the roles, ids and aria wiring are set, the arrow keys move one tab stop, one panel shows, and an indicator under the selected tab follows it by CSS anchor positioning. A user's selection fires a cancelable beforetabchange, then tabchange.",
  attributes: [
    {
      name: 'value',
      description: "The selected tab's key (its value attribute, else its position). Reflects the selection; writing it selects that tab and fires nothing. Observed.",
    },
    {
      name: 'activation',
      description: '"manual": the arrow keys move focus only, and Enter or Space selects. Otherwise an arrow key selects the tab it reaches. Observed, and read at each key.',
    },
    { name: 'orientation', description: '"vertical": the tablist is a column and Up and Down move. Default horizontal. Observed.' },
    {
      name: 'findable',
      description:
        '"false": inactive panels are plain hidden. Otherwise they are hidden="until-found" where the engine has it, so find-in-page reaches them and selects their tab. Observed.',
    },
  ],
  properties: [
    { name: 'value', type: 'string | null', description: 'The value attribute.' },
    { name: 'activation', type: 'string | null', description: 'The activation attribute.' },
    { name: 'orientation', type: 'string | null', description: 'The orientation attribute.' },
    { name: 'findable', type: 'string | null', description: 'The findable attribute.' },
  ],
  events: [
    {
      name: 'beforetabchange',
      detail: "{ value: string, previous: string | null, reason: 'pointer' | 'keyboard' | 'find' }",
      description: 'Before a user selection, on the host, bubbling. Cancelable, except when find-in-page already revealed the panel.',
    },
    {
      name: 'tabchange',
      detail: "{ value: string, previous: string | null, reason: 'pointer' | 'keyboard' | 'find' | 'disabled' }",
      description: "After a user's selection, or after the selected tab was disabled and the next one took over; on the host, bubbling. A write to value fires nothing.",
    },
  ],
  methods: [],
  slots: [
    {
      name: 'tabs',
      description: "A direct child marked slot=\"tabs\" is the tablist, holding the author's <button>s. Nothing is distributed: it stays where it was written.",
    },
  ],
  parts: [
    {
      name: 'tablist',
      description: "The author's slot=\"tabs\" container, marked data-vera-part=\"tablist\": its ::after is the indicator under the selected tab.",
    },
  ],
  states: [],
  customStates: [],
  tokens: ['--vera-border', '--vera-fg', '--vera-fg-muted', '--vera-accent', '--vera-radius'],
} as const satisfies ComponentSurface;
