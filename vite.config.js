import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import { veraJsx } from './packages/jsx/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Every workspace entry point, aliased to the TypeScript it is built from, so the examples this
 * server hosts run against **sources** and an edit shows up on reload.
 *
 * **Derived rather than listed.** The list was written by hand and had fallen four packages behind:
 * `@verajs/styles`, `@verajs/reactivity/collections`, `@verajs/renderer/keyed` and
 * `@verajs/renderer/spread` are all used by the examples and none was aliased, so the dev server
 * served those from `dist` while serving the rest from `src` — a mixture nothing announced, where
 * editing one package took effect immediately and editing another silently did nothing until a
 * rebuild.
 *
 * Subpaths are aliased individually because Vite matches an alias key exactly: aliasing
 * `@verajs/renderer` does nothing for `@verajs/renderer/keyed`.
 *
 * The source is `src/<subpath>.ts`, or `src/index.ts` for the root — the convention every buildable
 * package follows. An entry with no `.ts` behind it (`@verajs/ssr` publishes its source,
 * `@verajs/jsx` is a build plugin) is skipped, so it resolves the way a consumer's would.
 */
const sourceAliases = () => {
  const alias = {};
  for (const directory of readdirSync(resolve(here, 'packages'))) {
    const manifest = resolve(here, 'packages', directory, 'package.json');
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    for (const key of Object.keys(pkg.exports ?? { '.': true })) {
      const subpath = key === '.' ? 'index' : key.slice(2);
      const source = resolve(here, 'packages', directory, 'src', `${subpath}.ts`);
      if (existsSync(source)) alias[pkg.name + (key === '.' ? '' : key.slice(1))] = source;
    }
  }
  /** The two private packages have no `exports` block and are inlined everywhere; alias them anyway. */
  for (const shared of ['shared-types', 'shared-utils']) {
    const source = resolve(here, 'packages', shared, 'src', 'index.ts');
    if (existsSync(source)) alias[`@verajs/${shared}`] = source;
  }
  return alias;
};

export default defineConfig(() => ({
  plugins: [veraJsx()],
  resolve: { alias: sourceAliases() },
}));
