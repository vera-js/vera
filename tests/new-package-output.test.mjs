/**
 * **What `scripts/new-package.mjs` writes carries no private pointer** (R5's rule, as `no-private-pointers.test.mjs` holds
 * every package's source to it). A pointer in the scaffold's template lands in every package it ever makes, so it is
 * caught here, in the template's output, before any package exists: `scaffold()` returns the files as text and writes
 * nothing. Comments are read by the same pattern and reader as the package suite (`private-pointers.mjs`); a file's
 * whole text must also never name an `internal/` path, in code or prose.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scaffold } from '../scripts/new-package.mjs';
import { comments } from './source-comments.mjs';
import { pointers } from './private-pointers.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/new-package.mjs', import.meta.url));
/** Files whose comments are source: the package's code and its suite. */
const SOURCE = /\.(ts|js|mjs)$/;

/** Every pointer in `written`'s source comments, and every `internal/` in any of its files. */
const findings = (written) => {
  const found = [];
  let read = 0;
  for (const [file, text] of Object.entries(written)) {
    if (SOURCE.test(file)) {
      read += comments(text).length;
      for (const p of pointers(text)) found.push(`${file}:${p.line} [${p.token}] ${p.text.trim().slice(0, 100)}`);
    }
    for (const [i, line] of text.split('\n').entries()) if (line.includes('internal/')) found.push(`${file}:${i + 1} [internal/] ${line.trim().slice(0, 100)}`);
  }
  return { found, read };
};

for (const kind of ['component', 'hook'])
  test(`a scaffolded ${kind} carries no private pointer`, () => {
    const { written } = scaffold(kind, 'zz-output', '0.0.0', 'A scaffolded element.');
    const { found, read } = findings(written);
    /** The floor: a scaffold that wrote nothing, or a reader that found no comment, would pass an empty list. */
    assert.ok(Object.keys(written).length >= 5 && read >= 2, `the scaffold wrote ${Object.keys(written).length} files with ${read} comments`);
    assert.deepEqual(found, [], `state the fact instead of the label:\n  ${found.join('\n  ')}`);
  });

test('CONTROL: a planted pointer in a comment, and an internal/ path anywhere, are both found', () => {
  const { found } = findings({ 'a.ts': '/** decided (d7, 2026-11-20) */\nconst a = 1;\n', 'README.md': 'See internal/docs/x.md.\n' });
  assert.deepEqual(found, ['a.ts:1 [(d7, 2026-11-20)] /** decided (d7, 2026-11-20) */', 'README.md:1 [internal/] See internal/docs/x.md.']);
});

test('the command still runs when started directly, and importing the script runs nothing', () => {
  /** This suite imported it above: had the command run at import, the missing arguments would have thrown there. */
  const result = spawnSync(process.execPath, [SCRIPT, 'neither'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage: node scripts\/new-package\.mjs <component\|hook> <name>/);
});

test('importing the script where nothing set argv[1] (a script over stdin) runs nothing and throws nothing', () => {
  const script = `const m = await import(${JSON.stringify(new URL('../scripts/new-package.mjs', import.meta.url).href)});\nprocess.stdout.write(typeof m.scaffold);\n`;
  const result = spawnSync(process.execPath, ['--input-type=module'], { input: script, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'function');
});

/**
 * **The registry edits are the scaffold's output too.** `scaffold()` returns them as data (file, anchor, line, side) and
 * the command applies them, so both facts are held here without writing anything: every anchor still exists in its
 * file (a moved anchor otherwise surfaces only when someone next makes a package), and a component is registered
 * everywhere a printing package must be. A component prints from birth (`defined-twice`), so it needs its row in
 * `tests/diagnostics-through-tables.test.mjs`'s MIGRATED as well as its `scripts/diagnostic-tables.mjs` entry; a hook
 * prints nothing at birth, so it gets neither, and that suite's failure names both lines when its first warning lands.
 */
test('every registry edit the scaffold makes is anchored on a line its file still has', () => {
  for (const kind of ['component', 'hook']) {
    const { edits } = scaffold(kind, 'zz-output', '0.0.0', 'A scaffolded element.');
    assert.ok(edits.length >= 5, `CONTROL: the ${kind} scaffold makes ${edits.length} registry edits`);
    for (const { file, anchor } of edits)
      assert.ok(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').includes(anchor), `${kind}: ${file} no longer has the anchor ${JSON.stringify(anchor)}`);
  }
});

test('a component is registered on the diagnostics tables AND in MIGRATED; a hook in neither', () => {
  const lines = (kind) => scaffold(kind, 'zz-output', '0.0.0', 'A scaffolded element.').edits.map(({ file, line }) => `${file} ${line.trim()}`);
  const component = lines('component');
  assert.ok(component.includes("scripts/diagnostic-tables.mjs { name: 'components/zz-output', tables: ['src/diagnostics.ts'], sources: SOURCES },"), component.join('\n'));
  assert.ok(component.includes("tests/diagnostics-through-tables.test.mjs ['components/zz-output', 'dist/*.min.js'],"), component.join('\n'));
  const hook = lines('hook');
  assert.deepEqual(hook.filter((line) => /diagnostic/.test(line)), [], hook.join('\n'));
});
