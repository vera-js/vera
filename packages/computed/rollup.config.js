import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * `@verajs/core` stays external in **every** mode, unlike the other modules.
 *
 * This package is built on core's public API — `createStore` and `createHook` — rather than beside
 * it. Inlining core into the standalone bundle, which is what production does by default, would
 * hand a CDN page a second core: a second insert registry, a second store identity, and computeds
 * that track a different set of objects from the components reading them. Kept external, the import
 * map resolves it to the one core everything else already has.
 */
export default defaultRollupConfig(pkg.filename, ['@verajs/core'], undefined, {
  alwaysExternal: ['@verajs/core'],
});
