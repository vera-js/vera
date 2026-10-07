/**
 * **Hydration's diagnostics, keyed by code — DEVELOPMENT ONLY.** Referenced only behind `__DEV__` in `hydration.ts`, so
 * production drops this module whole and prints the shared short line instead (`diagnostic`, shared-utils): the
 * subject, and the link to `docs.verajs.dev/e/<code>`. `scripts/sync-diagnostics.mjs` publishes this table as
 * `packages/renderer/diagnostics.json` — the docs pages — and `tests/diagnostics-tables.test.mjs` holds the codes
 * raised and the entries together.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'hydration-fallback': (template) => [
    `fell back to a client render. This container's server markup was discarded and rebuilt (its template begins ` +
      `${template}; its SSR <style> is kept), so the page is correct but the server's work on it was wasted.`,
    `Its children are taken as server output of this template — if they were a client-side placeholder instead, empty ` +
      `the container first (\`container.replaceChildren()\`) or render the placeholder with vera. Otherwise the two ` +
      `renders have to agree exactly: check for markup the template does not describe, or state settled after the ` +
      `server render. Other containers on the page hydrate independently and are unaffected.`,
  ],
  'hydration-protocol': () => [
    `this @verajs/renderer and this hydration are from different releases. Pages render fresh (correct, without ` +
      `adopting the server's markup).`,
    'Update both together.',
  ],
  'hydration-slots': () => [
    'this page was server-rendered with light-DOM slots, which hydration reads through `hydrateSlots`. The server markup is left as served.',
    'Wire it: `wire([renderer, hydration, slots, hydrateSlots])`.',
  ],
  'hydration-no-renderer': () => ['there is no renderer to hydrate.', 'Wire it after the renderer: `wire([renderer, hydration])`.'],
};
