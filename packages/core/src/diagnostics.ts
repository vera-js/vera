/**
 * **Core's diagnostics, keyed by code — DEVELOPMENT ONLY.** Referenced only behind `__DEV__`, so production drops this
 * module whole and prints the shared short line (`diagnostic`, shared-utils): the subject and the link to
 * `docs.verajs.dev/e/<code>`. `scripts/sync-diagnostics.mjs` publishes this table as `packages/core/diagnostics.json`
 * — the docs pages — and `tests/diagnostics-tables.test.mjs` holds the codes raised and the entries together.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'no-collections': () => [
    'is handed back as it is — it works, but nothing that reads it updates when it changes.',
    "Make it reactive: `import { collections } from '@verajs/store/collections'` and add it to your `wire([…])` call.",
  ],
  'no-renderer': () => [
    'no renderer is wired, so nothing will appear.',
    "Wire one once, at your app entry: `import { renderer } from '@verajs/renderer'; wire([renderer]);`",
  ],
  'sync-loop': () => [
    're-entered 50 times and was stopped — it writes state it also reads, and it runs synchronously on every change, ' +
      'so an unguarded write feeds itself.',
    'Guard the write (`if (next !== state.x) state.x = next`), or use `useEffect`, which coalesces.',
  ],
  'no-owner': () => [
    `there is no component being set up. Hooks, \`render()\` and \`mount()\` belong to a component's setup, which runs ` +
      `synchronously from \`init(this)\` and ends at the first \`await\` — so after an \`await\` in setup, or later in ` +
      `a handler, there is no component to attach them to.`,
    'Await BEFORE `init(this)`; or create hooks and call `render()` before the first `await` and write what you await ' +
      'into state; or pass the element explicitly: `useEffect(fn, this)`.',
  ],
};
