import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Six builds, in **two categories**, and the difference decides what may be loaded together.
 *
 * | bundle | prod size | contains a renderer | rule |
 * | --- | --- | --- | --- |
 * | `vera-renderer` | 9875 B | yes | pick one |
 * | `vera-renderer-hydration` | measured | **no** | add freely |
 * | `vera-renderer-profiler` | dev only | yes | pick one |
 * | `vera-renderer-keyed` | 1184 B | **no** | add freely |
 * | `vera-renderer-spread` | 1639 B | **no** | add freely |
 * | `vera-renderer-tag` | 2845 B | **no** (inlines `spread`) | add freely |
 *
 * **Substitutes.** `renderer` and `profiler` each inline their own `./renderer.js`, with
 * their own template cache, marker and root-part map — so two of *them* must never load side by
 * side: the second renders into state the first cannot see. A CDN page points its importmap's
 * `@verajs/renderer` at whichever one it wants and nothing else changes.
 *
 * **Additions.** `keyed`, `spread` and `tag` import no renderer at all — the sizes above are the
 * proof, and none of the three exports `renderInto`. They reach whatever renderer is present through
 * `$`-prefixed members, which the mangling regex below cannot match. Loading them alongside a
 * renderer is the *documented* CDN recipe, not a hazard.
 *
 * **This header used to say the opposite** — "three entries", "every entry is a standalone SUPERSET
 * bundle in every mode", "two entries must never be loaded side by side" — while the per-entry
 * comments six lines down already said three of them were additive and safe. A maintainer reading the
 * top of the file would have concluded the README's own CDN recipe was forbidden. It had drifted
 * before, too: it carried a parenthetical correcting a still earlier wrong version of itself.
 *
 * `tests/cdn-renderer-interop.test.mjs` now loads four of these production bundles together and uses
 * them, so the additive claim is executed rather than asserted in a comment.
 */
/**
 * The profiler is built for development and types only. Its instrumentation lives behind `__DEV__`,
 * which the production build folds to `false` — so a production profiler bundle would collect
 * nothing, from property-mangled output, at the cost of shipping a second renderer.
 */
const isProduction = process.env.MODE === 'prod';

export default [
  defaultRollupConfig(pkg.filename, [], /^_[a-z]/),
  /**
   * Additive: `wire([renderer, hydration])`. It imports no renderer — it reaches the one present through the
   * hand-off the renderer sets at `connect` (`$H`, sigiled, so the mangling regex cannot touch it).
   */
  /*
   * **Compiled eagerly, as it is loaded** (Chromium's explicit compile hint; other engines ignore the comment). Every
   * function in this module runs on a hydrating page's first render, so lazy compilation only compiles it twice — a
   * pre-parse at load, then a full compile inside the first hydration. Measured on V8 traces (2026-10-02, 30 fresh
   * pages each, 1k rows): compile inside the first hydration 0.99 → 0.62 ms (lower on 30/30), the first hydration
   * 6.45 → 6.10 ms, main-thread compile before it unchanged — the work moves to a BACKGROUND thread (+0.9 ms there),
   * which on a busy low-core device competes with other work: less main-thread work, not free. It applies to a page
   * that loads this file on its own; a bundler strips the comment, harmlessly. `tests/dist-preamble` pins it.
   */
  defaultRollupConfig(`${pkg.filename}-hydration`, [], /^_[a-z]/, {
    input: 'src/hydration.ts',
    preamble: '//# allFunctionsCalledOnLoad',
  }),
  /**
   * **Additive**, the first of three. It imports nothing at all and talks to whatever renderer is
   * present through the `_$apply$` protocol, so it is safe alongside any of them.
   *
   * This comment used to open "`spread` is the one entry here that is additive", and add that "the
   * others inline `./renderer.js`" — with `keyed` and `tag` documented as additive immediately below
   * it. Same contradiction as the file header had, one level down, and it survived the header being
   * corrected because that fix stopped at the top of the file.
   */
  defaultRollupConfig(`${pkg.filename}-spread`, [], /^_[a-z]/, { input: 'src/spread.ts' }),
  /**
   * Additive for the same reason: it imports nothing and reaches the renderer only through the exempt
   * `$c`/`$d`/`$f`/`$k`/`$m`/`$r`/`$u` members — the full set, read from the source. This list named
   * five of the seven, omitting `$k` and `$r`, which are the two carrying the key itself.
   *
   * Safe alongside `hydrate`, which is exactly why it cannot import `./renderer.js` — that would bind
   * it to the base renderer's template cache.
   */
  defaultRollupConfig(`${pkg.filename}-keyed`, [], /^_[a-z]/, { input: 'src/keyed.ts' }),
  /** Additive for the same reason, and it inlines `spread` because it builds on that protocol. */
  defaultRollupConfig(`${pkg.filename}-tag`, [], /^_[a-z]/, { input: 'src/tag.ts' }),
  /**
   * Additive: it inlines `elements` (it claims each `<slot>` and each dashed host through it) and imports
   * nothing else; the renderer reaches IT through `_$done$` on the registry (a render ended) and the
   * `_$slotted$` mark on a node it moved, and `hydrate-slots` through `_$capture$` — mangle-exempt by the
   * same `$` rule as the others. Its `'slot'` insert is only a marker: `@verajs/ssr` distributes on the
   * server, with its own copy of the format, while it is wired.
   */
  defaultRollupConfig(`${pkg.filename}-slots`, [], /^_[a-z]/, { input: 'src/slots.ts' }),
  /**
   * Additive: hydrating light slots — the server's light-slot format, read only where both `hydration` and
   * `slots` are wired. Imports nothing; it reaches them through `_$hydrateSlots$` (hydration calls it) and
   * `_$capture$` (it calls slots), both stamped with the package's seam protocol.
   */
  defaultRollupConfig(`${pkg.filename}-hydrate-slots`, [], /^_[a-z]/, { input: 'src/hydrate-slots.ts' }),
  /**
   * Additive for the same reason as `slots`: imports nothing, and the renderer reaches it only
   * through the wired `'template'` insert and the sigiled `_$at$`/`_$ns$` members.
   */
  defaultRollupConfig(`${pkg.filename}-namespaces`, [], /^_[a-z]/, { input: 'src/namespaces.ts' }),
  /**
   * Additive for the same reason: imports nothing; the renderer reaches it only through the wired
   * `'template'` insert and the `$`-named instance hook, and claimants reach it through `'element'`.
   */
  defaultRollupConfig(`${pkg.filename}-elements`, [], /^_[a-z]/, { input: 'src/elements.ts' }),
  ...(isProduction ? [] : [defaultRollupConfig(`${pkg.filename}-profiler`, [], /^_[a-z]/, { input: 'src/profiler.ts' })]),
];
