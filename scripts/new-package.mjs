/**
 * **A new component or hook package, complete: its files and every place a package must appear.**
 *
 *   node scripts/new-package.mjs component <name>    → packages/components/<name>, @vera-components/<name>, <vera-<name>>
 *   node scripts/new-package.mjs hook <name>         → packages/hooks/<name>, @vera-hooks/<name>
 *
 * It writes the anatomy `DESIGN.md` §2.5 describes and registers the package in the root build, `tsconfig.json`'s
 * paths, `tests/dist.mjs`, the docs-imports and recipes maps and the diagnostics tables. `tests/package-structure.test.mjs`
 * holds every package to that shape, so a package this script writes passes it on the day it is made. The registries are
 * edited at fixed anchor lines, and the script refuses when an anchor is missing rather than guess. Then run
 * `npm install` (a new workspace needs its links; check `find node_modules -maxdepth 2 -type l` first, CLAUDE.md).
 *
 * A component registers through core's `define` (Brian, 2026-11-20): `src/element.ts` holds the options and the setup
 * and never calls `define`; `src/register.ts` is the `.` entry, guards a taken tag (R3) and warns `defined-twice` in
 * development; `src/index.ts` is the `./element` entry, `defineAs(tag)`, with no side effect at import.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ROOT } from './packages.mjs';

const [kind, name] = process.argv.slice(2);
if (!['component', 'hook'].includes(kind) || !/^[a-z][a-z0-9-]*$/.test(name ?? ''))
  throw new Error('usage: node scripts/new-package.mjs <component|hook> <name>   (name: lowercase, digits, hyphens)');

const component = kind === 'component';
const dir = `packages/${component ? 'components' : 'hooks'}/${name}`;
const short = dir.slice('packages/'.length);
const own = `${component ? '@vera-components' : '@vera-hooks'}/${name}`;
const filename = `vera-${name}`;
const tag = `vera-${name}`;
if (existsSync(ROOT + dir)) throw new Error(`${dir} already exists`);

const version = (pkg) => JSON.parse(readFileSync(`${ROOT}packages/${pkg}/package.json`, 'utf8')).version;
const peers = component
  ? { '@verajs/core': `^${version('core')}`, '@verajs/renderer': `^${version('renderer')}`, '@verajs/styles': `^${version('styles')}` }
  : { '@verajs/core': `^${version('core')}` };
const external = Object.keys(peers);

/** One build entry's three conditions. */
const entry = (file) => ({ types: `./dist/development/${file}.d.ts`, development: `./dist/development/${file}.js`, default: `./dist/${file}.min.js` });
const files = ['src/**/*{.js,.ts}', '../../shared-types/src/**/*{.js,.ts}', '../../shared-utils/src/**/*{.js,.ts}', 'tsconfig.json', '../../../tsconfig.json', 'rollup.config.js', '../../../defaultRollupConfig.js'];
const step = (mode, output, extra = {}) => ({ command: 'npx rollup -c', ...(mode === 'types' ? {} : { clean: 'if-file-deleted' }), env: { MODE: mode }, files, output, ...extra });

const exports = component ? { '.': entry(filename), './element': entry(`${filename}-element`) } : { '.': entry(filename) };
const manifest = {
  name: own,
  version: '0.0.0',
  private: true,
  description: component ? `<${tag}>: a Vera component.` : `${name}: a headless Vera hook.`,
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
  peerDependencies: peers,
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

const sources = component
  ? {
      'src/element.ts': `/**
 * **<${tag}>: its options and its setup.** Never calls \`define\`: \`register.ts\` does, so importing the \`./element\`
 * entry registers nothing (d7, 2026-11-20).
 */
import { html } from '@verajs/core';

/** The tag and the element's declared options, handed to core's \`define\` by \`register.ts\`. */
export const options = { tag: '${tag}' } as const;

/** The setup: runs once per element; returns its render. */
export const setup = () => () => html\`<slot></slot>\`;
`,
      'src/register.ts': `/**
 * **The \`.\` entry: registers <${tag}>.** The guard runs before core's \`define\` (R3): a tag another copy already holds
 * is left to it, with a development warning, so two copies on one page never throw the app down.
 */
import { define } from '@verajs/core';
import { diagnostic } from '@verajs/shared-utils';
import { options, setup } from './element.js';
import { PROSE } from './diagnostics.js';

if (!customElements.get(options.tag)) define(options, setup);
else if (__DEV__ && typeof console !== 'undefined')
  console.warn(diagnostic('${name}', \`<\${options.tag}>\`, 'defined-twice', __DEV__ && PROSE['defined-twice']()));

/** The class that serves the tag: the registered one, so \`instanceof\` tells the truth under a stand-down and under hot. */
export const element = customElements.get(options.tag);
`,
      'src/index.ts': `/**
 * **The \`./element\` entry: <${tag}> under a tag of your own, with no side effect at import.** \`defineAs\` is its whole
 * surface (a tag in, the registered class out), so the options and the setup stay private and can change freely (d7,
 * 2026-11-20). The unregistered class joins it once core's \`define\` can build without registering (F1).
 */
import { define } from '@verajs/core';
import { options, setup } from './element.js';

/** Registers the element under \`tag\` and returns the class that serves it. */
export const defineAs = (tag: string) => define({ ...options, tag }, setup);
`,
      'src/diagnostics.ts': `/** **${own}'s diagnostics: DEVELOPMENT ONLY prose.** */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  /** The subject (the tag) is printed by \`diagnostic\` before the message, so the message never repeats it. */
  'defined-twice': () => [
    'is already defined by another copy or version of ${own}, so the first is kept.',
    'Align the versions, or import ${own}/element and define it under your own tag.',
  ],
};
`,
    }
  : { 'src/index.ts': `/** **${own}: a headless hook.** Re-exports only. */\nexport {};\n` };

const readme = `# ${own}

${component ? `\`<${tag}>\`: a Vera component.` : `\`${name}\`: a headless Vera hook.`} Private until launch.
`;

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

mkdirSync(`${ROOT}${dir}/src`, { recursive: true });
writeFileSync(`${ROOT}${dir}/package.json`, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(`${ROOT}${dir}/rollup.config.js`, rollup);
writeFileSync(`${ROOT}${dir}/tsconfig.json`, JSON.stringify(tsconfig, null, 2) + '\n');
writeFileSync(`${ROOT}${dir}/README.md`, readme);
writeFileSync(`${ROOT}${dir}/LICENSE`, readFileSync(`${ROOT}LICENSE`, 'utf8'));
for (const [file, text] of Object.entries(sources)) writeFileSync(`${ROOT}${dir}/${file}`, text);

const target = component ? 'register.ts' : 'index.ts';
insert('package.json', '"./packages/shared-types:build",', `        "./${dir}:build",`, 'before');
insert('tsconfig.json', '"paths": {', `      "${own}": [\n        "./${dir}/src/${target}"\n      ],${component ? `\n      "${own}/element": [\n        "./${dir}/src/index.ts"\n      ],` : ''}`);
insert('tests/dist.mjs', 'export const ENTRY = {', `  '${own.slice(1)}': ['${short}', '${filename}'],${component ? `\n  '${own.slice(1)}/element': ['${short}', '${filename}-element'],` : ''}`);
insert('tests/docs-imports.test.mjs', "'@verajs/core': 'core',", `  '${own}': '${own.slice(1)}',`, 'before');
insert('tests/docs-recipes.test.mjs', "'@verajs/core': 'core',", `  '${own}': '${own.slice(1)}',`, 'before');
if (component) insert('scripts/diagnostic-tables.mjs', "{ name: 'styles', tables: ['src/diagnostics.ts'], sources: SOURCES },", `  { name: '${short}', tables: ['src/diagnostics.ts'], sources: SOURCES },`, 'before');

console.log(`wrote ${dir} (${own}) and registered it; next: npm install, then npm run build and node --test tests/package-structure.test.mjs`);
