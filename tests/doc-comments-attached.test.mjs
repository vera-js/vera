/**
 * **Every doc comment documents something** (T7, 2026-11-12). A `/** … *\/` block followed directly by another block
 * comment is attached to nothing: the editor, `tsc` and every reader skip it, so the why it holds is lost while it looks
 * present. Four were found in core in one night (two from that night's own work), each made by inserting a comment or
 * code between a doc and its declaration, and no review caught any of them.
 *
 * The comments come from a full PARSE (every token's leading and trailing comment ranges): a bare scanner cannot tell a
 * regex from a division or resume a template after `${…}`, so after one it misplaces comments, and it under-counted
 * here (core 0 against 2 real ones) until the control below was planted after a regex and a template. Two shapes
 * are not detachments: a minifier annotation (`/*@__NOINLINE__*\/`) belongs to the code after it, and a file's opening
 * block is its module header, followed by the first declaration's own doc.
 *
 * Core is held at zero. Every other package has a count that may only fall (a ratchet): a count above its pin fails,
 * and a count below it fails too, asking for the pin to be lowered, so a cleared block stays cleared. Each package
 * clears in its own pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { comments } from './source-comments.mjs';

/** Each package's detached doc comments today (2026-11-12): lower a pin when its package clears some, never raise one. */
const PINS = {
  core: 0, autoloader: 6, cms: 3, directives: 10, hooks: 1, inserts: 4, jsx: 11, motion: 42, renderer: 33, router: 11,
  'shared-utils': 6, ssr: 36, store: 3, styles: 1, ui: 3,
};

/** The line of every detached doc comment in `text`. */
const detached = (text) => {
  const blocks = comments(text).filter((c) => c.text.startsWith('/*'));
  const found = [];
  for (let i = 0; i < blocks.length - 1; i++) {
    const doc = blocks[i];
    const next = blocks[i + 1];
    if (!doc.text.startsWith('/**') || doc.text.startsWith('/***')) continue;
    if (/^\/\*\s*[@#]__/.test(next.text)) continue;
    if (text.slice(doc.end, next.pos).trim() !== '') continue;
    if (text.slice(0, doc.pos).trim() === '') continue;
    found.push(text.slice(0, doc.pos).split('\n').length);
  }
  return found;
};

test('CONTROL: a planted detached doc is found, after a regex and a template too; a header, an annotation and a `/**` in a string are not', () => {
  assert.deepEqual(detached('const a = 1;\n/** documents nothing */\n/** documents b */\nconst b = 2;\n'), [2]);
  /** Where a bare scanner loses its place: after a regex holding a backtick and a template holding a division. */
  const hard = 'const r = /a\\/b`/g;\nconst t = `x ${1 / 2} y`;\nconst a = 1;\n/** documents nothing */\n/** documents b */\nconst b = 2;\n';
  assert.deepEqual(detached(hard), [4]);
  const clean = "/** module header */\n/** documents a */\nconst a = 1;\nconst s = '/** not a comment */ /** neither */';\n/** the call */\n/*@__NOINLINE__*/ f();\n";
  assert.deepEqual(detached(clean), []);
});

test('no package has more detached doc comments than its pin, and none has fewer (lower the pin)', () => {
  const counts = {};
  const where = [];
  for (const file of globSync('packages/*/src/**/*.ts')) {
    const pkg = file.split('/')[1];
    for (const line of detached(readFileSync(file, 'utf8'))) {
      counts[pkg] = (counts[pkg] ?? 0) + 1;
      where.push(`${file}:${line}`);
    }
  }
  for (const pkg of new Set([...Object.keys(PINS), ...Object.keys(counts)])) {
    const count = counts[pkg] ?? 0;
    const pin = PINS[pkg] ?? 0;
    const list = where.filter((w) => w.startsWith(`packages/${pkg}/`)).join('\n  ');
    assert.ok(count <= pin, `${pkg}: ${count} detached doc comment(s), above its pin of ${pin}:\n  ${list}`);
    assert.ok(count >= pin, `${pkg}: ${count} detached doc comment(s), below its pin of ${pin}: lower the pin in PINS`);
  }
});
