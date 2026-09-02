import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Core now opts into property mangling like the renderer, with every cross-boundary name
 * reserved by the negative lookahead rather than left to luck: `_p` (the inserts chain's
 * priority order, read by every inlined copy), `_isSignal`/`_ignore`/`_delete` (the store's
 * public marker contract in `@verajs/shared-types`), `_root` (read by `@verajs/styles` across
 * the bundle boundary), and the `_$…$` interop family. Everything else `_`-prefixed is
 * core-internal (`_hookPriorities`, `_cleanups`, `_gen`, `_removed`; `_hooks` stays — the prod suite reads it, and tests are a boundary) and ships as one
 * mangled character. `tests/cdn-cross-bundle.test.mjs` fails if `_p` is ever mangled.
 */
export default defaultRollupConfig(pkg.filename, ['@verajs/inserts'], /^_(?!p$|isSignal$|ignore$|delete$|root$|hooks$|cleanups$|\$)[a-z]/);
