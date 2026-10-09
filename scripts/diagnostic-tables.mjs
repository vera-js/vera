/**
 * **Every package that prints diagnostics in the shared format** (`diagnostic`, shared-utils) besides directives, whose
 * file carries more than its codes. ONE list, read by `scripts/sync-diagnostics.mjs` (which publishes each table as
 * `packages/<name>/diagnostics.json`) and by `tests/diagnostics-tables.test.mjs` (which holds raised codes and entries
 * together) — so converting a package is one line here. A package joins only when its production bundle measured
 * smaller for converting (Brian, 2026-10-02).
 */
export const TABLES = [
  { name: 'renderer', table: 'src/hydration-diagnostics.ts', sources: ['src/hydration.ts'] },
  { name: 'core', table: 'src/diagnostics.ts', sources: ['src/modules/createHook.ts', 'src/hooks/coalesce.ts', 'src/hooks/useRender.ts', 'src/services/createProxy.ts'] },
];
