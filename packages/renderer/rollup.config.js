import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Six builds, in **two categories**, and the difference decides what may be loaded together.
 *
 * | bundle | prod size | contains a renderer | rule |
 * | --- | --- | --- | --- |
 * | `vera-renderer` | 9875 B | yes | pick one |
 * | `vera-renderer-hydrate` | 13608 B | yes | pick one |
 * | `vera-renderer-profiler` | dev only | yes | pick one |
 * | `vera-renderer-keyed` | 1184 B | **no** | add freely |
 * | `vera-renderer-spread` | 1639 B | **no** | add freely |
 * | `vera-renderer-tag` | 2845 B | **no** (inlines `spread`) | add freely |
 *
 * **Substitutes.** `renderer`, `hydrate` and `profiler` each inline their own `./renderer.js`, with
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
  defaultRollupConfig(`${pkg.filename}-hydrate`, [], /^_[a-z]/, { input: 'src/hydrate.ts' }),
  /**
   * `spread` is the one entry here that is **additive** rather than a substitute. The others inline
   * `./renderer.js` and carry their own template cache, so two of them must never load together;
   * this one imports nothing at all — it talks to whatever renderer is present through the
   * `_$apply$` protocol — so it is safe alongside any of them.
   */
  defaultRollupConfig(`${pkg.filename}-spread`, [], /^_[a-z]/, { input: 'src/spread.ts' }),
  /**
   * Additive for the same reason: it imports nothing and reaches the renderer only through the
   * exempt `$c`/`$d`/`$f`/`$k`/`$m`/`$r`/`$u` members (the full set, taken from the source — this
   * list previously named five of the seven and omitted `$k` and `$r`, which carry the key itself). It is safe alongside `hydrate`, which is exactly why it
   * cannot import `./renderer.js` — that would bind it to the base renderer's template cache.
   */
  defaultRollupConfig(`${pkg.filename}-keyed`, [], /^_[a-z]/, { input: 'src/keyed.ts' }),
  /** Additive for the same reason, and it inlines `spread` because it builds on that protocol. */
  defaultRollupConfig(`${pkg.filename}-tag`, [], /^_[a-z]/, { input: 'src/tag.ts' }),
  ...(isProduction
    ? []
    : [defaultRollupConfig(`${pkg.filename}-profiler`, [], /^_[a-z]/, { input: 'src/profiler.ts' })]),
];
