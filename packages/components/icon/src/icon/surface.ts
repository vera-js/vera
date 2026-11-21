import type { ComponentSurface } from '@verajs/shared-types';

/**
 * **<vera-icon>'s declared surface: every name a consumer can depend on, as data.** `custom-elements.json` is
 * generated from it (`scripts/generate-cem.mjs`; the gate's `--check` refuses a manifest that disagrees), so a name
 * added to the element is added here in the same change, and renaming one is a breaking change. Both attributes are
 * observed (core's `define` turns them into props). The accessible role is written on the host, never on a part, so
 * it is described here rather than listed as a part's state.
 */
export const iconSurface = {
  tag: 'vera-icon',
  description:
    'An icon: the consumer\'s own child <svg>, kept byte-identical, or a src rendered as <svg><use href>. Decorative by default (the host gets aria-hidden="true"); with a label the host gets role="img" and aria-label instead. Only a relative src, or http(s) on the page\'s own origin, is rendered. Size, color and the RTL flip come from the styles layer, by CSS alone.',
  attributes: [
    { name: 'label', description: 'The icon\'s accessible name. Set: the host is role="img" with this aria-label. Absent: the icon is decorative (aria-hidden="true").' },
    {
      name: 'src',
      description:
        'A sprite reference (url#id), rendered as <svg><use href>. Ignored when the icon has a child <svg>. Refused, with a development warning, unless it is relative or http(s) on the page\'s own origin.',
    },
  ],
  properties: [],
  events: [],
  methods: [],
  slots: [],
  parts: [{ name: 'svg', description: 'The <svg> the icon renders for src (aria-hidden, not focusable). A child <svg> the consumer wrote is theirs, not this part.' }],
  states: [],
  customStates: [],
  tokens: [],
} as const satisfies ComponentSurface;
