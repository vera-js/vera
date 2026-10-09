/**
 * **Every package that prints diagnostics in the shared format** (`diagnostic`, shared-utils) besides directives, whose
 * file carries more than its codes. ONE list, read by `scripts/sync-diagnostics.mjs` (which publishes each table as
 * `packages/<name>/diagnostics.json`) and by `tests/diagnostics-tables.test.mjs` (which holds raised codes and entries
 * together) — so converting a package is one line here. A package joins only when its production bundle measured
 * smaller for converting (Brian, 2026-10-02).
 *
 * `tables` (2026-10-09): a package may keep several — one per bundle entry, so a development bundle carries only its
 * own prose — and they are MERGED into its one `diagnostics.json`. `shared-utils` holds the codes more than one package
 * prints (raised as `SHARED['code']`, never re-entered in a second table); its `sources` are its own files that print.
 */
/** `tagCalled` → `tag-called`: a shared table's export name IS its code (see shared-utils' diagnostics.ts). */
export const codeOf = (name) => name.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`);
/**
 * A table module → `{ code: prose }`. A package table exports one `PROSE` object (its bundle owns every entry); the
 * shared table exports one function per code, so a bundle keeps only those it raises — its map is derived here.
 */
export const proseOf = (module) =>
  module.PROSE ?? Object.fromEntries(Object.entries(module).filter(([, fn]) => typeof fn === 'function').map(([name, fn]) => [codeOf(name), fn]));

export const TABLES = [
  { name: 'shared-utils', tables: ['src/diagnostics.ts'], sources: ['src/adopt-property.ts', 'src/utils.ts', 'src/markup-grammar.ts'] },
  {
    name: 'renderer',
    tables: ['src/hydration-diagnostics.ts', 'src/renderer-diagnostics.ts', 'src/spread-diagnostics.ts', 'src/tag-diagnostics.ts', 'src/keyed-diagnostics.ts', 'src/elements-diagnostics.ts', 'src/slots-diagnostics.ts', 'src/hydrate-slots-diagnostics.ts'],
    sources: ['src/hydration.ts', 'src/renderer.ts', 'src/spread.ts', 'src/tag.ts', 'src/keyed.ts', 'src/elements.ts', 'src/slots.ts', 'src/hydrate-slots.ts'],
  },
  { name: 'styles', tables: ['src/diagnostics.ts'], sources: ['src/styles.ts'] },
  { name: 'core', tables: ['src/diagnostics.ts'], sources: ['src/modules/createHook.ts', 'src/hooks/coalesce.ts', 'src/hooks/useRender.ts', 'src/services/createProxy.ts', 'src/modules/untrack.ts', 'src/modules/init.ts', 'src/modules/adoptProps.ts', 'src/modules/scheduler.ts', 'src/store/store.ts', 'src/modules/render.ts', 'src/modules/createStore.ts', 'src/index.ts'] },
];
