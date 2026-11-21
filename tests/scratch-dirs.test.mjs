/**
 * **clean-build removes the scratch a killed suite left in the tree, and only that** (`scripts/scratch-dirs.mjs`,
 * 2026-11-21). The places and prefixes are read from the suites' own `mkdtemp` calls; a leftover is a known prefix plus
 * exactly six `mkdtemp` characters. A call the reader cannot place is reported, so a new in-tree scratch cannot escape
 * the sweep silently. The fixture trees are made in the system's temporary directory; their call text is assembled
 * here so this file's own source holds no call for the real-tree reader to find.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scratchLeftovers, scratchPrefixes } from '../scripts/scratch-dirs.mjs';

const CALL = 'mkdtemp' + 'Sync(';
/** A throwaway tree: `files` written relative to it, `dirs` made; removed after `use` runs. */
const tree = (files, dirs, use) => {
  const root = mkdtempSync(join(tmpdir(), 'vera-scratch-')) + '/';
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(root + path.slice(0, path.lastIndexOf('/')), { recursive: true });
      writeFileSync(root + path, text);
    }
    for (const dir of dirs) mkdirSync(root + dir, { recursive: true });
    return use(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test('the real tree: every in-tree scratch call is read, and the known places are found', () => {
  const { prefixes, unread } = scratchPrefixes();
  assert.deepEqual(unread, [], 'a mkdtemp call the reader cannot place');
  const names = prefixes.map(({ dir, prefix }) => `${dir}/${prefix}`);
  assert.ok(names.includes('tests/.raw-') && names.includes('tests/.styles-') && names.includes('examples/kitchen-sink/.jsx-'), `CONTROL: known prefixes read: ${names}`);
  assert.ok(prefixes.length >= 18, `a floor on what is read (18 on 2026-11-21): ${prefixes.length}`);
});

test('a known prefix with six mkdtemp characters is a leftover; an unlisted name and a wrong suffix are not', () => {
  const files = { 'tests/a.test.mjs': `const dir = ${CALL}join(process.cwd(), 'tests', '.parity-'));\n` };
  const dirs = ['tests/.parity-AbC123', 'tests/.keepme', 'tests/.parity-toolong1', 'tests/.parity-ab12', 'tests/fixtures'];
  tree(files, dirs, (root) => {
    assert.deepEqual(scratchLeftovers(root), ['tests/.parity-AbC123']);
  });
});

test('the three in-tree forms are each read, beside the file and from the root; the temporary directory is not ours', () => {
  const files = {
    'tests/deep/b.test.mjs': `const d = ${CALL}fsPath(new URL('./.styles-', import.meta.url)));\n`,
    'tests/c.test.mjs': `const d = ${CALL}fsPath(new URL('./examples/kitchen-sink/.jsx-', root)));\nconst t = ${CALL}join(tmpdir(), 'vera-x-'));\n`,
  };
  tree(files, ['tests/deep/.styles-Zz9Yy8', 'examples/kitchen-sink/.jsx-Qq1Ww2'], (root) => {
    const { prefixes, unread } = scratchPrefixes(root);
    assert.deepEqual(unread, []);
    assert.deepEqual(prefixes.map(({ dir, prefix }) => `${dir}/${prefix}`).sort(), ['examples/kitchen-sink/.jsx-', 'tests/deep/.styles-']);
    assert.deepEqual(scratchLeftovers(root), ['examples/kitchen-sink/.jsx-Qq1Ww2', 'tests/deep/.styles-Zz9Yy8']);
  });
});

test('PLANT: a call whose place is built in a variable is reported by file, never guessed at', () => {
  tree({ 'tests/d.test.mjs': `const base = join(ROOT, 'tests', PREFIX);\nconst d = ${CALL}base);\n` }, [], (root) => {
    const { prefixes, unread } = scratchPrefixes(root);
    assert.deepEqual(prefixes, []);
    assert.equal(unread.length, 1);
    assert.match(unread[0], /^tests\/d\.test\.mjs: mkdtemp\(base\)/);
  });
});

test('clean-build removes what scratchLeftovers names, with the build output', () => {
  const source = readFileSync(new URL('../scripts/clean-build.mjs', import.meta.url), 'utf8');
  assert.match(source, /const scratch = scratchLeftovers\(\);/);
  assert.match(source, /\.\.\.orphans, \.\.\.scratch\]/);
});
