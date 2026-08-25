/**
 * Resolves a built artifact for the condition under test.
 *
 * The suites run twice — once against `dist/development/*.js`, once against `dist/*.min.js` —
 * because those are different programs. Four transformations happen only in the production build:
 *
 *   1. **Property mangling.** `@verajs/renderer` renames every `/^_[a-z]/` property.
 *   2. **Dead-code elimination.** `__DEV__` folds to `false` and its branches are deleted.
 *   3. **`drop_console: ['log']`.** `console.log` calls are removed (`error`/`warn` survive).
 *   4. **Workspace inlining.** Development keeps `@verajs/inserts` as a real import; production
 *      copies it into each bundle — which is why two standalone bundles hold two registries and
 *      `connectInserts` exists at all.
 *
 * **A development bundle can still reach production code.** `dist/development/*.js` keeps workspace
 * deps external, so loading core's development bundle resolves `@verajs/inserts` through its
 * `exports` map — and with no `development` condition set, that lands on `dist/*.min.js`, where the
 * `__DEV__` guards are gone. A suite checking a development-only warning must therefore `load` the
 * package that *owns* the guard rather than reach it through a re-export, or it silently asserts
 * against the production build. A real app is unaffected: a bundler sets the condition.
 *
 * A suite that only ever loaded `dist/development` proved the logic and nothing about the artifact
 * that ships. Notably, `_p` in `@verajs/inserts` is a cross-bundle contract that a mangling regex
 * would silently rename; the development build cannot show that.
 *
 *   npm test                       # development
 *   VERA_DIST=production npm test  # production
 *   npm run test:all               # both
 */
export const isProduction = process.env.VERA_DIST === 'production';

/** Bundle name -> the `filename` its package.json declares. */
const ENTRY = {
  core: ['core', 'vera'],
  renderer: ['renderer', 'vera-renderer'],
  'renderer/hydrate': ['renderer', 'vera-renderer-hydrate'],
  'renderer/profiler': ['renderer', 'vera-renderer-profiler'],
  router: ['router', 'vera-router'],
  autoloader: ['autoloader', 'vera-autoloader'],
  inserts: ['inserts', 'vera-inserts'],
  'reactivity/computed': ['reactivity', 'vera-reactivity-computed'],
  reactivity: ['reactivity', 'vera-reactivity'],
  'renderer/keyed': ['renderer', 'vera-renderer-keyed'],
  'renderer/spread': ['renderer', 'vera-renderer-spread'],
  'renderer/tag': ['renderer', 'vera-renderer-tag'],
  styles: ['styles', 'vera-styles'],
  collections: ['collections', 'vera-collections'],
};

/**
 * `@verajs/renderer/profiler` is deliberately not built for production — its instrumentation is
 * behind `__DEV__`, so a production profiler would measure code the build removed.
 */
export const NO_PRODUCTION_BUILD = new Set(['renderer/profiler']);

/** Absolute URL of a built bundle. `query` forces a fresh module instance (`?copy=a`). */
export const distUrl = (name, query = '') => {
  const entry = ENTRY[name];
  if (entry === undefined) throw new Error(`tests/dist.mjs: unknown bundle "${name}"`);
  const [pkg, file] = entry;
  const path = isProduction ? `${file}.min.js` : `development/${file}.js`;
  return new URL(`../packages/${pkg}/dist/${path}${query}`, import.meta.url).href;
};

export const load = (name, query = '') => import(distUrl(name, query));
