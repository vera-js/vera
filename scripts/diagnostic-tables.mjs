/**
 * **Every package that prints diagnostics in the shared format** (`diagnostic`, shared-utils) besides directives, whose
 * file carries more than its codes. ONE list, read by `scripts/sync-diagnostics.mjs` (which publishes each table as
 * `packages/<name>/diagnostics.json`) and by `tests/diagnostics-tables.test.mjs` (which holds raised codes and entries
 * together) — so converting a package is one line here. A package joins only when its production bundle measured
 * smaller for converting (Brian, 2026-10-02).
 */
export const TABLES = [
  { name: 'renderer', table: 'src/hydration-diagnostics.ts', sources: ['src/hydration.ts'] },
  { name: 'styles', table: 'src/diagnostics.ts', sources: ['src/styles.ts'] },
  { name: 'core', table: 'src/diagnostics.ts', sources: ['src/modules/createHook.ts', 'src/hooks/coalesce.ts', 'src/hooks/useRender.ts', 'src/services/createProxy.ts', 'src/modules/untrack.ts', 'src/modules/init.ts', 'src/modules/adoptProps.ts', 'src/modules/scheduler.ts', 'src/store/store.ts', 'src/modules/render.ts', 'src/modules/createStore.ts', 'src/index.ts'] },
];
