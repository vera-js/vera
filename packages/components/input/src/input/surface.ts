import type { ComponentSurface } from '@verajs/shared-types';

/**
 * **<vera-input>'s declared surface: every name a consumer can depend on, as data.** `custom-elements.json` is generated
 * from it (`scripts/generate-cem.mjs`; the gate's `--check` refuses a manifest that disagrees), so a name added to
 * the element is added here in the same change, and renaming one is a breaking change.
 */
export const inputSurface = {
  tag: "vera-input",
  description: "A text input in the user's own <input>: optional prefix and suffix, a clear button that keeps undo, a password reveal, a caps-lock hint and a loading mark, all options; the input stays the form participant.",
  attributes: [],
  properties: [],
  events: [],
  methods: [],
  slots: [],
  parts: [{ name: 'root', description: 'The element\'s one rendered part.' }],
  states: [],
  customStates: [],
  tokens: [],
} as const satisfies ComponentSurface;
