/** **`@verajs/renderer/slots`' diagnostics — DEVELOPMENT ONLY.** Its bundle's own table, merged into the renderer's json. */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'slot-attributes': (slot, attributes) => [
    `${slot} carries ${attributes}, which does nothing in a light-DOM component: the slot element steps out of the page while it has content.`,
    'Events, `name` and `&ref` all work here.',
  ],
  'slots-wire-too-old': () => [
    'the `wire` that called slots did not hand it `wire` itself, so none of slots was wired: that core is older than this module.',
    'Update `@verajs/core` (and `@verajs/inserts`) to the version that passes `wire` to connectors, beside this renderer.',
  ],
  'expect-slots-option': (value) => [
    `\`expectSlots: ${value}\` is not a boolean, so it reads as off: this component is observed from its first \`<slot>\`.`,
    'Set `expectSlots: true` to observe it from its first render, or leave it out.',
  ],
  /** Two outcomes of one fact — a served page nothing hydrates — so one page, the outcome a parameter. */
  'hydration-unwired': (outcome) => [
    `this page was server-rendered and nothing hydrates it, so ${outcome}.`,
    "Wire `hydration` beside the renderer — `wire([renderer, hydration])` — and, where a light host holds the page's content, `hydrateSlots` with `slots`: `wire([renderer, hydration, slots, hydrateSlots])`.",
  ],
};
