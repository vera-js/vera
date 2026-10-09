/**
 * **Core's diagnostics, keyed by code — DEVELOPMENT ONLY.** Referenced only behind `__DEV__`, so production drops this
 * module whole and prints the shared short line (`diagnostic`, shared-utils): the subject and the link to
 * `docs.verajs.dev/e/<code>`. `scripts/sync-diagnostics.mjs` publishes this table as `packages/core/diagnostics.json`
 * — the docs pages — and `tests/diagnostics-tables.test.mjs` holds the codes raised and the entries together.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'no-owner': () => [
    `there is no component being set up. Hooks, \`render()\` and \`mount()\` belong to a component's setup, which runs ` +
      `synchronously from \`init(this)\` and ends at the first \`await\` — so after an \`await\` in setup, or later in ` +
      `a handler, there is no component to attach them to.`,
    'Create hooks and call `render()` before the first `await` in setup (write what you await into state), or pass ' +
      'the element explicitly: `useEffect(fn, this)`.',
  ],
};
