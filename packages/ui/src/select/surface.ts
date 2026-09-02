/**
 * The select's declared surface — every name a consumer can depend on, as data. This object is
 * the source three things are generated from and checked against: `custom-elements.json` (the
 * ecosystem-standard manifest, diffed by the gate so a surface change is a visible review diff and
 * a silent one is a failure), the docs page, and the runtime drift test that renders the component
 * and refuses a part or slot the declaration does not carry.
 *
 * Renaming anything here is a breaking change by definition. That is the point of writing it down.
 */
export const selectSurface = {
  tag: 'vera-select',
  description:
    'A single/multi select. Shadow DOM by default, `light` to opt out; supply your own trigger by slot or use the built-in one; form-associated.',
  attributes: [
    { name: 'multi', description: 'Picking toggles membership and the menu stays open.' },
    { name: 'placeholder', description: 'Shown in the value area while nothing is selected.' },
    { name: 'light', description: 'Render into the light DOM instead of a shadow root. Read at connect.' },
    { name: 'name', description: 'The form field name — submitted via ElementInternals where supported.' },
  ],
  properties: [
    { name: 'options', type: 'SelectOption[]', description: 'The choosable rows. `value` is identity.' },
    { name: 'value', type: 'SelectOption[]', description: 'The selection — always an array, in both modes.' },
  ],
  events: [
    {
      name: 'change',
      detail: '{ value: SelectOption[] }',
      description: 'After every committed change. Bubbles and crosses the shadow boundary.',
    },
  ],
  slots: [
    { name: 'trigger', description: 'Replace the whole control. Wired with role, aria, data-state and handlers.' },
    { name: 'value', description: 'Replace only the value area inside the default trigger; label text is kept in sync.' },
  ],
  parts: [
    { name: 'trigger', description: 'The control button.' },
    { name: 'value', description: 'The value area inside the trigger.' },
    { name: 'menu', description: 'The dropdown container. Carries data-state.' },
    { name: 'search', description: 'The filter input.' },
    { name: 'list', description: 'The listbox.' },
    { name: 'option', description: 'One row. Carries data-active and aria-selected.' },
    { name: 'empty', description: 'The no-matches message.' },
  ],
  states: [
    { on: 'menu', attribute: 'data-state', values: ['open', 'closed'] },
    { on: 'trigger', attribute: 'data-state', values: ['open', 'closed'] },
    { on: 'option', attribute: 'data-active', values: ['(present while the row is the keyboard-active one)'] },
  ],
  tokens: [
    '--vera-surface',
    '--vera-border',
    '--vera-fg',
    '--vera-fg-muted',
    '--vera-accent',
    '--vera-radius',
    '--vera-focus',
  ],
} as const;

export type ComponentSurface = typeof selectSurface;
