import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Two entries. The base renderer carries no hydration code; `hydrate` is a secondary entry that
 * arms it. In DEV the hydrate build keeps `./renderer.js` external (one shared module, one
 * state); in PROD it is a standalone SUPERSET bundle — renderer + adoption minified in one terser
 * pass, so mangled internals agree by construction. A CDN SSR page points its importmap's
 * `@verajs/renderer` at the hydrate bundle; nothing else changes.
 */
export default [
  defaultRollupConfig(pkg.filename, [], /^_[a-z]/),
  defaultRollupConfig(`${pkg.filename}-hydrate`, [], /^_[a-z]/, { input: 'src/hydrate.ts' }),
];
