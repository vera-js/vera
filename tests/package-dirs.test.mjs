/**
 * **Every walk over the packages goes through `scripts/packages.mjs`, so no check skips a nested package.**
 *
 * Components live at `packages/components/<name>` and hooks at `packages/hooks/<name>`, a level below the framework's
 * packages. A script or test that walks `packages/*` by hand finds only the first level, and every check it makes then
 * passes on the nested packages without reading them: a glob that matched nothing reports a clean tree. Thirty-four
 * files did that before the helper existed (2026-11-20). This suite holds the helper to npm's own list and refuses a
 * new hand-written walk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, globSync } from 'node:fs';
import { basename } from 'node:path';
import { ROOT, packageDirs, packageFiles } from '../scripts/packages.mjs';

test('the helper finds the packages npm links, at every depth the workspaces name', () => {
  const dirs = packageDirs();
  assert.ok(dirs.length >= 15, `CONTROL: only ${dirs.length} packages found — the helper is broken, not the tree`);
  assert.ok(dirs.includes('packages/core'), 'core is a package');
  const { workspaces } = JSON.parse(readFileSync(ROOT + 'package.json', 'utf8'));
  for (const level of ['packages/components/*', 'packages/hooks/*'])
    assert.ok(workspaces.includes(level), `the workspaces name ${level}, so npm links a package there`);
  /** Every package npm would link is one the helper returns: the same globs, read from the same file. */
  const npm = globSync(workspaces.map((pattern) => `${pattern}/package.json`), { cwd: ROOT }).map((file) => file.split('\\').join('/').replace(/\/package\.json$/, ''));
  assert.deepEqual([...new Set(npm)].sort(), dirs);
  assert.ok(packageFiles('package.json').length === dirs.length, 'packageFiles reaches every package');
});

/** A hand-written walk over the packages directory: a glob starting `packages/*`, or a listing of `packages` itself. */
const WALKS = [
  /glob(?:Sync)?\([^)]*['"`]packages\/\*/,
  /readdir(?:Sync)?\([^)]*['"`/]packages['"`/]?\s*[,)]/,
  /readdir(?:Sync)?\(\s*new URL\(\s*['"`](?:\.\.\/)?packages\/?['"`]/,
  /readdir(?:Sync)?\(\s*`\$\{root\}packages`/,
  /readdir(?:Sync)?\(\s*join\(\s*root,\s*['"`]packages['"`]\s*\)/,
];

/**
 * Strip comments, so prose about `packages/*` is not code (a doc comment may describe the old walk). Only a comment
 * that BEGINS a line counts: the glob `'packages/*\/README.md'` itself holds a slash-star, and a stripper that matched
 * it anywhere ate the code up to the next star-slash — the first version of this suite passed on every hand walk that
 * way (16 of 29, shown on main's copies 2026-11-20).
 */
const code = (text) => text.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * **The two-step walk: a variable bound to the packages directory itself, then listed** (found 2026-11-21, moving select:
 * `const root = new URL('../packages/', import.meta.url)` … `readdirSync(root)` in four suites, which no one-line shape
 * sees). Only a LISTING of that variable counts: reading `${ROOT}${name}` for a named package is not a walk. Returns the
 * offending lines.
 */
const PACKAGES_ROOT = /(?:const|let|var)\s+(\w+)\s*=.*['"`](?:\.\.?\/)?packages\/?['"`]\s*(?:,\s*import\.meta\.url\s*)?\)/;
const twoStepWalks = (text) => {
  const lines = code(text).split('\n');
  const roots = lines.map((line) => PACKAGES_ROOT.exec(line)?.[1]).filter(Boolean);
  if (roots.length === 0) return [];
  const listing = new RegExp(`\\b(?:readdir(?:Sync)?|globSync|glob)\\(\\s*(?:${roots.join('|')})\\s*[,)]`);
  return lines.map((line, i) => [line, i]).filter(([line]) => listing.test(line)).map(([line, i]) => `${i + 1}: ${line.trim().slice(0, 120)}`);
};

test('no script or test walks packages/* by hand', () => {
  const files = globSync(['scripts/**/*.mjs', 'tests/**/*.mjs', 'tests/**/*.js', 'bench/*.mjs'], { cwd: ROOT, exclude: (name) => basename(name) === 'node_modules' })
    .map((file) => file.split('\\').join('/'))
    .filter((file) => file !== 'scripts/packages.mjs' && file !== 'tests/package-dirs.test.mjs');
  assert.ok(files.length > 100, `CONTROL: only ${files.length} files scanned`);
  const found = [];
  for (const file of files) {
    const lines = code(readFileSync(ROOT + file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (WALKS.some((walk) => walk.test(line))) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
    for (const hit of twoStepWalks(readFileSync(ROOT + file, 'utf8'))) found.push(`${file}:${hit}`);
  }
  assert.deepEqual(found, [], 'walk the packages with packageDirs() or packageFiles() from scripts/packages.mjs');
});

test('eslint.config.js gives every one-level package glob its nested twin, so components are linted like packages', () => {
  const config = readFileSync(ROOT + 'eslint.config.js', 'utf8');
  const single = [...config.matchAll(/'packages\/\*\/([^']+)'/g)].map((m) => m[1]);
  assert.ok(single.length >= 4, `CONTROL: only ${single.length} one-level globs found in eslint.config.js`);
  const missing = single.filter((rest) => !config.includes(`'packages/{components,hooks}/*/${rest}'`));
  assert.deepEqual(missing, [], 'add packages/{components,hooks}/*/… beside each — a component outside these globs gets none of the custom-element rules');
});

test('the walk detector fires on each shape it refuses (planted)', () => {
  const planted = [
    "globSync('packages/*/README.md', { cwd: root })",
    "globSync(['.wireit', 'packages/*/.wireit', 'packages/*/dist'], { cwd: root })",
    "for (const pkg of readdirSync('packages')) {",
    "readdirSync(new URL('../packages', import.meta.url))",
    "readdirSync(`${root}packages`)",
    "readdirSync(join(root, 'packages'))",
    /** The async forms (none in the tree on 2026-11-20; d7 asked that the next one be caught). */
    "for (const pkg of await readdir('packages')) {",
    "await fs.promises.readdir(join(root, 'packages'))",
    "for await (const file of glob('packages/*/README.md')) {",
  ];
  for (const line of planted) assert.ok(WALKS.some((walk) => walk.test(line)), `the detector misses: ${line}`);
  assert.ok(!WALKS.some((walk) => walk.test("packageFiles('README.md')")), 'the helper itself is not a walk');
  /** The two-step shapes, from the four suites that had them; and the named read that must pass. */
  const twoStep = [
    "const root = new URL('../packages/', import.meta.url).pathname;\nfor (const pkg of readdirSync(root)) {",
    "const ROOT = fileURLToPath(new URL('../packages/', import.meta.url));\nfor (const dir of readdirSync(ROOT)) {",
    "const ROOT = fileURLToPath(new URL('../packages/', import.meta.url));\nconst packages = readdirSync(ROOT).filter(Boolean);",
    "const dir = join(here, '..', 'packages');\nconst all = globSync(dir, {});",
  ];
  for (const text of twoStep) assert.equal(twoStepWalks(text).length, 1, `the two-step detector misses: ${text}`);
  assert.deepEqual(twoStepWalks("const ROOT = fileURLToPath(new URL('../packages/', import.meta.url));\nconst text = readFileSync(`${ROOT}${name}/src/x.ts`);"), [], 'a named read is not a walk');
  assert.deepEqual(twoStepWalks("const dir = join(root, 'packages', pkg);\nreaddirSync(dir);"), [], 'one named package, listed, is not a walk of the packages');
});
