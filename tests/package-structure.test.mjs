/**
 * **Every component and hook package is complete: present everywhere a package must be, and shaped as the design says.**
 *
 * A package that is missing from one place does not fail loudly: a build edge nobody declared, a recipe nothing runs, a
 * specifier nothing resolves. CLAUDE.md lists six reference forms a RENAME must reach; a NEW package must reach the same
 * places, the other way round. `scripts/new-package.mjs` writes all of them, and this suite holds every package under
 * `packages/components/*` and `packages/hooks/*` to them, plus the design's rules (`DESIGN.md` §2–§3):
 * - scope and name from the directory; private and 0.x until launch; a LICENSE;
 * - closed `^` peers on core, renderer and styles (D7), and for a component on another component (D8); a hook peers on
 *   the framework only; runtime dependencies only on hooks, at closed `^` ranges; and the peers and dependencies are
 *   exactly what `src/` imports, both ways (the inlined `shared-*` aside);
 * - its own suite, `tests/<name>-package.test.mjs` (a hook's: `tests/hook-<name>-package.test.mjs`), and for a
 *   component a README `<!-- recipe -->`; a component renders no `<slot>` (light DOM, where one does nothing);
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
import { existsSync, globSync, readdirSync, readFileSync } from 'node:fs';
import { ROOT, packageDirs } from '../scripts/packages.mjs';
import { posix } from '../scripts/fs-path.mjs';

/** The `.mjs` registries a new package must appear in, read as code with comments stripped. */
const REGISTRIES = { dist: 'tests/dist.mjs', docsImports: 'tests/docs-imports.test.mjs', docsRecipes: 'tests/docs-recipes.test.mjs', sizes: 'scripts/size-modules.mjs' };

/** Comments that begin a line, block or line (a glob's slash-star inside a string is not one). */
const code = (text) => text.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '');

const FRAMEWORK_PEER = /^@verajs\/(?:core|renderer|styles)$/;
const COMPONENT_PEER = /^@vera-components\/[a-z0-9-]+$|^@codemirror\/[a-z0-9-]+$/;
const PACKAGE = /['"](@(?:verajs|vera-components|vera-hooks)\/[^'"]+)['"]/;

const CONTROL_FLOW = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);

/**
 * The module with every function body removed: a brace block opened right after `=>`, or after `name(…)` where `name`
 * is not a control-flow keyword (a function, a method, `function name(…)`), and a one-line arrow's expression body.
 * What is left runs at import (d7's sturdier rule, 2026-11-20: an indented `define(` inside a top-level `if` block is
 * still import-time).
 */
const withoutFunctionBodies = (text) => {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      const head = out.trimEnd();
      let opensFunction = head.endsWith('=>');
      if (!opensFunction && head.endsWith(')')) {
        let depth = 0, j = head.length - 1;
        for (; j >= 0; j--) { if (head[j] === ')') depth++; else if (head[j] === '(' && --depth === 0) break; }
        const name = /([A-Za-z_$][\w$]*)\s*$/.exec(head.slice(0, j))?.[1];
        opensFunction = name !== undefined && !CONTROL_FLOW.has(name);
      }
      if (opensFunction) {
        let depth = 0;
        for (; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}' && --depth === 0) break; }
        out += '{}';
        continue;
      }
    }
    out += ch;
  }
  /** A one-line arrow's expression body (`(tag) => define(…)`) runs when called, not at import. */
  return out.replace(/=>\s*(?!\{)[^;\n]*/g, '=> 0');
};

/** Whether a module registers when it is IMPORTED: a `define(` or `customElements.define(` outside every function body. */
const registersAtImport = (body) => /\bcustomElements\.define\(|(?<![.\w])define\(/.test(withoutFunctionBodies(body));

/**
 * **The one exemption mechanism, and it expires itself** (d7, 2026-11-21). Select moved into this layout in Phase 0
 * with its code unchanged (a pure move, proven by its suites passing unchanged), so it breaks the rules its Phase 1
 * rewrite exists to meet. Each row names a rule by its stable code, the reason, and the rewrite step that removes it;
 * the suite asserts every exempted rule STILL fires, so the day a step fixes one, the gate is red until its row goes.
 * The table reads as the rewrite's to-do list.
 */
const UNTIL_REWRITE = {
  '@vera-components/select': {
    'registers-without-define': "form-associated, and core's define gains formAssociated only with F3 — Phase 1: select moves onto define",
    'no-element-entry': 'it ships ./elements (the VeraSelect class) — Phase 1: ./element with defineAs replaces it',
    'side-effects': 'sideEffects lists ./src/index.ts, and . is built from index.ts (which imports register.ts) — Phase 1: . from register.ts',
    slot: 'shadow DOM by default, so it renders <slot>s — Phase 1: the light-only rewrite',
    'r5-reexport': "elements.ts re-exports listbox's SelectOption type — Phase 1: select declares its own option type",
    'no-package-suite': 'the generated suite assumes defineAs and ./element, which select does not have yet; its select-* suites hold it meanwhile — Phase 1: the package suite',
  },
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
  /** Each problem carries its rule's stable code first (`[slot] …`), which an exemption names (d7, 2026-11-21). */
  const say = (code, message) => problems.push(`[${code}] ${message}`);
  const [, kind, name] = dir.split('/');
  const component = kind === 'components';
  const own = `${component ? '@vera-components' : '@vera-hooks'}/${name}`;
  const short = dir.slice('packages/'.length);
  if (manifest.name !== own) say('name', `name is ${manifest.name}, not ${own} (the scope and name follow the directory)`);
  if (manifest.private !== true) say('private', 'not private: every package stays private until launch');
  if (!/^0\./.test(String(manifest.version))) say('version', `version ${manifest.version} is not 0.x (1.0.0 is the launch)`);
  /**
   * **0.0.x is an exact pin** (d7, 2026-11-21): a caret on 0.0.x allows only that patch (`^0.0.0` is `>=0.0.0 <0.0.1`), so
   * every patch of a hook would force a bump of everything depending on it, the cascade D7 and D8 exist to prevent.
   * Packages are born at 0.1.0, where `^0.1.0` takes every patch and only a minor (the breaking boundary) cascades.
   */
  else if (/^0\.0\./.test(String(manifest.version))) say('version-pinned', `version ${manifest.version} is 0.0.x, where every caret range is an exact pin: start at 0.1.0`);
  if (!files.LICENSE) say('license', 'no LICENSE');

  for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (!FRAMEWORK_PEER.test(peer) && !(component && COMPONENT_PEER.test(peer)))
      say('peer-kind', `peer ${peer} is not one a ${component ? 'component' : 'hook'} may have (DESIGN §3.1, D8)`);
    else if (!/^\^\d/.test(range)) say('peer-range', `peer ${peer} has range ${range}, not a closed ^ range (D7)`);
    else if (/^\^0\.0\./.test(range)) say('range-pinned', `peer ${peer} has range ${range}: a caret on 0.0.x is an exact pin`);
  }
  for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
    if (!dependency.startsWith('@vera-hooks/')) say('dependency-kind', `runtime dependency ${dependency}: only hooks are dependencies (DESIGN §3.1)`);
    else if (!/^\^\d/.test(range)) say('dependency-range', `dependency ${dependency} has range ${range}, not a closed ^ range`);
    else if (/^\^0\.0\./.test(range)) say('range-pinned', `dependency ${dependency} has range ${range}: a caret on 0.0.x is an exact pin`);
  }

  /** The entries: three conditions into dist; a component's `.` builds are exactly the side effects, a hook has none. */
  for (const entry of component ? ['.', './element'] : ['.']) {
    const target = manifest.exports?.[entry];
    if (!target || !['types', 'development', 'default'].every((condition) => String(target[condition] ?? '').startsWith('./dist/')))
      say(entry === './element' ? 'no-element-entry' : 'exports', `exports['${entry}'] does not resolve types, development and default into ./dist`);
  }
  const dot = manifest.exports?.['.'];
  const builds = component && dot && typeof dot === 'object' ? [dot.development, dot.default] : [];
  if (!component && manifest.sideEffects !== false) say('side-effects', `sideEffects is ${JSON.stringify(manifest.sideEffects)}: a hook registers nothing, so false`);
  if (component && (!Array.isArray(manifest.sideEffects) || JSON.stringify([...manifest.sideEffects].sort()) !== JSON.stringify([...builds].sort())))
    say('side-effects', `sideEffects is ${JSON.stringify(manifest.sideEffects)}, not exactly the registering entry's two builds ${JSON.stringify(builds)} (false drops the registration in production)`);
  if (!(manifest.files ?? []).includes('dist')) say('files', "files does not ship dist");
  if (component && typeof manifest.customElements !== 'string') say('custom-elements', 'no customElements manifest named');
  /** A manifest is generated from the surfaces (`scripts/generate-cem.mjs`), so naming one with no surface declares a file nothing writes. */
  if (typeof manifest.customElements === 'string' && !Object.keys(files).some((file) => typeof files[file] === 'string' && /^src\/(?:.+\/)?surface\.ts$/.test(file)))
    say('no-surface', `customElements names ${manifest.customElements}, but no src/**/surface.ts declares a surface for scripts/generate-cem.mjs to generate it from`);

  /** The registries, parsed where they are data. */
  if (manifest.scripts?.build !== undefined && !regs.build.includes(`./${dir}:build`)) say('build-edge', `root package.json's build does not depend on ./${dir}:build`);
  if (!(regs.paths[own] ?? []).some((target) => target.startsWith(`./${dir}/src/`))) say('tsconfig-path', `tsconfig.json paths do not map ${own} into ./${dir}/src`);
  if (!regs.dist.includes(`['${short}',`)) say('dist-entry', `tests/dist.mjs ENTRY has no ['${short}', …] entry`);
  if (!regs.docsImports.includes(`'${own}'`)) say('docs-imports', `tests/docs-imports.test.mjs does not resolve '${own}'`);
  if (typeof files['README.md'] === 'string' && files['README.md'].includes('<!-- recipe -->') && !regs.docsRecipes.includes(`'${own}'`))
    say('docs-recipes', `README has a recipe, and tests/docs-recipes.test.mjs PACKAGES does not map '${own}'`);
  /** The size entries feed the public README's size table, so a package joins them when it is published, not before. */
  if (manifest.private !== true && !regs.sizes.includes(`dist: '${dir}/dist/`)) say('size-entry', `scripts/size-modules.mjs has no entry for ${dir}/dist`);

  /** Sources: only register.ts registers; nothing re-exports another package. */
  const sources = Object.entries(files).filter(([file, text]) => file.startsWith('src/') && typeof text === 'string');
  if (!sources.some(([file]) => file === 'src/index.ts')) say('no-index', 'no src/index.ts');
  for (const [file, text] of sources) {
    const body = code(text);
    if (file !== 'src/register.ts' && registersAtImport(body))
      say('registers-at-import', `${file} registers at import: only src/register.ts may (a define inside an exported function, like defineAs, runs only when called)`);
    /**
     * Types are API too: `export type { X } from` and `export type * from` are re-exports (the type-only form went
     * unseen until select's exemption, which expects this rule to fire, said it did not; 2026-11-21).
     */
    if (/export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]@(?:verajs|vera-components|vera-hooks)\//.test(body)) say('r5-reexport', `${file} re-exports another package (R5)`);
    /** The two-step form: a binding imported from another package, then exported (a `type` modifier changes nothing). */
    const bare = (binding) => binding.trim().replace(/^type\s+/, '');
    const foreign = new Set();
    for (const match of body.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+(['"][^'"]+['"])/g))
      if (PACKAGE.test(match[2])) for (const binding of match[1].split(',')) foreign.add(bare(binding).split(/\s+as\s+/).pop());
    for (const match of body.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}(?!\s*from)/g))
      for (const binding of match[1].split(',')) if (foreign.has(bare(binding).split(/\s+as\s+/)[0])) say('r5-reexport', `${file} re-exports ${binding.trim()} from another package in two steps (R5)`);
  }
  /**
   * **Peers and dependencies are exactly what `src/` imports, both ways** (d7, 2026-11-20): a peer nothing imports makes
   * every app install it, and an import with no peer resolves by luck. The private workspace packages (shared-*) are
   * inlined, so they are neither.
   */
  const imported = new Set();
  for (const [, text] of sources)
    for (const match of code(text).matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"](@(?:verajs|vera-components|vera-hooks|codemirror)\/[a-z0-9-]+)/g))
      if (!/^@verajs\/shared-/.test(match[1])) imported.add(match[1]);
  const peers = Object.keys(manifest.peerDependencies ?? {});
  const dependencies = Object.keys(manifest.dependencies ?? {});
  for (const peer of peers)
    if ((FRAMEWORK_PEER.test(peer) || (component && COMPONENT_PEER.test(peer))) && !imported.has(peer)) say('unimported-peer', `peer ${peer} is not imported by src/`);
  for (const dependency of dependencies)
    if (dependency.startsWith('@vera-hooks/') && !imported.has(dependency)) say('unimported-dependency', `dependency ${dependency} is not imported by src/`);
  for (const specifier of imported)
    if (!peers.includes(specifier) && !dependencies.includes(specifier)) say('undeclared-import', `src/ imports ${specifier}, which is neither a peer nor a dependency`);

  /** Its own suite, and for a component the README recipe the docs suite runs (d7, 2026-11-20). */
  const suite = `${component ? '' : 'hook-'}${name}-package.test.mjs`;
  if (!regs.tests.includes(suite)) say('no-package-suite', `no tests/${suite}`);
  if (component && !(typeof files['README.md'] === 'string' && files['README.md'].includes('<!-- recipe -->'))) say('no-recipe', 'README has no recipe');

  if (component) {
    /** Light DOM: a `<slot>` does nothing without a shadow root, so a component that renders one teaches the wrong thing. */
    for (const [file, text] of sources) if (/<slot\b/.test(code(text))) say('slot', `${file} renders a <slot>: components render in light DOM`);
    const register = files['src/register.ts'];
    if (typeof register !== 'string') say('no-register', 'no src/register.ts');
    else {
      const body = code(register);
      if (!/customElements\.get\(/.test(body)) say('r3-guard', 'src/register.ts registers without guarding a taken tag (R3)');
      else if (!/['"]defined-twice['"]/.test(body)) say('r3-silent', 'src/register.ts stands down silently: development warns defined-twice (R3)');
      const viaDefine = /import\s+\{[^}]*\bdefine\b[^}]*\}\s+from\s+['"]@verajs\/core['"]/.test(body) && /(?<![.\w])define\(/.test(body);
      if (!viaDefine) say('registers-without-define', "src/register.ts does not register through core's define (Brian, 2026-11-20)");
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
  tests: readdirSync(ROOT + 'tests'),
  ...Object.fromEntries(Object.entries(REGISTRIES).map(([key, file]) => [key, code(read(file))])),
};
const nested = packageDirs().filter((dir) => /^packages\/(?:components|hooks)\/[^/]+$/.test(dir));

/** A package's files the rules read, from the tree. */
const filesOf = (dir) => {
  const files = {};
  if (existsSync(`${ROOT}${dir}/LICENSE`)) files.LICENSE = true;
  if (existsSync(`${ROOT}${dir}/README.md`)) files['README.md'] = read(`${dir}/README.md`);
  for (const file of globSync('src/**/*.ts', { cwd: `${ROOT}${dir}` })) files[posix(file)] = read(`${dir}/${file}`);
  return files;
};

/** The code a problem leads with. */
const codeOf = (problem) => /^\[([a-z0-9-]+)\]/.exec(problem)?.[1];

for (const dir of nested)
  test(`${dir} is complete and shaped as the design says`, () => {
    const manifest = JSON.parse(read(`${dir}/package.json`));
    const exempt = UNTIL_REWRITE[manifest.name] ?? {};
    const problems = problemsOf({ dir, manifest, files: filesOf(dir) }, regs);
    assert.deepEqual(problems.filter((problem) => !(codeOf(problem) in exempt)), []);
    /** An exemption whose rule no longer fires has outlived its reason: delete its row. */
    const fired = new Set(problems.map(codeOf));
    assert.deepEqual(Object.keys(exempt).filter((code) => !fired.has(code)), [], `${manifest.name}: these rules pass now, so their UNTIL_REWRITE rows go`);
  });

test('every UNTIL_REWRITE row names a package that exists and a code a rule uses (CONTROL)', () => {
  const names = new Set(nested.map((dir) => JSON.parse(read(`${dir}/package.json`)).name));
  const source = read('tests/package-structure.test.mjs');
  for (const [name, rows] of Object.entries(UNTIL_REWRITE)) {
    assert.ok(names.has(name), `${name} is not a package`);
    for (const code of Object.keys(rows)) assert.ok(source.includes(`say('${code}'`) || source.includes(`'${code}' :`) || source.includes(`? '${code}'`), `${code} is no rule's code`);
  }
});

test('the rules find each missing thing (planted, on synthetic packages)', () => {
  const dir = 'packages/components/zz-plant';
  const own = '@vera-components/zz-plant';
  const dev = './dist/development/vera-zz-plant.js';
  const min = './dist/vera-zz-plant.min.js';
  const good = {
    dir,
    manifest: {
      name: own, version: '0.1.0', private: true, scripts: { build: 'wireit' },
      exports: {
        '.': { types: './dist/development/vera-zz-plant.d.ts', development: dev, default: min },
        './element': { types: './dist/development/vera-zz-plant-element.d.ts', development: './dist/development/vera-zz-plant-element.js', default: './dist/vera-zz-plant-element.min.js' },
      },
      sideEffects: [dev, min], files: ['dist', 'custom-elements.json'], customElements: 'custom-elements.json',
      peerDependencies: { '@verajs/core': '^0.4.1' }, dependencies: { '@vera-hooks/listbox': '^0.1.0' },
    },
    files: {
      LICENSE: true, 'README.md': '<!-- recipe -->',
      'src/index.ts': "import { define } from '@verajs/core';\nimport { options, setup } from './element.js';\nexport const defineAs = (tag) => define({ ...options, tag }, setup);",
      'src/element.ts': "import { listbox } from '@vera-hooks/listbox';\nexport const options = { tag: 'vera-zz-plant' };\nexport const setup = () => listbox;",
      'src/register.ts': "import { define } from '@verajs/core';\nimport { options, setup } from './element.js';\nif (!customElements.get(options.tag)) define(options, setup);\nelse if (__DEV__) warn('defined-twice');",
      'src/zz-plant/surface.ts': "export const zzPlantSurface = { tag: 'vera-zz-plant', description: 'A plant.' } as const;",
    },
  };
  const registered = {
    build: [`./${dir}:build`], paths: { [own]: [`./${dir}/src/register.ts`] }, dist: "['components/zz-plant', 'vera-zz-plant']",
    docsImports: `'${own}'`, docsRecipes: `'${own}'`, sizes: `dist: '${dir}/dist/vera-zz-plant.min.js'`,
    tests: ['zz-plant-package.test.mjs', 'hook-zz-plant-package.test.mjs'],
  };
  assert.deepEqual(problemsOf(good, registered), [], 'CONTROL: the complete plant passes');
  const hook = { ...good, dir: 'packages/hooks/zz-plant', manifest: { ...good.manifest, name: '@vera-hooks/zz-plant', customElements: undefined, peerDependencies: undefined, dependencies: undefined, sideEffects: false, exports: { '.': good.manifest.exports['.'] } }, files: { LICENSE: true, 'src/index.ts': 'export const zz = 1;' } };
  const hookRegs = { ...registered, build: ['./packages/hooks/zz-plant:build'], paths: { '@vera-hooks/zz-plant': ['./packages/hooks/zz-plant/src/index.ts'] }, dist: "['hooks/zz-plant', 'vera-zz-plant']", docsImports: "'@vera-hooks/zz-plant'" };
  assert.deepEqual(problemsOf(hook, hookRegs), [], 'CONTROL: the complete hook passes');
  const withManifest = (change) => ({ ...good, manifest: { ...good.manifest, ...change } });
  const withFiles = (change) => ({ ...good, files: { ...good.files, ...change } });
  const plants = [
    ['a wrong name', withManifest({ name: '@verajs/zz-plant' }), registered],
    ['not private', withManifest({ private: false }), registered],
    ['version 1.x', withManifest({ version: '1.0.0' }), registered],
    /** The 0.0.x pin (d7, 2026-11-21). */
    ['a 0.0.x version', withManifest({ version: '0.0.0' }), registered],
    ['a caret dependency on 0.0.x', withManifest({ dependencies: { '@vera-hooks/listbox': '^0.0.3' } }), registered],
    ['a caret peer on 0.0.x', withManifest({ peerDependencies: { '@verajs/core': '^0.0.9' } }), registered],
    ['an open peer', withManifest({ peerDependencies: { '@verajs/core': '>=0.4.1' } }), registered],
    ['a foreign peer', withManifest({ peerDependencies: { '@verajs/core': '^0.4.1', react: '^19.0.0' } }), registered],
    ['a hook peering on a component', { ...hook, manifest: { ...hook.manifest, peerDependencies: { '@vera-components/button': '^0.1.0' } } }, hookRegs],
    ['a non-hook dependency', withManifest({ dependencies: { '@vera-hooks/listbox': '^0.1.0', 'left-pad': '^1.3.0' } }), registered],
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
    ['a customElements manifest with no surface to generate it from', withFiles({ 'src/zz-plant/surface.ts': undefined }), registered],
    ['no build edge', good, { ...registered, build: [] }],
    ['a tsconfig path into another dir', good, { ...registered, paths: { [own]: ['./packages/components/other/src/index.ts'] } }],
    ['no dist entry', good, { ...registered, dist: '' }],
    ['no docs-imports entry', good, { ...registered, docsImports: '' }],
    ['no recipes entry', good, { ...registered, docsRecipes: '' }],
    ['no size entry, once published', withManifest({ private: false }), { ...registered, sizes: '' }, 2],
    /** The type-only forms (select's own shape, 2026-11-21). */
    ['a type re-export', withFiles({ 'src/index.ts': "export type { SelectOption } from '@vera-hooks/listbox';" }), registered],
    ['a type-star re-export', withFiles({ 'src/index.ts': "export type * from '@vera-hooks/listbox';" }), registered],
    ['a two-step type re-export', withFiles({ 'src/index.ts': "import type { SelectOption } from '@vera-hooks/listbox';\nexport type { SelectOption };" }), registered],
    ['a two-step re-export through an inline type modifier', withFiles({ 'src/index.ts': "import { type SelectOption } from '@vera-hooks/listbox';\nexport { type SelectOption };" }), registered],
    ['an index re-exporting a hook',withFiles({ 'src/index.ts': "export { listbox } from '@vera-hooks/listbox';" }), registered],
    ['a two-step re-export', withFiles({ 'src/index.ts': "import { listbox } from '@vera-hooks/listbox';\nexport { listbox };" }), registered],
    ['an index that registers', withFiles({ 'src/index.ts': "customElements.define('zz-plant', X);" }), registered],
    ['an index that defines at import', withFiles({ 'src/index.ts': "import { define } from '@verajs/core';\nexport const Plant = define({ tag: 'vera-zz-plant' }, () => () => null);" }), registered],
    /** register.ts's own shape copied into an index, and two more top-level forms (d7). */
    ['an index with a guarded top-level define', withFiles({ 'src/index.ts': "if (!customElements.get(t)) define(options, setup);" }), registered],
    ['an index with x && define', withFiles({ 'src/index.ts': "ready && define(options, setup);" }), registered],
    ['an index with void define', withFiles({ 'src/index.ts': "void define(options, setup);" }), registered],
    ['an index with define indented in a top-level if block', withFiles({ 'src/index.ts': "if (!customElements.get(t)) {\n  define(options, setup);\n}" }), registered],
    /** And the shapes that define only when CALLED pass: a function block, and a method. */
    ['a define inside a function block', withFiles({ 'src/index.ts': "export function defineAs(tag) {\n  if (tag) {\n    return define({ ...options, tag }, setup);\n  }\n}" }), registered, 0],
    ['a define inside a method', withFiles({ 'src/index.ts': "export const api = {\n  defineAs(tag) { return define({ ...options, tag }, setup); },\n};" }), registered, 0],
    ['an element that calls define', withFiles({ 'src/element.ts': "import { define } from '@verajs/core';\nimport { listbox } from '@vera-hooks/listbox';\nexport const Plant = define({ tag: 'vera-zz-plant' }, listbox);" }), registered],
    ['no register.ts', withFiles({ 'src/register.ts': undefined }), registered],
    ['an unguarded register.ts', withFiles({ 'src/register.ts': "import { define } from '@verajs/core';\ndefine(options, setup);" }), registered],
    ['a register.ts on customElements.define', withFiles({ 'src/register.ts': "if (!customElements.get('vera-zz-plant')) customElements.define('vera-zz-plant', X);\nelse warn('defined-twice');" }), registered],
    /** d7's attack on the scaffold (2026-11-20). */
    ['a <slot> in the element', withFiles({ 'src/element.ts': "import { listbox } from '@vera-hooks/listbox';\nexport const setup = () => () => html`<slot></slot>`;" }), registered],
    ['a peer src/ never imports', withManifest({ peerDependencies: { '@verajs/core': '^0.4.1', '@verajs/styles': '^0.4.0' } }), registered],
    ['an import with no peer', withFiles({ 'src/element.ts': "import { listbox } from '@vera-hooks/listbox';\nimport { css } from '@verajs/styles';\nexport const setup = () => listbox;" }), registered],
    ['a type-only import with no peer', withFiles({ 'src/element.ts': "import { listbox } from '@vera-hooks/listbox';\nimport type { Css } from '@verajs/styles';\nexport const setup = () => listbox;" }), registered],
    ['a hook import with no dependency', withManifest({ dependencies: undefined }), registered],
    ['a dependency src/ never imports', withManifest({ dependencies: { '@vera-hooks/listbox': '^0.1.0', '@vera-hooks/anchor': '^0.1.0' } }), registered],
    ['a hook with a peer it never imports', { ...hook, manifest: { ...hook.manifest, peerDependencies: { '@verajs/core': '^0.4.1' } } }, hookRegs],
    ['no suite', good, { ...registered, tests: ['hook-zz-plant-package.test.mjs'] }],
    ['a hook with no suite', hook, { ...hookRegs, tests: ['zz-plant-package.test.mjs'] }],
    ['a component with no recipe', withFiles({ 'README.md': '# no recipe here' }), { ...registered }],
    /** What the import rule must NOT count: shared-* is inlined, and a comment is not an import. */
    ['a shared-utils import', withFiles({ 'src/diagnostics.ts': "import { diagnostic } from '@verajs/shared-utils';" }), registered, 0],
    ['an import inside a comment', withFiles({ 'src/diagnostics.ts': "// import { css } from '@verajs/styles';" }), registered, 0],
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
