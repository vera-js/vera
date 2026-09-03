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
    'A single/multi select. Options author in plain HTML (<option>/<optgroup>, <vera-option> for rows with markup; `selected` seeds value and reset default; HTML seeds, the property wins) or via the options property. Shadow DOM by default, `light` to opt out; supply your own trigger by slot or use the built-in one; form-associated, searchable, creatable, remote-filterable.',
  attributes: [
    { name: 'multi', description: 'Picking toggles membership and the menu stays open.' },
    { name: 'placeholder', description: 'Shown in the value area while nothing is selected.' },
    { name: 'light', description: 'Render into the light DOM instead of a shadow root. Read at connect.' },
    { name: 'name', description: 'The form field name — submitted via ElementInternals where supported.' },
    {
      name: 'value',
      description:
        'Single-mode initial value, native-input style: read at connect, applies only when neither the property nor selected markup claimed the selection, and doubles as the reset default when the markup declared none. Multi preselects via <option selected>.',
    },
    { name: 'required', description: 'An empty selection reports valueMissing to the owning form. Toggling it re-reflects validity live.' },
    {
      name: 'required-message',
      description: 'The valueMissing message, in the consumer’s words. Default "Please select an option.".',
    },
    {
      name: 'disabled',
      description:
        'Every gesture, key and typeahead no-ops; open() refuses. Fieldset/form disabling arrives through formDisabledCallback and behaves identically.',
    },
    { name: 'searchable', description: 'Show the filter line above the options.' },
    {
      name: 'creatable',
      description: 'A search matching no option offers a create row; implies the search line. See the create event.',
    },
    {
      name: 'remote',
      description:
        'The host owns filtering: options render unfiltered, the search line shows, and edits emit the filter event (debounced 250ms by default).',
    },
    { name: 'loading', description: 'Announce an in-flight remote fetch in the empty area.' },
    { name: 'debounce', description: 'Milliseconds between the last keystroke and the filter event.' },
    { name: 'search-placeholder', description: 'Placeholder and accessible name of the search line. Default "Search…".' },
    { name: 'empty-message', description: 'Shown when no option matches. Default "No options".' },
    { name: 'overflow-message', description: 'A footer line under the list — "1,250 more results", consumer-worded.' },
    { name: 'loading-message', description: 'The in-flight remote message (empty area and status line). Default "Loading…".' },
    { name: 'create-message', description: 'The create row’s text; {label} interpolates. Default "Create “{label}”".' },
    { name: 'remove-message', description: 'The pill remove button’s accessible name; {label} interpolates. Default "Remove {label}".' },
    {
      name: 'results-message',
      description:
        'The screen-reader announcement after filtering; {count} interpolates. Default "{count} options".',
    },
    {
      name: 'aria-label',
      description:
        'The accessible name, reflected onto the trigger (a page label cannot reach through the boundary). A <label for> associated via the form also works, through ElementInternals.',
    },
  ],
  properties: [
    {
      name: 'options',
      type: 'SelectOption[]',
      description:
        'The choosable rows. `value` is identity; `description` renders under the label (and is announced); consecutive `group`s render as one labelled role="group"; `iconBefore`/`iconAfter` take a Vera template or a plain string, rendered aria-hidden — decorative by contract.',
    },
    {
      name: 'value',
      type: 'string | string[]',
      description:
        'Mode-consistent strings: a string in single mode (empty string when none), a string array in multi. The setter also accepts full options and null; single mode holds one, first entry wins — a deliberate divergence from native, whose multiple-selected markup keeps the last. Selection identity is the value string.',
    },
    { name: 'validity', type: 'ValidityState', description: 'Proxied from internals — element.validity, like an input.' },
    { name: 'validationMessage', type: 'string', description: 'The current constraint message.' },
    { name: 'willValidate', type: 'boolean', description: 'Whether the control participates in validation.' },
    {
      name: 'name',
      type: 'string',
      description: 'Native IDL reflection of the `name` attribute — the form-entry key.',
    },
    {
      name: 'disabled',
      type: 'boolean',
      description: 'Native IDL reflection of the `disabled` attribute; setting it toggles the attribute.',
    },
    {
      name: 'required',
      type: 'boolean',
      description: 'Native IDL reflection of the `required` attribute; setting it toggles the attribute.',
    },
    {
      name: 'multi',
      type: 'boolean',
      description: 'Native-style IDL reflection of the `multi` attribute; setting it toggles the attribute.',
    },
    {
      name: 'labels',
      type: 'NodeList | undefined',
      description: 'The <label> elements associated with this control, via ElementInternals — native parity.',
    },
    {
      name: 'form',
      type: 'HTMLFormElement | null',
      description: 'The owning form, via ElementInternals — native parity.',
    },
    {
      name: 'type',
      type: 'string',
      description: "'select-one' or 'select-multiple' — the native <select> vocabulary, for code that feature-detects against real selects.",
    },
    {
      name: 'selectedOptions',
      type: 'SelectOption[]',
      description:
        'The selection as full options — native <select>.selectedOptions. Doubles as the label cache: a remote refilter cannot orphan a chosen label.',
    },
  ],
  events: [
    {
      name: 'input',
      detail: '(none — read the element, like native)',
      description: 'Before change on every committed change; multi fires one per toggle.',
    },
    {
      name: 'beforetoggle',
      detail: 'ToggleEvent { oldState, newState } (CustomEvent detail where ToggleEvent is absent)',
      description: 'Before the menu opens or closes. Cancelable — preventDefault() vetoes the transition.',
    },
    {
      name: 'toggle',
      detail: 'ToggleEvent { oldState, newState }',
      description: 'After the menu settles open or closed.',
    },
    {
      name: 'change',
      detail: '{ value: string | string[], selectedOptions: SelectOption[] }',
      description: 'After every committed change. Bubbles and crosses the shadow boundary.',
    },
    {
      name: 'create',
      detail: '{ label: string, option: SelectOption }',
      description:
        'The create row was activated. Cancelable: preventDefault() to claim creation (async ids, dedup); uncanceled, `option` joins the options and is picked. Mutate `detail.option` to shape it.',
    },
    {
      name: 'filter',
      detail: '{ query: string }',
      description: 'A debounced search edit — the remote seam. Fetch, then set `.options`.',
    },
  ],
  methods: [
    { name: 'open', description: 'Open the menu — same veto-able path as every gesture.' },
    { name: 'close', description: 'Close the menu without refocusing the trigger.' },
    { name: 'focus', description: 'Delegates to the effective trigger (slotted or built-in), both DOM modes — so label clicks and el.focus() land where typing works.' },
    { name: 'checkValidity', description: 'Native-control validity check, proxied from ElementInternals.' },
    { name: 'reportValidity', description: 'Check and surface the browser’s validation UI at the trigger.' },
  ],
  slots: [
    { name: 'trigger', description: 'Replace the whole control. Wired with role, aria, data-state and handlers.' },
    {
      name: 'search',
      description:
        'Replace the filter line with your own input — wired with the same input/keydown handlers and combobox ARIA (aria-activedescendant stays a built-in-input feature).',
    },
    { name: 'empty', description: 'Replace the no-matches message entirely.' },
    {
      name: 'value',
      description:
        'Replace the value area inside the default trigger. You own its children — the component stamps data-label with the joined labels and never rewrites your markup.',
    },
  ],
  parts: [
    { name: 'trigger', description: 'The control button.' },
    { name: 'value', description: 'The value area inside the trigger.' },
    {
      name: 'menu',
      description:
        'The dropdown container. Carries data-state. On engines with CSS anchor positioning it is a top-layer popover anchored to the trigger (never clipped by overflow, flips when near the viewport edge where @position-try exists); elsewhere, and beside a slotted trigger, it is the in-host absolute menu.',
    },
    { name: 'search', description: 'The filter input. Present only when searchable/creatable/remote.' },
    {
      name: 'list',
      description:
        'The listbox. Scroll is contained (::part(list){overscroll-behavior:auto} opts out); aria-busy while loading.',
    },
    { name: 'option', description: 'One row. Carries data-active, data-create on the create row, and aria-selected.' },
    { name: 'pill', description: 'One selected chip in the multi trigger.' },
    { name: 'pill-remove', description: 'The chip’s remove button (Backspace on the trigger removes the last).' },
    { name: 'option-icon', description: 'The aria-hidden icon span before/after the label, when the option carries one.' },
    { name: 'option-label', description: 'The label column inside a row (label, and description when present).' },
    { name: 'option-description', description: 'The dimmer second line under a label.' },
    { name: 'group', description: 'One labelled cluster of consecutive same-group options (role="group").' },
    { name: 'group-label', description: 'The visible group heading (aria-hidden; the group aria-label announces).' },
    { name: 'status', description: 'The visually-hidden role="status" line announcing result counts and loading.' },
    { name: 'empty', description: 'The no-matches message; reads "Loading…" while the loading attribute is set.' },
    { name: 'overflow', description: 'The footer line, shown while overflow-message is set.' },
  ],
  states: [
    { on: 'menu', attribute: 'data-state', values: ['open', 'closed'] },
    { on: 'trigger', attribute: 'data-state', values: ['open', 'closed'] },
    { on: 'option', attribute: 'data-active', values: ['(present while the row is the keyboard-active one)'] },
    { on: 'option', attribute: 'data-create', values: ['(present on the create row)'] },
    { on: 'empty', attribute: 'data-state', values: ['visible', 'hidden'] },
    { on: 'overflow', attribute: 'data-state', values: ['visible', 'hidden'] },
  ],
  customStates: [
    { name: 'open', description: ':state(open) while the menu is open.' },
    { name: 'empty', description: ':state(empty) while nothing is selected.' },
    { name: 'loading', description: ':state(loading) while the loading attribute is set.' },
  ],
  tokens: [
    '--vera-surface',
    '--vera-border',
    '--vera-fg',
    '--vera-fg-muted',
    '--vera-accent',
    '--vera-accent-strong',
    '--vera-radius',
    '--vera-focus',
  ],
} as const;

export type ComponentSurface = typeof selectSurface;
