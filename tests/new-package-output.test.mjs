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
    const { written } = scaffold(kind, 'zz-output', '0.0.0');
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
