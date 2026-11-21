import type { ComponentSurface } from '@verajs/shared-types';

/**
 * **<vera-input>'s declared surface: every name a consumer can depend on, as data.** `custom-elements.json` is generated
 * from it (`scripts/generate-cem.mjs`; the gate's `--check` refuses a manifest that disagrees), so a name added to
 * the element is added here in the same change, and renaming one is a breaking change.
 */
export const inputSurface = {
  tag: 'vera-input',
  description:
    "Wraps the user's own <input> (the form participant: autofill, validity, reset and disabled stay the platform's), with optional prefix and suffix parts of the user's. With no <input> inside it renders one, server-side too, from its name, type, value, placeholder and autocomplete, read once. Options add a clear button that keeps the input's undo history, and a loading mark with aria-busy on the input. It never labels: put it in a <label> or a <vera-field>.",
  attributes: [
    {
      name: 'clearable',
      description:
        'Shows a clear button while the input has a value it may clear (not disabled or read-only, and not while a composite\'s list is open: aria-expanded="true"). The button is out of the tab order; Escape clears a type="search" input, and select-all then Delete clears any. Observed.',
    },
    { name: 'clear-label', description: 'The clear button\'s accessible name. Default "Clear". Observed.' },
    { name: 'loading', description: 'Sets aria-busy="true" on the input and shows the aria-hidden loading mark. Observed.' },
    { name: 'scale', description: 'sm, md or lg: the size, in the styles layer (never size, which <input size> already means).' },
    { name: 'name', description: 'Copied to the default input once, at render; not observed.' },
    { name: 'type', description: 'Copied to the default input once, at render; not observed.' },
    { name: 'value', description: 'Copied to the default input once, at render; not observed.' },
    { name: 'placeholder', description: 'Copied to the default input once, at render; not observed.' },
    { name: 'autocomplete', description: 'Copied to the default input once, at render; not observed.' },
  ],
  properties: [],
  events: [],
  methods: [],
  slots: [],
  parts: [
    { name: 'input', description: 'The default input, rendered only when the user wrote none.' },
    { name: 'prefix', description: "The user's own content before the input." },
    { name: 'suffix', description: "The user's own content after the input." },
    { name: 'clear', description: 'The clear button, with clearable; hidden while there is nothing to clear.' },
    { name: 'loading', description: 'The loading mark, with loading; aria-hidden (aria-busy on the input carries it).' },
  ],
  states: [],
  customStates: [],
  tokens: [],
} as const satisfies ComponentSurface;
