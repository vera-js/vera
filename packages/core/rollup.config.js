import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Core opts into property mangling like the renderer, with every cross-boundary name reserved by the
 * negative lookahead rather than left to luck: `_p` (the inserts chain's priority order, read by every
 * inlined copy), `_ignore` (the shallow store mark), `_root` (read by `@verajs/styles` across the
 * bundle boundary), `_cleanups` (the renderer's adapters and `@verajs/ui` add to it), `_gen` (an
 * owner's hook generation — `@verajs/directives` bumps it on its own owners as teardown, so a mangled
 * `_gen` left every directive's hooks running in production), `_hooks` (the prod suite reads it, and
 * tests are a boundary) and the `_$…$` interop family. Everything else `_`-prefixed is core-internal
 * (`_hookPriorities`, `_removed`) and ships as one mangled character. `tests/cdn-cross-bundle.test.mjs`
 * fails if `_p` is ever mangled; `tests/minification-contracts.test.mjs` holds the rest.
 */
export default defaultRollupConfig(pkg.filename, ['@verajs/inserts'], /^_(?!p$|ignore$|root$|hooks$|cleanups$|gen$|\$)[a-z]/);
