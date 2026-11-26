import type { ComponentSurface } from '@verajs/shared-types';

/**
 * **<vera-switch>'s declared surface: every name a consumer can depend on, as data.** `custom-elements.json` is generated
 * from it (`scripts/generate-cem.mjs`; the gate's `--check` refuses a manifest that disagrees), so a name added to
 * the element is added here in the same change, and renaming one is a breaking change.
 */
export const switchSurface = {
  tag: 'vera-switch',
  description:
    "Serves the author's own <input type=\"checkbox\"> as a switch: the platform's switch attribute where the engine has it, role=\"switch\" where it does not, never both. The input stays the form participant and submits exactly as a checkbox does. Draws a track and a thumb on the input itself, a 24px target at any size; the thumb moves to the inline end when on, mirrors under rtl, and jumps instead of sliding under reduced motion. Its label never changes with its state: wrap it in a <label>, give the input a <label for>, or use <vera-field>.",
  attributes: [
    {
      name: 'data-vera-look',
      description: "\"none\": drops the look, so the engine's own control shows (and the author styles it). Read when the input is served and copied onto it, unless the input has its own; to change it later, set it on the input. Not observed.",
    },
  ],
  properties: [],
  events: [],
  methods: [],
  slots: [],
  parts: [],
  states: [],
  customStates: [],
  tokens: ['--vera-accent', '--vera-accent-fg', '--vera-border-control', '--vera-focus', '--vera-surface'],
} as const satisfies ComponentSurface;
