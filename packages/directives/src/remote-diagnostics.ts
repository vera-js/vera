/**
 * **The remote pack's own diagnostics — DEVELOPMENT ONLY** (code-system phase 4b, 2026-10-09). One table per pack
 * entry, as the renderer's entries keep theirs, so `vera-directives-remote`'s development bundle carries its own
 * prose and not the engine's whole table. Its codes join directives' published `diagnostics.json`
 * (`scripts/sync-diagnostics.mjs`) and its manifest (`tests/diagnostics-table.test.mjs`).
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  /** Advisory, not a refusal: the request is fine; what a shared link opens is what breaks. */
  'fetch-feed-depth': (key) => [
    `this accumulating feed's "${key}" is URL-bound through data-vd-query, so a shared link opens with holes — the middle pages were DOM, not URL.`,
    `A feed shares a POSITION: an item fragment (#id), or a server cursor the establishment request can start from. Keep "${key}" out of data-vd-query.`,
  ],
};
