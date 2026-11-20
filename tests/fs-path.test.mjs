/**
 * **`fsPath` reads the same as `.pathname` on macOS and Linux, and works on Windows; nothing goes back to `.pathname`.**
 *
 * The suites resolved files with `fsPath(new URL(…, import.meta.url))`, which is a path only on POSIX: on Windows it
 * is `/c:/…`, and forty suites failed at load on the Windows workstation (2026-11-20). They now use
 * `scripts/fs-path.mjs`. The change must not move a single byte on the laptop or CI, so the first test holds the
 * POSIX conversion equal to `.pathname` for the shapes the suites use, run on any OS (Node's `windows: false`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fsPath } from '../scripts/fs-path.mjs';

const ROOT = fsPath(new URL('..', import.meta.url));

test('on POSIX the conversion is byte-identical to .pathname, for every shape the suites use', () => {
  const base = 'file:///Users/omni/dev/vera/tests/x.test.mjs';
  for (const relative of ['..', '../', '../..', '../../', '.', './', '../packages', '../packages/', './fixtures/ssr/a.mjs', '../examples/cms-site/', './.casing-']) {
    const url = new URL(relative, base);
    assert.equal(fileURLToPath(url, { windows: false }).replaceAll('\\', '/'), url.pathname, relative);
  }
});

test('on this OS the path opens, and keeps the URL\'s trailing slash', () => {
  const root = fsPath(new URL('..', import.meta.url));
  assert.ok(root.endsWith('/'), `a directory URL keeps its trailing slash: ${root}`);
  assert.ok(!root.includes('\\'), 'forward slashes only');
  assert.ok(readFileSync(`${root}package.json`, 'utf8').includes('"workspaces"'), 'the root opens through a string join');
});

test('no suite or script resolves a file through .pathname', () => {
  const files = globSync(['tests/**/*.mjs', 'scripts/**/*.mjs'], { cwd: ROOT, exclude: (name) => name === 'node_modules' })
    .map((file) => file.split('\\').join('/'))
    .filter((file) => !['tests/fs-path.test.mjs', 'scripts/fs-path.mjs', 'scripts/codemods/fs-path.mjs'].includes(file));
  assert.ok(files.length > 100, `CONTROL: only ${files.length} files scanned`);
  const found = files.filter((file) => /import\.meta\.url\)\s*\.pathname/.test(readFileSync(ROOT + file, 'utf8')));
  assert.deepEqual(found, [], 'use fsPath(new URL(…, import.meta.url)) from scripts/fs-path.mjs');
  /** Built in two pieces, so the codemod (which rewrites the old shape wherever it finds it) cannot rewrite the plant. */
  const planted = "new URL('..', import.meta.url)" + '.pathname';
  assert.ok(/import\.meta\.url\)\s*\.pathname/.test(planted), 'the detector fires on the old shape');
});
