/**
 * **`@verajs/inserts`' diagnostics — DEVELOPMENT ONLY** (every `wire` refusal is behind `__DEV__`). Inserts is inlined
 * into core's bundle, so these cost core's development bytes only. Published as `packages/inserts/diagnostics.json`.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'wire-not-module': (received) => [
    `expected a module or an insert descriptor, and received ${received}.`,
    'Check the import name — `wire([renderer, router])`.',
  ],
  'wire-bad-descriptor': (who, wrong) => [`${who} is not an insert descriptor. ${wrong}.`, 'An insert descriptor is `{ on, fn, priority }`.'],
  'wire-function-not-module': (name, meant) => [
    `\`${name}\` is not a module — did you mean \`${meant}\`?`,
    'A bare function is wired as a connector and handed the registry, so this would have registered nothing and thrown nothing.',
  ],
  'wire-priority': (priority) => [`priority must be a finite number, and "${priority}" is not.`, 'Lower runs first; a renderer registers at 50.'],
  'wire-replaced': (insert, priority, replacing) => [
    `two things were wired to '${insert}' at priority ${priority}, so the second replaced the first${replacing}.`,
    'If both are meant to run, give them different priorities; lower runs first.',
  ],
};
