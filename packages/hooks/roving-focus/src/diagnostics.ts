/** **`@vera-hooks/roving-focus`'s diagnostics — DEVELOPMENT ONLY prose.** Published as `packages/hooks/roving-focus/diagnostics.json`. */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'roving-focus-none': () => [
    'has no reachable item: every item is skipped (disabled by default), so the group has no tab stop and the keyboard cannot reach it.',
    'Leave at least one item enabled, or pass a skip that keeps one.',
  ],
  'roving-focus-foreign': () => [
    'was handed to focus(), but it is skipped or not one of the group\'s items, so nothing moved.',
    'Pass an item that items() returns and skip() keeps.',
  ],
};
