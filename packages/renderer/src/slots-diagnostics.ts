/** **`@verajs/renderer/slots`' diagnostics — DEVELOPMENT ONLY.** Its bundle's own table, merged into the renderer's json. */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'slot-attributes': (slot, attributes) => [
    `${slot} carries ${attributes}, which does nothing in a light-DOM component: the slot element steps out of the page while it has content.`,
    'Events, `name` and `&ref` all work here.',
  ],
  /** Two outcomes of one fact — a served page nothing hydrates — so one page, the outcome a parameter. */
  'hydration-unwired': (outcome) => [
    `this page was server-rendered and nothing hydrates it, so ${outcome}.`,
    "Wire `hydration` beside the renderer — `wire([renderer, hydration])` — and, where a light host holds the page's content, `hydrateSlots` with `slots`: `wire([renderer, hydration, slots, hydrateSlots])`.",
  ],
};
