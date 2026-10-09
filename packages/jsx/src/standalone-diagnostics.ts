/**
 * **`@verajs/jsx/standalone`'s diagnostics, keyed by code — DEVELOPMENT ONLY** (referenced behind `__DEV__`, so the
 * production loader drops it). The buildless loader ships to pages, so its production lines follow the byte rule; each
 * line's subject carries what production must still name — the file, its importer, the status, the loop.
 * `scripts/sync-diagnostics.mjs` merges this with the compiler's table into `packages/jsx/diagnostics.json`.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'jsx-helper-missing': () => [
    "this helper of the renderer's was not found — the loader fetches the renderer's helpers from beside @verajs/renderer.",
    "Copy the renderer's whole dist folder, or map the helper in the import map.",
  ],
  'jsx-fetch-failed': () => [
    'this file could not be fetched.',
    'Check its path, and that the page can reach the server it is on.',
  ],
  'jsx-fetch-status': () => [
    'this file answered with an error status.',
    "A self-hosted page needs every file it imports beside it — for @verajs/renderer's helpers, its whole dist folder.",
  ],
  'jsx-circular-import': () => [
    'is a circular import — buildless mode cannot link a cycle (a blob URL exists only once its content does).',
    'Break the cycle, or build with the Vite plugin.',
  ],
  'jsx-block-failed': () => [
    'failed to run; its error follows.',
    "The error names what went wrong — a compile error carries its file, line, column and code.",
  ],
};
