import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Three builds. `vera-directives` = engine + interaction (the paste-and-go main).
 * `vera-directives-engine` = the engine alone — the artifact the §14 budget is MEASURED against,
 * and the à-la-carte base for pages wiring only custom directives. `vera-directives-expressions`
 * is ADDITIVE (imports nothing from the engine; connects through wireDirectives' seams), so a
 * literal-only page never downloads an evaluator and two bundles cannot make two engines.
 * `_`-prefixed members mangle, the renderer's rule; cross-bundle surfaces (descriptor fields,
 * seams, kind/thunk nodes) are deliberately unprefixed.
 */
export default [
  defaultRollupConfig(pkg.filename, ['@verajs/core'], /^_[a-z]/),
  /** The engine entry follows REACTIVITY's precedent, not the standalone one: core stays external
   *  in every mode, because this entry's audience is a-la-carte VERA pages — exactly where an
   *  inlined second core is the documented two-copies hazard. The paste-and-go main above keeps
   *  inlining for pages with no vera at all. Both worlds, each with the right physics. */
  defaultRollupConfig(`${pkg.filename}-engine`, ['@verajs/core'], /^_[a-z]/, { input: 'src/engine.ts', alwaysExternal: ['@verajs/core'] }),
  defaultRollupConfig(`${pkg.filename}-expressions`, [], /^_[a-z]/, { input: 'src/expressions.ts' }),
  defaultRollupConfig(`${pkg.filename}-engine-scratch`, ['@verajs/core'], /^_[a-z]/, { input: 'src/engine.ts', alwaysExternal: ['@verajs/core'] }),
];
