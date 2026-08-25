import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Three entries. The base renderer carries no hydration and no profiling code; `hydrate` and
 * `profiler` are secondary entries that add one each.
 *
 * Every entry is a standalone SUPERSET bundle in every mode — `external` is empty, so each one
 * inlines its own copy of `./renderer.js`. That is what makes the mangled internals agree within a
 * bundle, and it is also why **two entries must never be loaded side by side**: each copy has its
 * own template cache, marker and root-part map, so the second would render into state the first
 * cannot see. Substitute, do not add — a CDN page points its importmap's `@verajs/renderer` at
 * whichever bundle it wants and nothing else changes.
 *
 * (An earlier version of this comment said the DEV hydrate build kept `./renderer.js` external.
 * It never did — `dist/development/vera-renderer-hydrate.js` has no imports and declares its own
 * `rootParts`. The substitute-don't-add rule was always the real constraint.)
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
   * exempt `$c`/`$u`/`$f`/`$m`/`$d` members. It is safe alongside `hydrate`, which is exactly why it
   * cannot import `./renderer.js` — that would bind it to the base renderer's template cache.
   */
  defaultRollupConfig(`${pkg.filename}-keyed`, [], /^_[a-z]/, { input: 'src/keyed.ts' }),
  /** Additive for the same reason, and it inlines `spread` because it builds on that protocol. */
  defaultRollupConfig(`${pkg.filename}-tag`, [], /^_[a-z]/, { input: 'src/tag.ts' }),
  ...(isProduction
    ? []
    : [defaultRollupConfig(`${pkg.filename}-profiler`, [], /^_[a-z]/, { input: 'src/profiler.ts' })]),
];
