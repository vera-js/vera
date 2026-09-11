/**
 * The bundles whose sizes are CLAIMED — the one list, imported by both readers.
 *
 * Data only, with no side effects, and that is the point: `bench/size.mjs --snapshot` needs this
 * list, and importing `sync-size-claims.mjs` for it ran that whole script — rewriting the docs as a
 * side effect of taking a measurement.
 *
 * The two readers must agree exactly. `sync-size-claims.mjs --check` compares every module here
 * against the snapshot, so one that is claimed but unsnapshotted reads as stale on every run and no
 * rebuild can clear it. That is what enrolling `@verajs/directives` walked into, with the list
 * written out twice and eight entries added to one copy.
 */
export const MODULES = [
  { pkg: 'core', dist: 'packages/core/dist/vera.min.js', what: 'state (incl. Map and Set), hooks, lifecycle, render' },
  { pkg: 'renderer', dist: 'packages/renderer/dist/vera-renderer.min.js', what: 'keyed template renderer, refs, `hold`' },
  { pkg: 'router', dist: 'packages/router/dist/vera-router.min.js', what: 'nested routes, params, wildcards, redirects, scroll memory' },
  { pkg: 'autoloader', dist: 'packages/autoloader/dist/vera-autoloader.min.js', what: 'lazy component discovery' },
  { pkg: 'styles', dist: 'packages/styles/dist/vera-styles.min.js', what: '`static styles` adoption, shadow and light DOM' },
  { pkg: 'spread', dir: 'renderer', dist: 'packages/renderer/dist/vera-renderer-spread.min.js', what: '`${spread(props)}` — runtime-named bindings' },
  { pkg: 'tag', dir: 'renderer', dist: 'packages/renderer/dist/vera-renderer-tag.min.js', what: '`<${tag}>` — runtime tag names, in templates and JSX' },
  { pkg: 'computed', dir: 'reactivity', dist: 'packages/reactivity/dist/vera-reactivity-computed.min.js', what: 'memoised derived values' },
  { pkg: 'collections', dir: 'reactivity', dist: 'packages/reactivity/dist/vera-reactivity-collections.min.js', what: 'reactive `Map` and `Set` in a store' },
  { pkg: 'keyed', dir: 'renderer', dist: 'packages/renderer/dist/vera-renderer-keyed.min.js', what: '`keyed()` — keyed list reconciliation' },
  { pkg: 'slots', dir: 'renderer', dist: 'packages/renderer/dist/vera-renderer-slots.min.js', what: '`<slot>` distribution in a LIGHT-DOM component, and `slotted()`' },
  { pkg: 'inserts', dist: 'packages/inserts/dist/vera-inserts.min.js', what: 'the extension point' },
  /**
   * `@verajs/directives` enrols per ENTRY, not as one number, because one number is the thing that
   * misleads here: the root bundle re-exports every pack and reads ~31 KB, while an app wiring the
   * engine plus expressions and interaction ships a third of that and one wiring motion pays more
   * than the rest combined. A single figure would be true of a bundle almost nobody builds.
   */
  { pkg: 'directives', label: 'directives/core', dist: 'packages/directives/dist/vera-directives-core.min.js', what: 'the engine — registry, activation, context, delegation (core external)' },
  { pkg: 'directives-standalone', dir: 'directives', label: 'directives/standalone', dist: 'packages/directives/dist/vera-directives-standalone.min.js', what: 'the engine with its own store, for a page running no vera' },
  { pkg: 'directives-expressions', dir: 'directives', label: 'directives/expressions', dist: 'packages/directives/dist/vera-directives-expressions.min.js', what: 'the expression tier — arithmetic, comparisons, calls' },
  { pkg: 'directives-interactions', dir: 'directives', label: 'directives/interactions', dist: 'packages/directives/dist/vera-directives-interactions.min.js', what: 'the interaction pack — events, reflections, state' },
  { pkg: 'directives-query', dir: 'directives', label: 'directives/query', dist: 'packages/directives/dist/vera-directives-query.min.js', what: 'the query pack — route, query, list' },
  { pkg: 'directives-sensors', dir: 'directives', label: 'directives/sensors', dist: 'packages/directives/dist/vera-directives-sensors.min.js', what: 'the sensors pack — environment to state' },
  { pkg: 'directives-remote', dir: 'directives', label: 'directives/remote', dist: 'packages/directives/dist/vera-directives-remote.min.js', what: 'the remote pack — server-driven interactions' },
  { pkg: 'directives-motion', dir: 'directives', label: 'directives/motion', dist: 'packages/directives/dist/vera-directives-motion.min.js', what: 'the motion pack — presets, easings, paint, path, sequence, split' },
  /** The @verajs/motion package (the cut, 2026-09-10) — the three adoption entries. */
  { pkg: 'motion', label: 'motion/core', dist: 'packages/motion/dist/vera-motion.min.js', what: 'the motion engine — compiler + writer, no directives engine, no packs' },
  { pkg: 'motion-ssr', dir: 'motion', label: 'motion/ssr', dist: 'packages/motion/dist/vera-motion-ssr.min.js', what: 'renderMotion — mark a server document, emit its sheet' },
  { pkg: 'motion-client', dir: 'motion', label: 'motion/client', dist: 'packages/motion/dist/vera-motion-client.min.js', what: 'the reader — delivery, drive and functions, no compiler' },
];