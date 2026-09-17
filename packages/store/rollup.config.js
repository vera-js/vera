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

/**
 * `collections` keeps core external like the others, but for a different reason: it does not import
 * core at all. It implements the `'collection'` extension point, so core hands it what it needs at
 * dispatch — which is what makes it safe alongside any build of core rather than tied to one.
 */
export default [
  entry(pkg.filename),
  entry(`${pkg.filename}-computed`, 'src/computed.ts'),
  entry(`${pkg.filename}-collections`, 'src/collections.ts'),
];
