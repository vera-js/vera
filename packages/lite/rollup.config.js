import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * **One entry, standalone in every build** (`@verajs/lite`, its own package since 2026-11-17): no workspace dependency
 * stays external, so a page or an app needs this package alone. The mangle pattern is core's, unchanged from when this was core's second entry (so the bundle is the same).
 */
export default [defaultRollupConfig(pkg.filename, [], /^_(?!p$)[a-z]/)];
