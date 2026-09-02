import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * `@verajs/core` stays external in **every** build, exactly as `@verajs/reactivity` keeps it: a
 * controller's stores must live in the same core the app renders from, and a bundled private copy
 * would give this package its own store registry that nothing else can see. On a CDN page the
 * importmap resolves the bare specifier; under a bundler the dependency dedupes.
 */
/**
 * `_cleanups` is exempt from mangling: it is core's release-on-unmount contract on the live
 * element, exempted identically in core's own regex and held unmangled by
 * `tests/core-structural-contracts.test.mjs`. Mangling it here renamed the read while core kept
 * the real name — dismissal listeners then leaked on unmount, production build only.
 */
export default defaultRollupConfig(pkg.filename, ['@verajs/core'], /^_(?!cleanups$)[a-z]/, {
  alwaysExternal: ['@verajs/core'],
});
