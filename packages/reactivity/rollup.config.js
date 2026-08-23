import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * One entry per primitive, plus a root that re-exports them all.
 *
 * A bundler takes the root and shakes away what you did not import; a buildless page points its
 * import map at a subpath and downloads only that. Both give the same result, which is the point of
 * splitting rather than shipping one blob.
 *
 * `@verajs/core` stays external in **every** mode, including production. These are built *on*
 * core's public API, so inlining it — what a standalone bundle normally does — would hand a page a
 * second core: a second insert registry, a second store identity, and computeds tracking different
 * objects from the components reading them. That also makes these entries **additive**, unlike
 * `@verajs/renderer`'s, which each inline the renderer and must substitute for one another.
 */
const entry = (name, input) =>
  defaultRollupConfig(name, ['@verajs/core'], undefined, {
    ...(input ? { input } : {}),
    alwaysExternal: ['@verajs/core'],
  });

export default [entry(pkg.filename), entry(`${pkg.filename}-computed`, 'src/computed.ts')];
