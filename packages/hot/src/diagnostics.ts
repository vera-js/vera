/**
 * **`@verajs/hot`'s diagnostics, keyed by code — DEVELOPMENT ONLY** (referenced behind `__DEV__`; production drops it and
 * prints the shared short line). `scripts/sync-diagnostics.mjs` publishes it as `packages/hot/diagnostics.json`, the docs
 * pages at `https://verajs.dev/e/<code>`.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'hot-no-core': () => [
    "was wired where core's `customElements.define` wrapper is not installed, so a swap would replace core's lifecycle callbacks instead of running inside them.",
    'Import `@verajs/core` before wiring, and wire hot through core\'s `wire`: `wire([renderer, hot])`.',
  ],
  'hot-defined-first': (tag) => [
    `<${tag}> was defined before @verajs/hot was wired, so its registration is the real class and cannot be redefined.`,
    'Wire hot first in the entry, before any component module defines a tag.',
  ],
  'hot-reload': (tag, reason) => [
    `<${tag}> changed in a way a live element cannot take (${reason}), so a reload was requested.`,
    'Cancel the `vera-hot-reload` event on the window to handle it yourself (a preview frame, for instance).',
  ],
};
