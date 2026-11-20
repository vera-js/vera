/**
 * **Every package in the tree, at any depth, from the one list npm uses.**
 *
 * Packages live at more than one depth: the framework's at `packages/<name>`, components at
 * `packages/components/<name>` and hooks at `packages/hooks/<name>`. A check that walks `packages/*` by hand finds only
 * the first level, and then passes on every nested package without reading it: a glob that matched no files reports a
 * clean tree. So every script and test that needs "each package" asks here, and `tests/package-dirs.test.mjs` refuses a
 * hand-written walk.
 *
 * The list is the root `package.json`'s `workspaces`, expanded to the directories that hold a `package.json`: exactly
 * what npm links, so a package this helper misses is one npm misses too.
 */
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The repository root, with a trailing slash. */
export const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Every package directory, relative to the root, with forward slashes, sorted (`packages/core`,
 * `packages/components/select`, …).
 *
 * @param {string} [root] Repository root (absolute, trailing slash); defaults to this repo's
 * @returns {string[]}
 */
export const packageDirs = (root = ROOT) => {
  const { workspaces } = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
  const manifests = globSync(workspaces.map((pattern) => `${pattern}/package.json`), { cwd: root });
  return [...new Set(manifests.map((file) => file.split('\\').join('/').slice(0, -'/package.json'.length)))].sort();
};

/**
 * Files matching `pattern` inside every package, relative to the root, with forward slashes, sorted
 * (`packageFiles('README.md')`, `packageFiles('src/**\/*.ts')`).
 *
 * @param {string} pattern A glob relative to each package directory
 * @param {string} [root] Repository root (absolute, trailing slash); defaults to this repo's
 * @returns {string[]}
 */
export const packageFiles = (pattern, root = ROOT) =>
  globSync(packageDirs(root).map((dir) => `${dir}/${pattern}`), { cwd: root })
    .map((file) => file.split('\\').join('/'))
    .sort();
