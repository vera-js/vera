/** **`@verajs/renderer/keyed`'s diagnostics — DEVELOPMENT ONLY.** Its bundle's own table, merged into the renderer's json. */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'keyed-duplicate-key': (key) => [
    `the key ${key} is used by more than one item in this list. A key identifies one item, so which of them keeps the existing DOM is not defined — the list still renders, but nothing about which node ends up where can be relied on.`,
    'Give every item a key of its own — an id, not an index or a value two items share.',
  ],
  'keyed-not-template': (received) => [
    `expected a template as the second argument and received ${received}.`,
    'It marks a template with a key — `keyed(row.id, html`<li>…</li>`)`.',
  ],
};
