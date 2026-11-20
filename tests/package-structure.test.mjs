/**
 * **Every component and hook package is complete: present everywhere a package must be, and shaped as the design says.**
 *
 * A package that is missing from one place does not fail loudly: a build edge nobody declared, a recipe nothing runs, a
 * specifier nothing resolves. CLAUDE.md lists six reference forms a RENAME must reach; a NEW package must reach the same
 * places, the other way round. `scripts/new-package.mjs` writes all of them, and this suite holds every package under
 * `packages/components/*` and `packages/hooks/*` to them, plus the design's rules (`DESIGN.md` §2–§3):
 * - scope and name from the directory; private and 0.x until launch; a LICENSE;
 * - closed `^` peers on core, renderer and styles (D7), and for a component on another component (D8); a hook peers on
 *   the framework only; runtime dependencies only on hooks, at closed `^` ranges;
 * - a component's `.` entry (built from `src/register.ts`) is the registering one and its only side effect
 *   (`sideEffects` lists exactly its two builds); its `./element` entry (built from `src/index.ts`) exports the options
 *   and setup with no side effect, so a user can define it under their own tag today (the unregistered CLASS waits for
 *   F1); a hook has no side effect at all (`sideEffects: false`); every entry's three conditions resolve into `dist`,
 *   `files` ships `dist`, a component names its `customElements` manifest;
 * - only `src/register.ts` registers, behind the `customElements.get` guard (R3), through core's `define` (Brian,
 *   2026-11-20), and warns `defined-twice` in development when it stands down; importing any entry except `.`
 *   registers nothing;
 * - no entry re-exports another package's API, directly or in two steps (R5).
 *
 * The rules are one pure function, so the suite proves itself on synthetic packages, each missing exactly one thing
 * (d7's attack, 2026-11-20, added nine): a structure check that finds nothing reports perfect structure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { ROOT, packageDirs } from '../scripts/packages.mjs';

/** The `.mjs` registries a new package must appear in, read as code with comments stripped. */
const REGISTRIES = { dist: 'tests/dist.mjs', docsImports: 'tests/docs-imports.test.mjs', docsRecipes: 'tests/docs-recipes.test.mjs', sizes: 'scripts/size-modules.mjs' };

/** Comments that begin a line, block or line (a glob's slash-star inside a string is not one). */
const code = (text) => text.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '');

const FRAMEWORK_PEER = /^@verajs\/(?:core|renderer|styles)$/;
const COMPONENT_PEER = /^@vera-components\/[a-z0-9-]+$|^@codemirror\/[a-z0-9-]+$/;
const PACKAGE = /['"](@(?:verajs|vera-components|vera-hooks)\/[^'"]+)['"]/;

/**
 * Components that register without core's `define` today, each with its reason; an entry is removed by the change that
 * fixes it.
 */
const REGISTERS_WITHOUT_DEFINE = {
  '@vera-components/select': 'form-associated, and core\'s define gains formAssociated only with F3; moves onto define in its Phase 1 rewrite',
};

/**
 * Every problem with one package, as text.
 *
 * @param {{ dir: string, manifest: Record<string, any>, files: Record<string, string | true> }} pkg
 *   Its directory (`packages/hooks/listbox`), its parsed `package.json`, and a map from a path inside it to its text
 *   (`true` for presence only): `LICENSE`, `README.md` and every `src/**` file.
 * @param {{ build: string[], paths: Record<string, string[]>, dist: string, docsImports: string, docsRecipes: string, sizes: string }} regs
 *   The root manifest's build dependencies, tsconfig's `paths`, and the `.mjs` registries' code.
 * @returns {string[]}
 */
export const problemsOf = ({ dir, manifest, files }, regs) => {
  const problems = [];
  const [, kind, name] = dir.split('/');
  const component = kind === 'components';
  const own = `${component ? '@vera-components' : '@vera-hooks'}/${name}`;
  const short = dir.slice('packages/'.length);
  if (manifest.name !== own) problems.push(`name is ${manifest.name}, not ${own} (the scope and name follow the directory)`);
  if (manifest.private !== true) problems.push('not private: every package stays private until launch');
  if (!/^0\./.test(String(manifest.version))) problems.push(`version ${manifest.version} is not 0.x (1.0.0 is the launch)`);
  if (!files.LICENSE) problems.push('no LICENSE');

  for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (!FRAMEWORK_PEER.test(peer) && !(component && COMPONENT_PEER.test(peer)))
      problems.push(`peer ${peer} is not one a ${component ? 'component' : 'hook'} may have (DESIGN §3.1, D8)`);
    else if (!/^\^\d/.test(range)) problems.push(`peer ${peer} has range ${range}, not a closed ^ range (D7)`);
  }
  for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
    if (!dependency.startsWith('@vera-hooks/')) problems.push(`runtime dependency ${dependency}: only hooks are dependencies (DESIGN §3.1)`);
    else if (!/^\^\d/.test(range)) problems.push(`dependency ${dependency} has range ${range}, not a closed ^ range`);
  }

  /** The entries: three conditions into dist; a component's `.` builds are exactly the side effects, a hook has none. */
  for (const entry of component ? ['.', './element'] : ['.']) {
    const target = manifest.exports?.[entry];
    if (!target || !['types', 'development', 'default'].every((condition) => String(target[condition] ?? '').startsWith('./dist/')))
      problems.push(`exports['${entry}'] does not resolve types, development and default into ./dist`);
  }
  const dot = manifest.exports?.['.'];
  const builds = component && dot && typeof dot === 'object' ? [dot.development, dot.default] : [];
  if (!component && manifest.sideEffects !== false) problems.push(`sideEffects is ${JSON.stringify(manifest.sideEffects)}: a hook registers nothing, so false`);
  if (component && (!Array.isArray(manifest.sideEffects) || JSON.stringify([...manifest.sideEffects].sort()) !== JSON.stringify([...builds].sort())))
    problems.push(`sideEffects is ${JSON.stringify(manifest.sideEffects)}, not exactly the registering entry's two builds ${JSON.stringify(builds)} (false drops the registration in production)`);
  if (!(manifest.files ?? []).includes('dist')) problems.push("files does not ship dist");
  if (component && typeof manifest.customElements !== 'string') problems.push('no customElements manifest named');

  /** The registries, parsed where they are data. */
  if (manifest.scripts?.build !== undefined && !regs.build.includes(`./${dir}:build`)) problems.push(`root package.json's build does not depend on ./${dir}:build`);
  if (!(regs.paths[own] ?? []).some((target) => target.startsWith(`./${dir}/src/`))) problems.push(`tsconfig.json paths do not map ${own} into ./${dir}/src`);
  if (!regs.dist.includes(`['${short}',`)) problems.push(`tests/dist.mjs ENTRY has no ['${short}', …] entry`);
  if (!regs.docsImports.includes(`'${own}'`)) problems.push(`tests/docs-imports.test.mjs does not resolve '${own}'`);
  if (typeof files['README.md'] === 'string' && files['README.md'].includes('<!-- recipe -->') && !regs.docsRecipes.includes(`'${own}'`))
    problems.push(`README has a recipe, and tests/docs-recipes.test.mjs PACKAGES does not map '${own}'`);
  /** The size entries feed the public README's size table, so a package joins them when it is published, not before. */
  if (manifest.private !== true && !regs.sizes.includes(`dist: '${dir}/dist/`)) problems.push(`scripts/size-modules.mjs has no entry for ${dir}/dist`);

  /** Sources: only register.ts registers; nothing re-exports another package. */
  const sources = Object.entries(files).filter(([file, text]) => file.startsWith('src/') && typeof text === 'string');
  if (!sources.some(([file]) => file === 'src/index.ts')) problems.push('no src/index.ts');
  for (const [file, text] of sources) {
    const body = code(text);
    if (file !== 'src/register.ts' && /\bcustomElements\.define\(|(?<![.\w])define\(/.test(body))
      problems.push(`${file} registers: only src/register.ts may (importing the index must define nothing)`);
    if (/export\s+(?:\*|\{[^}]*\})\s+from\s+['"]@(?:verajs|vera-components|vera-hooks)\//.test(body)) problems.push(`${file} re-exports another package (R5)`);
    /** The two-step form: a binding imported from another package, then exported. */
    const foreign = new Set();
    for (const match of body.matchAll(/import\s+\{([^}]*)\}\s+from\s+(['"][^'"]+['"])/g))
      if (PACKAGE.test(match[2])) for (const binding of match[1].split(',')) foreign.add(binding.trim().split(/\s+as\s+/).pop());
    for (const match of body.matchAll(/export\s+\{([^}]*)\}(?!\s*from)/g))
      for (const binding of match[1].split(',')) if (foreign.has(binding.trim().split(/\s+as\s+/)[0])) problems.push(`${file} re-exports ${binding.trim()} from another package in two steps (R5)`);
  }
  if (component) {
    const register = files['src/register.ts'];
    if (typeof register !== 'string') problems.push('no src/register.ts');
    else {
      const body = code(register);
      if (!/customElements\.get\(/.test(body)) problems.push('src/register.ts registers without guarding a taken tag (R3)');
      else if (!/['"]defined-twice['"]/.test(body)) problems.push('src/register.ts stands down silently: development warns defined-twice (R3)');
      const viaDefine = /import\s+\{[^}]*\bdefine\b[^}]*\}\s+from\s+['"]@verajs\/core['"]/.test(body) && /(?<![.\w])define\(/.test(body);
      if (!viaDefine && !(own in REGISTERS_WITHOUT_DEFINE)) problems.push("src/register.ts does not register through core's define (Brian, 2026-11-20)");
    }
  }
  return problems;
};

const read = (file) => readFileSync(ROOT + file, 'utf8');
/** tsconfig.json carries comments; strip whole-line ones before parsing (its strings hold no comment markers). */
const tsconfig = JSON.parse(read('tsconfig.json').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\/\*[\s\S]*?\*\//gm, ''));
const rootManifest = JSON.parse(read('package.json'));
const regs = {
  build: rootManifest.wireit?.build?.dependencies ?? [],
  paths: tsconfig.compilerOptions?.paths ?? {},
  ...Object.fromEntries(Object.entries(REGISTRIES).map(([key, file]) => [key, code(read(file))])),
};
const nested = packageDirs().filter((dir) => /^packages\/(?:components|hooks)\/[^/]+$/.test(dir));

/** A package's files the rules read, from the tree. */
const filesOf = (dir) => {
  const files = {};
  if (existsSync(`${ROOT}${dir}/LICENSE`)) files.LICENSE = true;
  if (existsSync(`${ROOT}${dir}/README.md`)) files['README.md'] = read(`${dir}/README.md`);
  for (const file of globSync('src/**/*.ts', { cwd: `${ROOT}${dir}` })) files[file.split('\\').join('/')] = read(`${dir}/${file}`);
  return files;
};

for (const dir of nested)
  test(`${dir} is complete and shaped as the design says`, () => {
    assert.deepEqual(problemsOf({ dir, manifest: JSON.parse(read(`${dir}/package.json`)), files: filesOf(dir) }, regs), []);
  });

test('the rules find each missing thing (planted, on synthetic packages)', () => {
  const dir = 'packages/components/zz-plant';
  const own = '@vera-components/zz-plant';
  const dev = './dist/development/vera-zz-plant.js';
  const min = './dist/vera-zz-plant.min.js';
  const good = {
    dir,
    manifest: {
      name: own, version: '0.0.0', private: true, scripts: { build: 'wireit' },
      exports: {
        '.': { types: './dist/development/vera-zz-plant.d.ts', development: dev, default: min },
        './element': { types: './dist/development/vera-zz-plant-element.d.ts', development: './dist/development/vera-zz-plant-element.js', default: './dist/vera-zz-plant-element.min.js' },
      },
      sideEffects: [dev, min], files: ['dist', 'custom-elements.json'], customElements: 'custom-elements.json',
      peerDependencies: { '@verajs/core': '^0.4.1' }, dependencies: { '@vera-hooks/listbox': '^0.0.0' },
    },
    files: {
      LICENSE: true, 'README.md': '<!-- recipe -->',
      'src/index.ts': "export { options, setup } from './element.js';",
      'src/element.ts': "import { listbox } from '@vera-hooks/listbox';\nexport const options = { tag: 'vera-zz-plant' };\nexport const setup = () => listbox;",
      'src/register.ts': "import { define } from '@verajs/core';\nimport { options, setup } from './element.js';\nif (!customElements.get(options.tag)) define(options, setup);\nelse if (__DEV__) warn('defined-twice');",
    },
  };
  const registered = {
    build: [`./${dir}:build`], paths: { [own]: [`./${dir}/src/register.ts`] }, dist: "['components/zz-plant', 'vera-zz-plant']",
    docsImports: `'${own}'`, docsRecipes: `'${own}'`, sizes: `dist: '${dir}/dist/vera-zz-plant.min.js'`,
  };
  assert.deepEqual(problemsOf(good, registered), [], 'CONTROL: the complete plant passes');
  const hook = { ...good, dir: 'packages/hooks/zz-plant', manifest: { ...good.manifest, name: '@vera-hooks/zz-plant', customElements: undefined, sideEffects: false, exports: { '.': good.manifest.exports['.'] } }, files: { LICENSE: true, 'src/index.ts': 'export const zz = 1;' } };
  const hookRegs = { ...registered, build: ['./packages/hooks/zz-plant:build'], paths: { '@vera-hooks/zz-plant': ['./packages/hooks/zz-plant/src/index.ts'] }, dist: "['hooks/zz-plant', 'vera-zz-plant']", docsImports: "'@vera-hooks/zz-plant'" };
  assert.deepEqual(problemsOf(hook, hookRegs), [], 'CONTROL: the complete hook passes');
  const withManifest = (change) => ({ ...good, manifest: { ...good.manifest, ...change } });
  const withFiles = (change) => ({ ...good, files: { ...good.files, ...change } });
  const plants = [
    ['a wrong name', withManifest({ name: '@verajs/zz-plant' }), registered],
    ['not private', withManifest({ private: false }), registered],
    ['version 1.x', withManifest({ version: '1.0.0' }), registered],
    ['an open peer', withManifest({ peerDependencies: { '@verajs/core': '>=0.4.1' } }), registered],
    ['a foreign peer', withManifest({ peerDependencies: { react: '^19.0.0' } }), registered],
    ['a hook peering on a component', { ...hook, manifest: { ...hook.manifest, peerDependencies: { '@vera-components/button': '^0.1.0' } } }, hookRegs],
    ['a non-hook dependency', withManifest({ dependencies: { 'left-pad': '^1.3.0' } }), registered],
    ['an open dependency range', withManifest({ dependencies: { '@vera-hooks/listbox': '*' } }), registered],
    ['no LICENSE', withFiles({ LICENSE: undefined }), registered],
    ['exports outside dist', withManifest({ exports: { ...good.manifest.exports, '.': { types: './src/index.ts', development: dev, default: min } } }), registered],
    ['no ./element entry', withManifest({ exports: { '.': good.manifest.exports['.'] } }), registered],
    ['a hook with side effects', { ...hook, manifest: { ...hook.manifest, sideEffects: ['./dist/x.js'] } }, hookRegs],
    ['a silent stand-down', withFiles({ 'src/register.ts': "import { define } from '@verajs/core';\nif (!customElements.get('vera-zz-plant')) define(options, setup);" }), registered],
    ['sideEffects false', withManifest({ sideEffects: false }), registered],
    ['sideEffects missing a build', withManifest({ sideEffects: [min] }), registered],
    ['files without dist', withManifest({ files: ['src'] }), registered],
    ['no customElements', withManifest({ customElements: undefined }), registered],
    ['no build edge', good, { ...registered, build: [] }],
    ['a tsconfig path into another dir', good, { ...registered, paths: { [own]: ['./packages/components/other/src/index.ts'] } }],
    ['no dist entry', good, { ...registered, dist: '' }],
    ['no docs-imports entry', good, { ...registered, docsImports: '' }],
    ['no recipes entry', good, { ...registered, docsRecipes: '' }],
    ['no size entry, once published', withManifest({ private: false }), { ...registered, sizes: '' }, 2],
    ['an index re-exporting a hook', withFiles({ 'src/index.ts': "export { listbox } from '@vera-hooks/listbox';" }), registered],
    ['a two-step re-export', withFiles({ 'src/index.ts': "import { listbox } from '@vera-hooks/listbox';\nexport { listbox };" }), registered],
    ['an index that registers', withFiles({ 'src/index.ts': "customElements.define('zz-plant', X);" }), registered],
    ['an element that calls define', withFiles({ 'src/element.ts': "import { define } from '@verajs/core';\nexport const Plant = define({ tag: 'vera-zz-plant' }, () => {});" }), registered],
    ['no register.ts', withFiles({ 'src/register.ts': undefined }), registered],
    ['an unguarded register.ts', withFiles({ 'src/register.ts': "import { define } from '@verajs/core';\ndefine(options, setup);" }), registered],
    ['a register.ts on customElements.define', withFiles({ 'src/register.ts': "if (!customElements.get('vera-zz-plant')) customElements.define('vera-zz-plant', X);\nelse warn('defined-twice');" }), registered],
  ];
  /** Each plant trips exactly one rule; "once published" also trips the private rule, so two. */
  for (const [what, pkg, r, expected = 1] of plants) {
    const found = problemsOf(pkg, r);
    assert.equal(found.length, expected, `${what}: ${found.join('; ')}`);
  }
  /** A registry entry left in a comment is not an entry. */
  assert.ok(!code("// ['components/zz-plant', 'vera-zz-plant'],").includes("['components/zz-plant',"), 'a commented-out entry is stripped');
});

test('the suite reads the tree (CONTROL)', () => {
  assert.ok(regs.build.length >= 10, `the root build lists ${regs.build.length} packages`);
  assert.ok(Object.keys(regs.paths).length >= 10, `tsconfig maps ${Object.keys(regs.paths).length} specifiers`);
  for (const key of Object.keys(REGISTRIES)) assert.ok(regs[key].length > 100, `${REGISTRIES[key]} read as ${regs[key].length} characters`);
});
