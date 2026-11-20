/** **`@vera-components/select`'s diagnostics — DEVELOPMENT ONLY prose.** Published as `packages/components/select/diagnostics.json`. */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'defined-twice': (tag) => [
    `<${tag}> is already defined by another copy or version of @vera-components/select — keeping the first.`,
    'Align the versions, or import @vera-components/select/elements and register under your own names.',
  ],
  'select-duplicate': (value) => [
    `options contain duplicate value ${value} — selection is by value, so these rows will mirror each other.`,
    'Give every option a value of its own.',
  ],
};
