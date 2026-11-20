/**
 * **Every component and hook package is complete: present everywhere a package must be, and shaped as the design says.**
 *
 * A package that is missing from one place does not fail loudly: a build edge nobody declared, a recipe nothing runs, a
 * specifier nothing resolves. CLAUDE.md lists six reference forms a RENAME must reach; a NEW package must reach the same
 * places, the other way round. `scripts/new-package.mjs` writes all of them, and this suite holds every package under
 * `packages/components/*` and `packages/hooks/*` to them, plus the design's rules (`DESIGN.md` §2–§3): scope and name
 * from the directory, private and 0.x until launch, a LICENSE, closed `^` peers on core, renderer and styles (D7) and on
 * another component (D8), runtime dependencies only on hooks, a component's registration in `register.ts` behind a guard,
 * and no entry re-exporting another package (R5).
 *
 * The rules are one pure function, so the suite proves itself on synthetic packages, each missing exactly one place:
 * a structure check that finds nothing reports perfect structure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ROOT, packageDirs } from '../scripts/packages.mjs';

/** The registry files a new package must appear in, read as text. */
const REGISTRIES = {
  rootManifest: 'package.json',
  tsconfig: 'tsconfig.json',
  dist: 'tests/dist.mjs',
  docsImports: 'tests/docs-imports.test.mjs',
  docsRecipes: 'tests/docs-recipes.test.mjs',
  sizes: 'scripts/size-modules.mjs',
};

const PEERS = /^@verajs\/(?:core|renderer|styles)$|^@vera-components\/[a-z0-9-]+$|^@codemirror\/[a-z0-9-]+$/;

/**
 * Every problem with one package, as text. `pkg` is `{ dir, manifest, files }`: its directory (`packages/hooks/listbox`),
 * its parsed `package.json`, and `files`, a map from a path inside the package to its text (or `true` for presence).
 *
 * @param {{ dir: string, manifest: Record<string, any>, files: Record<string, string | true> }} pkg
 * @param {Record<keyof REGISTRIES, string>} texts
 * @returns {string[]}
 */
export const problemsOf = ({ dir, manifest, files }, texts) => {
  const problems = [];
  const [, kind, name] = dir.split('/');
  const scope = kind === 'components' ? '@vera-components' : '@vera-hooks';
  const short = dir.slice('packages/'.length);
  const own = `${scope}/${name}`;
  if (manifest.name !== own) problems.push(`name is ${manifest.name}, not ${own} (the scope and name follow the directory)`);
  if (manifest.private !== true) problems.push('not private: every package stays private until launch');
  if (!/^0\./.test(String(manifest.version))) problems.push(`version ${manifest.version} is not 0.x (1.0.0 is the launch)`);
  if (!files.LICENSE) problems.push('no LICENSE');
  for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (!PEERS.test(peer)) problems.push(`peer ${peer} is not one a component may have (DESIGN §3.1, D8)`);
    else if (!/^\^\d/.test(range)) problems.push(`peer ${peer} has range ${range}, not a closed ^ range (D7)`);
  }
  for (const dependency of Object.keys(manifest.dependencies ?? {}))
    if (!dependency.startsWith('@vera-hooks/')) problems.push(`runtime dependency ${dependency}: only hooks are dependencies (DESIGN §3.1)`);
  if (manifest.scripts?.build !== undefined && !texts.rootManifest.includes(`"./${dir}:build"`))
    problems.push(`root package.json's build does not depend on ./${dir}:build`);
  if (!texts.tsconfig.includes(`"${own}"`) || !texts.tsconfig.includes(`./${dir}/src/`)) problems.push(`tsconfig.json paths do not map ${own} to ./${dir}/src`);
  if (!texts.dist.includes(`['${short}',`)) problems.push(`tests/dist.mjs ENTRY has no ['${short}', …] entry`);
  if (!texts.docsImports.includes(`'${own}'`)) problems.push(`tests/docs-imports.test.mjs does not resolve '${own}'`);
  if (typeof files['README.md'] === 'string' && files['README.md'].includes('<!-- recipe -->') && !texts.docsRecipes.includes(`'${own}'`))
    problems.push(`README has a recipe, and tests/docs-recipes.test.mjs PACKAGES does not map '${own}'`);
  if (!texts.sizes.includes(`dist: '${dir}/dist/`)) problems.push(`scripts/size-modules.mjs has no entry for ${dir}/dist`);
  const index = files['src/index.ts'];
  if (typeof index !== 'string') problems.push('no src/index.ts');
  else {
    if (/export\s+(?:\*|\{[^}]*\})\s+from\s+['"]@(?:verajs|vera-components|vera-hooks)\//.test(index))
      problems.push('src/index.ts re-exports another package (R5: components never re-export hooks)');
    if (/customElements\.define\(|\bdefine\(\s*\{/.test(index)) problems.push('src/index.ts registers: an index only re-exports; registration is register.ts');
  }
  if (kind === 'components') {
    const register = files['src/register.ts'];
    if (typeof register !== 'string') problems.push('no src/register.ts');
    else if (!/customElements\.get\(/.test(register)) problems.push('src/register.ts registers without guarding a taken tag (R3)');
  }
  return problems;
};

const read = (file) => readFileSync(ROOT + file, 'utf8');
const texts = Object.fromEntries(Object.entries(REGISTRIES).map(([key, file]) => [key, read(file)]));
const nested = packageDirs().filter((dir) => /^packages\/(?:components|hooks)\/[^/]+$/.test(dir));

/** A package's files the rules read, from the tree. */
const filesOf = (dir) => {
  const files = {};
  for (const file of ['LICENSE', 'README.md', 'src/index.ts', 'src/register.ts'])
    if (existsSync(`${ROOT}${dir}/${file}`)) files[file] = file === 'LICENSE' ? true : read(`${dir}/${file}`);
  return files;
};

for (const dir of nested)
  test(`${dir} is complete and shaped as the design says`, () => {
    assert.deepEqual(problemsOf({ dir, manifest: JSON.parse(read(`${dir}/package.json`)), files: filesOf(dir) }, texts), []);
  });

test('the rules find each missing place (planted, on synthetic packages)', () => {
  const dir = 'packages/components/zz-plant';
  const own = '@vera-components/zz-plant';
  const good = {
    dir,
    manifest: { name: own, version: '0.0.0', private: true, scripts: { build: 'wireit' }, peerDependencies: { '@verajs/core': '^0.4.1' }, dependencies: { '@vera-hooks/listbox': '^0.0.0' } },
    files: { LICENSE: true, 'README.md': '<!-- recipe -->', 'src/index.ts': "export { ZzPlant } from './element.js';", 'src/register.ts': 'customElements.get(tag)' },
  };
  const registered = {
    rootManifest: `"./${dir}:build"`, tsconfig: `"${own}": ["./${dir}/src/index.ts"]`, dist: "['components/zz-plant', 'vera-zz-plant']",
    docsImports: `'${own}'`, docsRecipes: `'${own}'`, sizes: `dist: '${dir}/dist/vera-zz-plant.min.js'`,
  };
  assert.deepEqual(problemsOf(good, registered), [], 'CONTROL: the complete plant passes');
  const withManifest = (change) => ({ ...good, manifest: { ...good.manifest, ...change } });
  const withFiles = (change) => ({ ...good, files: { ...good.files, ...change } });
  const plants = [
    ['a wrong name', withManifest({ name: '@verajs/zz-plant' }), registered],
    ['not private', withManifest({ private: false }), registered],
    ['version 1.x', withManifest({ version: '1.0.0' }), registered],
    ['an open peer', withManifest({ peerDependencies: { '@verajs/core': '>=0.4.1' } }), registered],
    ['a foreign peer', withManifest({ peerDependencies: { react: '^19.0.0' } }), registered],
    ['a non-hook dependency', withManifest({ dependencies: { 'left-pad': '^1.3.0' } }), registered],
    ['no LICENSE', withFiles({ LICENSE: undefined }), registered],
    ['no build edge', good, { ...registered, rootManifest: '' }],
    ['no tsconfig path', good, { ...registered, tsconfig: '' }],
    ['no dist entry', good, { ...registered, dist: '' }],
    ['no docs-imports entry', good, { ...registered, docsImports: '' }],
    ['no recipes entry', good, { ...registered, docsRecipes: '' }],
    ['no size entry', good, { ...registered, sizes: '' }],
    ['an index re-exporting a hook', withFiles({ 'src/index.ts': "export { listbox } from '@vera-hooks/listbox';" }), registered],
    ['an index that registers', withFiles({ 'src/index.ts': "customElements.define('zz-plant', X);" }), registered],
    ['no register.ts', withFiles({ 'src/register.ts': undefined }), registered],
    ['an unguarded register.ts', withFiles({ 'src/register.ts': "customElements.define('zz-plant', X);" }), registered],
  ];
  for (const [what, pkg, regs] of plants) assert.equal(problemsOf(pkg, regs).length, 1, `exactly one problem for ${what}: ${problemsOf(pkg, regs).join('; ')}`);
});

test('the suite reads the tree (CONTROL)', () => {
  for (const [key, text] of Object.entries(texts)) assert.ok(text.length > 100, `${REGISTRIES[key]} read as ${text.length} characters`);
  assert.ok(packageDirs().length >= 15, 'the packages are found');
});
