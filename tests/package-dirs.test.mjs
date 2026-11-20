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
  /globSync\([^)]*['"`]packages\/\*/,
  /readdirSync\([^)]*['"`/]packages['"`/]?\s*[,)]/,
  /readdirSync\(\s*new URL\(\s*['"`](?:\.\.\/)?packages\/?['"`]/,
  /readdirSync\(\s*`\$\{root\}packages`/,
  /readdirSync\(\s*join\(\s*root,\s*['"`]packages['"`]\s*\)/,
];

/**
 * Strip comments, so prose about `packages/*` is not code (a doc comment may describe the old walk). Only a comment
 * that BEGINS a line counts: the glob `'packages/*\/README.md'` itself holds a slash-star, and a stripper that matched
 * it anywhere ate the code up to the next star-slash — the first version of this suite passed on every hand walk that
 * way (16 of 29, shown on main's copies 2026-11-20).
 */
const code = (text) => text.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '');

test('no script or test walks packages/* by hand', () => {
  const files = globSync(['scripts/**/*.mjs', 'tests/**/*.mjs', 'tests/**/*.js', 'bench/*.mjs'], { cwd: ROOT, exclude: (name) => name === 'node_modules' })
    .map((file) => file.split('\\').join('/'))
    .filter((file) => file !== 'scripts/packages.mjs' && file !== 'tests/package-dirs.test.mjs');
  assert.ok(files.length > 100, `CONTROL: only ${files.length} files scanned`);
  const found = [];
  for (const file of files) {
    const lines = code(readFileSync(ROOT + file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (WALKS.some((walk) => walk.test(line))) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(found, [], 'walk the packages with packageDirs() or packageFiles() from scripts/packages.mjs');
});

test('the walk detector fires on each shape it refuses (planted)', () => {
  const planted = [
    "globSync('packages/*/README.md', { cwd: root })",
    "globSync(['.wireit', 'packages/*/.wireit', 'packages/*/dist'], { cwd: root })",
    "for (const pkg of readdirSync('packages')) {",
    "readdirSync(new URL('../packages', import.meta.url))",
    "readdirSync(`${root}packages`)",
    "readdirSync(join(root, 'packages'))",
  ];
  for (const line of planted) assert.ok(WALKS.some((walk) => walk.test(line)), `the detector misses: ${line}`);
  assert.ok(!WALKS.some((walk) => walk.test("packageFiles('README.md')")), 'the helper itself is not a walk');
});
