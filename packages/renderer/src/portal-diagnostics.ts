/** **`@verajs/renderer/portal`'s diagnostics — DEVELOPMENT ONLY.** Its bundle's own table, merged into the renderer's json. */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'portal-no-renderer': () => [
    'a portal has no renderer of this release to draw with, so it drew nothing.',
    'Wire the renderer once at your entry — `wire([renderer])` — from the same release as `@verajs/renderer/portal`.',
  ],
};
