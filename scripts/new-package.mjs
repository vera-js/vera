/**
 * **A new component or hook package, complete: its files and every place a package must appear.**
 *
 *   node scripts/new-package.mjs component <name> "<description>"  → packages/components/<name>, @vera-components/<name>, <vera-<name>>
 *   node scripts/new-package.mjs hook <name>                       → packages/hooks/<name>, @vera-hooks/<name>
 *
 * It writes the anatomy `DESIGN.md` §2.5 describes and registers the package in the root build, `tsconfig.json`'s
 * paths, `tests/dist.mjs`, the docs-imports and recipes maps and the diagnostics tables. A component also gets its
 * declared surface, `src/<name>/surface.ts` (`as const satisfies ComponentSurface` from `@verajs/shared-types`: its tag,
 * the description given, and its one part, `root`), and the `custom-elements.json` `scripts/generate-cem.mjs` writes
 * from it. `tests/package-structure.test.mjs` holds every package to that shape, so a package this script writes passes
 * it on the day it is made. The registries are edited at fixed anchor lines, and the script refuses when an anchor is
 * missing rather than guess. Then run
 * `npm install` (a new workspace needs its links; check `find node_modules -maxdepth 2 -type l` first, CLAUDE.md).
 *
 * A component registers through core's `define` (Brian, 2026-11-20): `src/element.ts` holds the options and the setup
 * and never calls `define`; `src/register.ts` is the `.` entry, leaves a tag another copy holds to that copy and warns
 * `defined-twice` in development; `src/index.ts` is the `./element` entry, `defineAs(tag)`, with no side effect at
 * import.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './packages.mjs';

/**
 * **A package's own files, as text: pure.** It reads and writes nothing, so a test can hold what the script would write
 * without writing it (`tests/new-package-output.test.mjs`); the command below writes the files and registers the
 * package.
 *
 * @param {'component' | 'hook'} kind What to make
 * @param {string} name Lowercase, digits and hyphens
 * @param {string} coreVersion `@verajs/core`'s version, for a component's peer range
 * @param {string} [description] A component's: what it is, in one paragraph (its surface's, its manifest's, its
 *   package.json's); a hook takes none
 * @return The package's directory, name, tag, suite path, `.` entry source, and every file it writes, keyed by path
 *   from the repository root
 */
export const scaffold = (kind, name, coreVersion, description) => {
  if (!['component', 'hook'].includes(kind) || !/^[a-z][a-z0-9-]*$/.test(name ?? ''))
    throw new Error('usage: node scripts/new-package.mjs <component|hook> <name> ["<description>"]   (name: lowercase, digits, hyphens)');
  const component = kind === 'component';
  /** A component's description is its surface's, and the manifest refuses an empty one, so it is asked for at birth. */
  if (component && !(typeof description === 'string' && description.trim() !== ''))
    throw new Error('a component needs its description: node scripts/new-package.mjs component <name> "<what it is, in one paragraph>"');
  const dir = `packages/${component ? 'components' : 'hooks'}/${name}`;
  const short = dir.slice('packages/'.length);
  const own = `${component ? '@vera-components' : '@vera-hooks'}/${name}`;
  const filename = `vera-${name}`;
  const tag = `vera-${name}`;
  /** A hook's suite is `tests/hook-<name>-package.test.mjs`, so a component named `hook-…` would collide with it. */
  if (component && name.startsWith('hook-')) throw new Error('a component name never starts with hook- (that prefix names hook suites in tests/)');

  /**
   * **The peers are exactly the framework packages `src/` imports** (package-structure holds both directions): the component template imports core and nothing else, and a hook imports nothing yet. A package that
   * later imports the renderer or styles adds the peer in the same change.
   */
  const peers = component ? { '@verajs/core': `^${coreVersion}` } : {};
  const external = Object.keys(peers);

  /** One build entry's three conditions. */
  const entry = (file) => ({ types: `./dist/development/${file}.d.ts`, development: `./dist/development/${file}.js`, default: `./dist/${file}.min.js` });
  const files = ['src/**/*{.js,.ts}', '../../shared-types/src/**/*{.js,.ts}', '../../shared-utils/src/**/*{.js,.ts}', 'tsconfig.json', '../../../tsconfig.json', 'rollup.config.js', '../../../defaultRollupConfig.js'];
  const step = (mode, output, extra = {}) => ({ command: 'npx rollup -c', ...(mode === 'types' ? {} : { clean: 'if-file-deleted' }), env: { MODE: mode }, files, output, ...extra });

  const exports = component ? { '.': entry(filename), './element': entry(`${filename}-element`) } : { '.': entry(filename) };
  const manifest = {
    name: own,
    version: '0.1.0',
    private: true,
    description: component ? description.trim() : `${name}: a headless Vera hook.`,
    license: 'MIT',
    engines: { node: '>=20' },
    repository: { type: 'git', url: 'git+https://github.com/vera-js/vera.git', directory: dir },
    author: 'Brian Grider <hello@verajs.com>',
    homepage: 'https://verajs.dev',
    type: 'module',
    main: exports['.'].default,
    types: exports['.'].types,
    exports,
    sideEffects: component ? [exports['.'].development, exports['.'].default] : false,
    ...(component ? { peerDependencies: peers } : {}),
    files: component ? ['dist', 'custom-elements.json'] : ['dist'],
    ...(component ? { customElements: 'custom-elements.json' } : {}),
    scripts: { build: 'wireit' },
    wireit: {
      build: { dependencies: ['build:development', 'build:production', 'build:types'] },
      'build:development': step('dev', ['dist/development/*.js', 'dist/development/*.js.map']),
      'build:production': step('prod', ['dist/*.min.js', 'dist/*.min.js.map']),
      'build:types': step('types', ['dist/development/*.d.ts', 'dist/development/*.d.ts.map']),
    },
    filename,
  };

  const rollup = `import { defaultRollupConfig } from '../../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/** The framework stays external: its registry and stores must be the app's own (two copies would split them). */
const external = ${JSON.stringify(external).replaceAll('"', "'").replaceAll(',', ', ')};
const mangle = /^_[a-z]/;

export default [
${component
    ? `  /** \`.\` registers (\`src/register.ts\`); \`./element\` is the options and setup with no side effect (\`src/index.ts\`). */
  defaultRollupConfig(pkg.filename, external, mangle, { input: 'src/register.ts', alwaysExternal: external }),
  defaultRollupConfig(\`\${pkg.filename}-element\`, external, mangle, { input: 'src/index.ts', alwaysExternal: external }),`
    : `  defaultRollupConfig(pkg.filename, external, mangle, { input: 'src/index.ts', alwaysExternal: external }),`}
];
`;

  const tsconfig = { extends: '../../../tsconfig.json', include: ['src/**/*', '../../core/src/**/*', '../../renderer/src/**/*', '../../styles/src/**/*', '../../inserts/src/**/*', '../../shared-utils/src/**/*', '../../shared-types/src/**/*', '../../hooks/*/src/**/*'] };

  /** The surface's export: `datePickerSurface` for `date-picker`, as select's is `selectSurface`. */
  const surfaceName = `${name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())}Surface`;
  const sources = component
    ? {
        'src/element.ts': `/**
 * **<${tag}>: its options and its setup.** Never calls \`define\`: \`register.ts\` does, so importing the \`./element\`
 * entry registers nothing.
 */
import { html } from '@verajs/core';

/** The tag and the element's declared options, handed to core's \`define\` by \`register.ts\`. */
export const options = { tag: '${tag}' } as const;

/**
 * The setup: runs once per element; returns its render. Components render in light DOM, where a \`<slot>\` does
 * nothing (package-structure refuses one): the render is the component's own parts, and children the user wrote are
 * the user's, read where they are and never moved.
 */
export const setup = () => () => html\`<span data-vera-part="root"></span>\`;
`,
        'src/register.ts': `/**
 * **The \`.\` entry: registers <${tag}>.** The guard runs before core's \`define\`: a tag another copy already holds
 * is left to it, with a development warning, so two copies on one page never throw the app down.
 */
import { define } from '@verajs/core';
import { diagnostic, SHARED } from '@verajs/shared-utils';
import { options, setup } from './element.js';

if (!customElements.get(options.tag)) define(options, setup);
else if (__DEV__ && typeof console !== 'undefined')
  console.warn(diagnostic('${name}', \`<\${options.tag}>\`, 'defined-twice', __DEV__ && SHARED.definedTwice('${own}', 'element')));

/** The class that serves the tag: the registered one, so \`instanceof\` tells the truth under a stand-down and under hot. */
export const element = customElements.get(options.tag);
`,
        'src/index.ts': `/**
 * **The \`./element\` entry: <${tag}> under a tag of your own, with no side effect at import.** \`defineAs\` is its whole
 * surface (a tag in, the registered class out), so the options and the setup stay private and can change freely. The
 * unregistered class joins it once core's \`define\` can build a class without registering it.
 */
import { define } from '@verajs/core';
import { options, setup } from './element.js';

/** Registers the element under \`tag\` and returns the class that serves it. */
export const defineAs = (tag: string) => define({ ...options, tag }, setup);
`,
        'src/diagnostics.ts': `/** **${own}'s diagnostics: DEVELOPMENT ONLY prose.** */
import type { Prose } from '@verajs/shared-utils';

/**
 * This package's own codes, none yet. \`defined-twice\` is shared-utils' (one text for every component, one code in one
 * namespace), so it is never repeated here: two packages that each listed it would be refused by \`sync-diagnostics\`.
 */
export const PROSE: Record<string, Prose> = {};
`,
        [`src/${name}/surface.ts`]: `import type { ComponentSurface } from '@verajs/shared-types';

/**
 * **<${tag}>'s declared surface: every name a consumer can depend on, as data.** \`custom-elements.json\` is generated
 * from it (\`scripts/generate-cem.mjs\`; the gate's \`--check\` refuses a manifest that disagrees), so a name added to
 * the element is added here in the same change, and renaming one is a breaking change.
 */
export const ${surfaceName} = {
  tag: ${JSON.stringify(tag)},
  description: ${JSON.stringify(description?.trim() ?? '')},
  attributes: [],
  properties: [],
  events: [],
  methods: [],
  slots: [],
  parts: [{ name: 'root', description: 'The element\\'s one rendered part.' }],
  states: [],
  customStates: [],
  tokens: [],
} as const satisfies ComponentSurface;
`,
      }
    : { 'src/index.ts': `/** **${own}: a headless hook.** Re-exports only. */\nexport {};\n` };

  /** A component's README carries one recipe, which `tests/docs-recipes.test.mjs` runs (and its count is pinned there). */
  const recipe = `
<!-- recipe -->
\`\`\`js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import '${own}';

wire([renderer]);
document.body.innerHTML = '<${tag}></${tag}>';
\`\`\`
`;
  const readme = `# ${own}

${component ? `\`<${tag}>\`: ${description.trim()}` : `\`${name}\`: a headless Vera hook.`} Private until launch.
${component ? recipe : ''}`;

  /**
   * **Its own suite, at \`tests/\` (the root glob runs it in both builds).** Each scenario runs in its own process, so each
   * starts with an empty registry; the parent asserts on what the child reports.
   */
  const testFile = `tests/${component ? '' : 'hook-'}${name}-package.test.mjs`;
  const GLOBALS = "['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver']";
  const componentSuite = `/**
 * **${own}: its two entries, as a page and a server meet them** (written by \`scripts/new-package.mjs\`). \`.\` registers
 * <${tag}> once however many copies load, and development says so once; \`./element\` registers nothing at import, and
 * its \`defineAs\` registers under the caller's tag; a server importing \`.\` through \`@verajs/ssr\` renders it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { distUrl, isProduction, load } from './dist.mjs';

const TAG = '${tag}';
const SCENARIO = process.env.VERA_PACKAGE_SCENARIO;

if (SCENARIO === 'ssr') {
  const { renderToString } = await import('@verajs/ssr');
  const { html } = await renderToString(distUrl('${own.slice(1)}'), { tag: TAG });
  process.stdout.write(JSON.stringify({ html }));
} else if (SCENARIO) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  for (const key of ${GLOBALS}) globalThis[key] = dom.window[key];
  const said = [];
  console.warn = (...args) => said.push(String(args[0]));
  console.error = (...args) => said.push(String(args[0]));
  const { flush, wire } = await load('core');
  wire([(await load('renderer')).renderer]);
  const out = { said };
  if (SCENARIO === 'twice') {
    const a = await load('${own.slice(1)}', '?copy=a');
    const b = await load('${own.slice(1)}', '?copy=b');
    out.one = typeof a.element === 'function' && a.element === b.element && a.element === customElements.get(TAG);
  } else if (SCENARIO === 'element') {
    out.exports = Object.keys(await load('${own.slice(1)}/element')).sort();
    out.untouched = customElements.get(TAG) === undefined;
  } else if (SCENARIO === 'define-as') {
    const { defineAs } = await load('${own.slice(1)}/element');
    const Class = defineAs('my-${name}');
    out.registered = typeof Class === 'function' && customElements.get('my-${name}') === Class;
    out.untouched = customElements.get(TAG) === undefined;
    const element = document.createElement('my-${name}');
    document.body.append(element);
    flush();
    await Promise.resolve();
    out.rendered = element.querySelector('[data-vera-part="root"]') !== null;
  } else if (SCENARIO === 'surface') {
    const { element: Class } = await load('${own.slice(1)}');
    const element = document.createElement(TAG);
    document.body.append(element);
    /** The parts each state renders. \`flush()\` drains the scheduler synchronously, so each read sees that state's render. */
    const parts = () => [...new Set([...element.querySelectorAll('[data-vera-part]')].map((node) => node.getAttribute('data-vera-part')))].sort();
    flush();
    out.states = { 'at rest': parts() };
    /** A part that renders only in some state (open, invalid, with a value) is reached here: drive the state, flush, read. */
    out.observed = [...(Class.observedAttributes ?? [])].sort();
  }
  process.stdout.write(JSON.stringify(out));
} else {
  const run = (scenario) => {
    const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      encoding: 'utf8',
      env: { ...process.env, VERA_PACKAGE_SCENARIO: scenario },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  test('two copies of "." register one class, and development says defined-twice once', () => {
    const { one, said } = run('twice');
    assert.equal(one, true, 'both copies export the registered class');
    const lines = said.filter((line) => line.includes('defined-twice'));
    assert.equal(lines.length, isProduction ? 0 : 1, said.join(' | '));
    assert.deepEqual(said.filter((line) => !line.includes('defined-twice')), [], 'nothing else is said');
    if (!isProduction) assert.match(lines[0], /^\\[vera\\] /);
  });

  test('"./element" registers nothing at import, and exports only defineAs', () => {
    const { exports, untouched, said } = run('element');
    assert.deepEqual(exports, ['defineAs']);
    assert.equal(untouched, true, \`<\${TAG}> stays free\`);
    assert.deepEqual(said, []);
  });

  test('defineAs registers under the caller\\'s tag, and the element renders its part', () => {
    const { registered, untouched, rendered, said } = run('define-as');
    assert.equal(registered, true, 'the returned class serves the tag');
    assert.equal(untouched, true, \`<\${TAG}> stays free\`);
    assert.equal(rendered, true, 'the root part is in the element');
    assert.deepEqual(said, []);
  });

  /**
   * **The surface stays true** (the drift row): every part any driven state renders is declared in \`surface.ts\`,
   * every declared part renders in some state, and every attribute the element observes is declared, so a name added
   * to the element and not to its surface is red here, in the change that made it. An attribute read only at use
   * (\`getAttribute\`) is declared and never observed, which is not drift.
   */
  test('every part the element renders is declared and every declared part renders; no attribute it observes is undeclared', async () => {
    const { ${surfaceName} } = await import('../${dir}/src/${name}/surface.ts');
    const { states, observed, said } = run('surface');
    const parts = ${surfaceName}.parts.map((part) => part.name);
    const rendered = [...new Set(Object.values(states).flat())].sort();
    assert.ok(rendered.length > 0, 'CONTROL: the element rendered a part');
    for (const [state, names] of Object.entries(states))
      assert.deepEqual(names.filter((name) => !parts.includes(name)), [], \`a part rendered \${state} and not declared: add it to surface.ts with the element\`);
    assert.deepEqual(parts.filter((name) => !rendered.includes(name)), [], 'a part declared and rendered in no state the scenario drives: drive that state, or remove the part');
    /** One way only: an attribute read at connect (\`getAttribute\`) is declared and never observed, which is not drift. */
    const declared = ${surfaceName}.attributes.map((attribute) => attribute.name);
    assert.deepEqual(observed.filter((name) => !declared.includes(name)), [], 'an attribute observed and not declared: add it to surface.ts with the element');
    assert.deepEqual(said, []);
  });

  test('a server imports "." through @verajs/ssr and renders the element', () => {
    const { html } = run('ssr');
    assert.ok(html.includes(\`<\${TAG}\`), html);
    assert.ok(html.includes('data-vera-part="root"'), html);
  });
}
`;
  const hookSuite = `/**
 * **${own}: importing it changes nothing** (written by \`scripts/new-package.mjs\`): a hook registers no element and
 * says nothing at import. Its behavior suites join it in tests/ as the hook grows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

test('importing ${own} registers nothing and says nothing', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
  for (const key of ${GLOBALS}) globalThis[key] = dom.window[key];
  const said = [];
  const { warn, error } = console;
  console.warn = console.error = (...args) => said.push(String(args[0]));
  const define = customElements.define;
  let defined = 0;
  customElements.define = (...args) => (defined++, define.apply(customElements, args));
  try {
    await load('${own.slice(1)}');
  } finally {
    Object.assign(console, { warn, error });
    customElements.define = define;
  }
  assert.equal(defined, 0, 'no element is registered');
  assert.deepEqual(said, []);
});
`;

  const target = component ? 'register.ts' : 'index.ts';
  const written = {
    [`${dir}/package.json`]: JSON.stringify(manifest, null, 2) + '\n',
    [`${dir}/rollup.config.js`]: rollup,
    [`${dir}/tsconfig.json`]: JSON.stringify(tsconfig, null, 2) + '\n',
    [`${dir}/README.md`]: readme,
    ...Object.fromEntries(Object.entries(sources).map(([path, text]) => [`${dir}/${path}`, text])),
    [testFile]: component ? componentSuite : hookSuite,
  };
  /**
   * **The registry edits, as data:** each inserts `line` after (or before) the first line of `file` holding `anchor`. The
   * command applies them; `tests/new-package-output.test.mjs` reads them, so a moved anchor or a missing registration is
   * red before anyone next makes a package. A component prints from birth (`defined-twice`), so it is registered on the
   * diagnostics tables AND in through-tables' MIGRATED; a hook prints nothing at birth and gets neither (that suite's
   * failure names both lines when its first warning lands).
   */
  const edits = [
    { file: 'package.json', anchor: '"./packages/shared-types:build",', line: `        "./${dir}:build",`, where: 'before' },
    { file: 'tsconfig.json', anchor: '"paths": {', line: `      "${own}": [\n        "./${dir}/src/${target}"\n      ],${component ? `\n      "${own}/element": [\n        "./${dir}/src/index.ts"\n      ],` : ''}` },
    { file: 'tests/dist.mjs', anchor: 'export const ENTRY = {', line: `  '${own.slice(1)}': ['${short}', '${filename}'],${component ? `\n  '${own.slice(1)}/element': ['${short}', '${filename}-element'],` : ''}` },
    { file: 'tests/docs-imports.test.mjs', anchor: "'@verajs/core': 'core',", line: `  '${own}': '${own.slice(1)}',`, where: 'before' },
    { file: 'tests/docs-recipes.test.mjs', anchor: "'@verajs/core': 'core',", line: `  '${own}': '${own.slice(1)}',`, where: 'before' },
    ...(component
      ? [
          { file: 'tests/docs-recipes.test.mjs', anchor: 'const EXPECTED_RECIPES = {', line: `  '${dir}/README.md': 1,` },
          { file: 'scripts/diagnostic-tables.mjs', anchor: "{ name: 'styles', tables: ['src/diagnostics.ts'], sources: SOURCES },", line: `  { name: '${short}', tables: ['src/diagnostics.ts'], sources: SOURCES },`, where: 'before' },
          { file: 'tests/diagnostics-through-tables.test.mjs', anchor: 'const MIGRATED = [', line: `  ['${short}', 'dist/*.min.js'],` },
        ]
      : []),
  ];
  return { component, dir, short, own, filename, tag, testFile, target, written, edits };
};

/** The command, only when this file was started: `argv[1]` is absent under `node -e`, a REPL or a script over stdin. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [kind, name, description] = process.argv.slice(2);
  const coreVersion = JSON.parse(readFileSync(`${ROOT}packages/core/package.json`, 'utf8')).version;
  const { component, dir, own, testFile, written, edits } = scaffold(kind, name, coreVersion, description);
  if (existsSync(ROOT + dir)) throw new Error(`${dir} already exists`);
  if (existsSync(ROOT + testFile)) throw new Error(`${testFile} already exists`);

  /** Insert \`line\` after (or before) the first line matching \`anchor\` in \`file\`; refuse when the anchor is missing. */
  const insert = (file, anchor, line, where = 'after') => {
    const text = readFileSync(ROOT + file, 'utf8');
    if (text.includes(line.trim())) return;
    const lines = text.split('\n');
    const at = lines.findIndex((candidate) => candidate.includes(anchor));
    if (at < 0) throw new Error(`${file}: its anchor ${JSON.stringify(anchor)} is gone — register ${own} there by hand, then fix this script`);
    lines.splice(where === 'after' ? at + 1 : at, 0, line);
    writeFileSync(ROOT + file, lines.join('\n'));
  };

  for (const [file, text] of Object.entries(written)) {
    mkdirSync(dirname(ROOT + file), { recursive: true });
    writeFileSync(ROOT + file, text);
  }
  writeFileSync(`${ROOT}${dir}/LICENSE`, readFileSync(`${ROOT}LICENSE`, 'utf8'));

  /**
   * The manifest is generated, never written by hand: the same command the gate's `--check` runs, on this package. It
   * runs BEFORE the registry edits, so a refusal leaves the package's own files and touches no shared file.
   */
  if (component) {
    const cem = spawnSync(process.execPath, [`${ROOT}scripts/generate-cem.mjs`, dir], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
    const why = cem.error?.code === 'ETIMEDOUT' ? 'it did not finish within 60 s' : cem.stderr;
    if (cem.error || cem.status !== 0)
      throw new Error(`generate-cem refused ${dir} (${why}). The package's files are written and registered nowhere: remove ${dir} and ${testFile}, fix the cause, and run this command again`);
  }

  for (const { file, anchor, line, where } of edits) insert(file, anchor, line, where);

  console.log(`wrote ${dir} (${own}) and registered it; next: npm install, then npm run build, node --test --conditions development ${testFile} and tests/package-structure.test.mjs`);
}
