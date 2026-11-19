import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Core opts into property mangling like the renderer. **What core keeps on an element is never mangled, by its NAME:**
 * every host field is sigiled (`_$g$ _$h$ _$r$ _$c$ _$x$ _$d$ _$m$ _$s$ _$v$`, and `_$k$` in development), which
 * `/^_[a-z]/` never matches (2026-10-10). Before, the cross-boundary ones were reserved one by one in this regex —
 * each added after a production-only failure (`_cleanups` leaked dismissal listeners, `_root` lost closed roots,
 * `_gen` left directives' hooks running) — and the rest shipped as single letters a minified author base class could
 * own; and directives' own build still mangled the `_gen` it wrote, onto core's `_hookPriorities`. A sigil is the
 * reservation, in every package at once. `_p` (the inserts chain's priority order, on a chain, not an element) stays
 * reserved here: `tests/cdn-cross-bundle.test.mjs` fails if it is ever mangled.
 */
/** The small tier, built here as `vera-lite` until 2026-11-17, is its own package now: `@verajs/lite`. */
const mangle = /^_(?!p$)[a-z]/;
export default [defaultRollupConfig(pkg.filename, ['@verajs/inserts'], mangle)];
