import type { ComponentSurface } from '@verajs/shared-types';

/**
 * **<vera-spinner>'s declared surface: every name a consumer can depend on, as data.** `custom-elements.json` is generated
 * from it (`scripts/generate-cem.mjs`; the gate's `--check` refuses a manifest that disagrees), so a name added to
 * the element is added here in the same change, and renaming one is a breaking change. All three attributes are
 * observed (core's `define` turns them into props).
 */
export const spinnerSurface = {
  tag: 'vera-spinner',
  description:
    "Shows that something is busy: an animated arc, decorative to assistive technology, whose label is announced once through the document's one polite live region when the wait lasts past a short settle window, so a fast load says nothing.",
  attributes: [
    {
      name: 'label',
      description:
        'What is busy, said once by a screen reader when the wait outlasts the settle window (about 150 ms). Spinners with the same label are one load: said once however many there are, or however often a framework replaces them. Nothing is said inside an aria-busy="true" owner, which speaks for itself.',
    },
    { name: 'done-label', description: 'Said once when the load ends (a settle window after the last spinner with its label leaves), and only if its label was said.' },
    { name: 'show-label', description: 'Present: the label is also shown, as plain text after the arc.' },
  ],
  properties: [],
  events: [],
  methods: [],
  slots: [],
  parts: [
    { name: 'arc', description: 'The turning arc (aria-hidden). Under reduced motion it pulses instead.' },
    { name: 'label', description: 'The shown label, rendered only with show-label and a label.' },
  ],
  states: [],
  customStates: [],
  tokens: ['--vera-spinner-size', '--vera-spinner-width', '--vera-spinner-color', '--vera-spinner-track'],
} as const satisfies ComponentSurface;
