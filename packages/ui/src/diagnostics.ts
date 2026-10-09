/** **`@verajs/ui`'s diagnostics — DEVELOPMENT ONLY prose.** Published as `packages/ui/diagnostics.json`. */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'ui-defined-twice': (tag) => [
    `<${tag}> is already defined by another copy or version of @verajs/ui — keeping the first.`,
    'Align the versions, or import @verajs/ui/elements and register under your own names.',
  ],
  'ui-select-duplicate': (value) => [
    `options contain duplicate value ${value} — selection is by value, so these rows will mirror each other.`,
    'Give every option a value of its own.',
  ],
};
