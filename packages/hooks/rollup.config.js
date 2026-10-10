import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * `@verajs/core` stays external in **every** build, exactly as `@verajs/store` keeps it: a
 * controller's stores must live in the same core the app renders from, and a bundled private copy
 * would give this package its own store registry that nothing else can see. On a CDN page the
 * importmap resolves the bare specifier; under a bundler the dependency dedupes.
 */
/**
 * Core's release-on-unmount set is `_$c$`, sigiled, so no mangling regex can rename the read (a mangled `_cleanups`
 * here once leaked dismissal listeners on unmount, production build only); `tests/core-structural-contracts.test.mjs`
 * holds the name.
 */
export default defaultRollupConfig(pkg.filename, ['@verajs/core'], /^_[a-z]/, {
  alwaysExternal: ['@verajs/core'],
});
