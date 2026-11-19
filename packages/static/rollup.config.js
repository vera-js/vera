import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * **One entry, standalone in every build** (`@verajs/static`, its own package since 2026-11-18): no workspace dependency
 * stays external, so a page or an app needs this package alone. The mangle pattern is lite's.
 */
export default [defaultRollupConfig(pkg.filename, [], /^_(?!p$)[a-z]/)];
