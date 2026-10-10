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
 * `checkedBy` names the test that holds a package's manifest when the generic call pattern cannot read its raises.
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
  { name: 'autoloader', tables: ['src/diagnostics.ts'], sources: ['src/autoloader.ts', 'src/loader.ts'] },
  { name: 'inserts', tables: ['src/diagnostics.ts'], sources: ['src/inserts.ts'] },
  { name: 'store', tables: ['src/diagnostics.ts'], sources: ['src/computed.ts'] },
  { name: 'ui', tables: ['src/diagnostics.ts'], sources: ['src/register.ts', 'src/select/element.ts'] },
  { name: 'router', tables: ['src/diagnostics.ts'], sources: ['src/events.ts', 'src/methods.ts', 'src/router.ts', 'src/services.ts'] },
  /**
   * Motion raises through routes of its own (`pageProblem`, refusal objects, a settings-type map), which the generic
   * call pattern cannot read — so its manifest is held by the motion-aware scanner in `checkedBy`, beside directives'
   * (the pack forwards motion's codes into that engine). Listed here so its table is published and joins the one
   * namespace.
   */
  { name: 'motion', tables: ['src/diagnostics.ts'], sources: [], checkedBy: 'tests/diagnostics-table.test.mjs' },
  /**
   * ssr keeps its words in every build (Node, no `__DEV__`), raising `ssrMisuse('code', PROSE['code']…)` /
   * `ssrWarning(…, 'code', PROSE['code']…)` — its manifest is held by tests/ssr-coded-diagnostics. Its TWINS (shared
   * facts it restates) are not in PROSE, so they are never published as ssr's.
   */
  { name: 'ssr', tables: ['src/vera/diagnostics.ts'], sources: [], checkedBy: 'tests/ssr-coded-diagnostics.test.mjs' },
  /**
   * cms (phase 5): one table per side — `publish-diagnostics` (schema, manifests, the build, the writer) for the entries
   * read by the person who fixes the error (built with `words: true`), and the content side's for a visitor's page.
   */
  { name: 'cms', tables: ['src/publish-diagnostics.ts'], sources: ['src/schema.ts', 'src/manifest.ts', 'src/node.ts'] },
  /** The compiler's table keeps its words in every build; the standalone loader's is development-only. */
  { name: 'jsx', tables: ['src/compiler-diagnostics.ts', 'src/standalone-diagnostics.ts'], sources: ['src/transform.ts', 'src/parser.ts', 'src/standalone.ts'] },
  { name: 'core', tables: ['src/diagnostics.ts'], sources: ['src/modules/createHook.ts', 'src/hooks/coalesce.ts', 'src/hooks/useRender.ts', 'src/services/createProxy.ts', 'src/modules/untrack.ts', 'src/modules/init.ts', 'src/modules/adoptProps.ts', 'src/modules/scheduler.ts', 'src/store/store.ts', 'src/modules/render.ts', 'src/modules/createStore.ts', 'src/index.ts'] },
];

/**
 * **Directives' tables** — the engine's and each pack's own (one per pack entry, as the renderer's) — merged into one
 * `packages/directives/diagnostics.json`, which `scripts/sync-diagnostics.mjs` publishes WITH the payload vocabulary,
 * so directives is not in TABLES. Its manifest is `checkedBy` the motion-aware scanner (the pack forwards motion's
 * codes); through-tables reads its tables from here.
 */
export const DIRECTIVES = { name: 'directives', tables: ['src/diagnostics.ts', 'src/remote-diagnostics.ts'], checkedBy: 'tests/diagnostics-table.test.mjs' };
