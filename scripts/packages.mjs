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
import { posix } from './fs-path.mjs';

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
  return [...new Set(manifests.map((file) => posix(file).slice(0, -'/package.json'.length)))].sort();
};

/**
 * **Build output left in a directory that is no longer a package**, relative to the root, sorted: a `dist/` (or
 * `.wireit/`) where a workspace pattern matches but no `package.json` is. A branch switch removes a package's tracked
 * files and leaves its ignored output, so the directory stops being a package while its old bundle stays readable by
 * any test that imports a dist by path; a clean build that clears only packages' output never sees it (2026-11-21).
 *
 * @param {string} [root] Repository root (absolute, trailing slash); defaults to this repo's
 * @returns {string[]}
 */
export const orphanOutputs = (root = ROOT) => {
  const { workspaces } = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
  const packages = new Set(packageDirs(root));
  const outputs = globSync(workspaces.flatMap((pattern) => [`${pattern}/dist`, `${pattern}/.wireit`]), { cwd: root }).map(posix);
  return [...new Set(outputs)].filter((output) => !packages.has(output.slice(0, output.lastIndexOf('/')))).sort();
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
    .map(posix)
    .sort();
