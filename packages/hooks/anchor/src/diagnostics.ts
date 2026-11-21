/** **`@vera-hooks/anchor`'s diagnostics — DEVELOPMENT ONLY prose.** Published as `packages/hooks/anchor/diagnostics.json`. */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'anchor-layer-hidden': () => [
    'open() was called while the layer is not shown (not in the document, or display: none), so it has no size to place by.',
    'Show the layer first, then call open().',
  ],
  'anchor-target-removed': () => [
    'the target left the document while the layer was open, so the layer was closed: there is nothing left to place it on.',
    'Close the layer before removing its target, or keep the target in the document while it is open.',
  ],
  'anchor-rotated': () => [
    "the layer's containing block is rotated or skewed, so the layer cannot be placed on its target: a translation and a scale are corrected for, nothing more.",
    'Move the layer out of the rotated ancestor (to the body, or into the top layer as a popover).',
  ],
  'anchor-clipped': (ancestor) => [
    `the layer's containing block is inside ${ancestor}, which clips its overflow, so the layer can be cut off where it overflows it.`,
    'Move the layer out of the clipping ancestor (to the body, or into the top layer as a popover).',
  ],
};
