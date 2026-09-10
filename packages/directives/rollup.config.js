import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Five builds — the role-name grammar (design §16b): root = everything (wired: nothing),
 * `core` = the minimal heart, `standalone` = self-contained. `_`-prefixed members mangle, the
 * renderer's rule; cross-bundle surfaces (descriptor fields, seams, kind/thunk nodes, the
 * substrate stamp) are deliberately unprefixed.
 *
 * - `vera-directives` — engine + every pack, core INLINED in prod (paste-and-go; substrate
 *   adoption makes it safe beside vera.min.js — the engine uses the wired core's stamp).
 * - `vera-directives-core` — the engine alone, core external in EVERY mode (reactivity's
 *   precedent): the à-la-carte entry for pages that already load vera, and the artifact the §14
 *   budget is measured against.
 * - `vera-directives-standalone` — the engine alone with core's store machinery inlined, for
 *   pages with no vera at all that wire only custom directives.
 * - `vera-directives-interaction` / `vera-directives-expressions` — ADDITIVE packs: they import
 *   nothing from the engine (interaction reaches it through `Ctx`; expressions connects through
 *   `wireDirectives`' seams), so a multi-file CDN page cannot end up with two engines.
 */
export default [
  defaultRollupConfig(pkg.filename, ['@verajs/core'], /^_[a-z]/),
  defaultRollupConfig(`${pkg.filename}-core`, ['@verajs/core'], /^_[a-z]/, { input: 'src/engine.ts', alwaysExternal: ['@verajs/core'] }),
  defaultRollupConfig(`${pkg.filename}-standalone`, ['@verajs/core'], /^_[a-z]/, { input: 'src/engine.ts' }),
  defaultRollupConfig(`${pkg.filename}-interaction`, [], /^_[a-z]/, { input: 'src/interaction.ts' }),
  defaultRollupConfig(`${pkg.filename}-motion`, [], /^_[a-z]/, { input: 'src/motion/index.ts' }),
  /** The LEAN motion entry (adoption condition 1): compiler + writer, no engine, no packs —
   *  the bundle whose published size the adoption calculus runs on. */
  defaultRollupConfig(`${pkg.filename}-motion-core`, [], /^_[a-z]/, { input: 'src/motion/core-entry.ts' }),
  defaultRollupConfig(`${pkg.filename}-motion-ssr`, [], /^_[a-z]/, { input: 'src/motion/ssr-entry.ts' }),
  defaultRollupConfig(`${pkg.filename}-remote`, [], /^_[a-z]/, { input: 'src/remote.ts' }),
  defaultRollupConfig(`${pkg.filename}-query`, [], /^_[a-z]/, { input: 'src/query.ts' }),
  defaultRollupConfig(`${pkg.filename}-sensors`, [], /^_[a-z]/, { input: 'src/sensors.ts' }),
  defaultRollupConfig(`${pkg.filename}-expressions`, [], /^_[a-z]/, { input: 'src/expressions.ts' }),
];
