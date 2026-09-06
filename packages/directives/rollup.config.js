import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Two builds. `vera-directives` is the engine + the interaction pack. `vera-directives-expressions`
 * is ADDITIVE (the renderer's rule): it imports nothing from the engine at runtime and reaches it
 * only through the connector `wireDirectives` hands seams to — so the CDN two-bundle page gets ONE
 * engine, and a page whose values are all literals never downloads an evaluator at all.
 */
export default [
  defaultRollupConfig(pkg.filename, ['@verajs/core']),
  defaultRollupConfig(`${pkg.filename}-expressions`, [], undefined, { input: 'src/expressions.ts' }),
];
