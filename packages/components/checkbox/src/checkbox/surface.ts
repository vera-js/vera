import type { ComponentSurface } from '@verajs/shared-types';

/**
 * **<vera-checkbox>'s declared surface: every name a consumer can depend on, as data.** `custom-elements.json` is generated
 * from it (`scripts/generate-cem.mjs`; the gate's `--check` refuses a manifest that disagrees), so a name added to
 * the element is added here in the same change, and renaming one is a breaking change.
 */
export const checkboxSurface = {
  tag: 'vera-checkbox',
  description:
    "Serves the author's own <input type=\"checkbox\">, which stays the form participant (submit, reset, disabled, autofill and back/forward restore are the platform's) and works before the script runs; there is no default render. Draws the box on the input itself, a 24px target at any size, with a check and a dash in the platform's own states. Adds a mixed state, kept in step with the input's indeterminate property. It never labels: wrap it in a <label>, give the input a <label for>, or use <vera-field>.",
  attributes: [
    {
      name: 'data-vera-look',
      description: "\"none\": drops the look, so the engine's own control shows (and the author styles it). Read when the input is served and copied onto it, unless the input has its own; to change it later, set it on the input. Not observed.",
    },
    {
      name: 'indeterminate',
      description:
        "Mixed: sets the input's indeterminate property, which has no attribute of its own. A click on a mixed box is the platform's (it clears mixed and flips checked) and the attribute goes with it; a click a listener cancels keeps both. Observed.",
    },
  ],
  properties: [],
  events: [],
  methods: [],
  slots: [],
  parts: [],
  states: [],
  customStates: [],
  tokens: ['--vera-accent', '--vera-accent-fg', '--vera-border-control', '--vera-focus', '--vera-hover', '--vera-surface'],
} as const satisfies ComponentSurface;
