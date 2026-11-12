/**
 * **Every doc comment documents something** (T7, 2026-11-12). A `/** … *\/` block followed directly by another block
 * comment is attached to nothing: the editor, `tsc` and every reader skip it, so the why it holds is lost while it looks
 * present. Two landed that way in one night, each by inserting code between a doc and its declaration, and no review
 * caught either.
 *
 * TypeScript's own scanner reads the comments, so a `/**` inside a string or a template is never counted. Two shapes
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
import ts from 'typescript';

/** Each package's detached doc comments today (2026-11-12): lower a pin when its package clears some, never raise one. */
const PINS = {
  core: 0, autoloader: 1, cms: 3, directives: 5, inserts: 2, jsx: 5, motion: 16, renderer: 21, router: 3,
  'shared-utils': 4, ssr: 11, store: 3, styles: 1,
};

/** The line of every detached doc comment in `text`. */
const detached = (text) => {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  const found = [];
  let lastDoc = null;
  let headerAt = null;
  let first = true;
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.WhitespaceTrivia || kind === ts.SyntaxKind.NewLineTrivia) continue;
    if (kind !== ts.SyntaxKind.MultiLineCommentTrivia) {
      lastDoc = null;
      first = false;
      continue;
    }
    const comment = scanner.getTokenText();
    if (/^\/\*\s*[@#]__/.test(comment)) {
      lastDoc = null;
      continue;
    }
    if (lastDoc !== null && lastDoc !== headerAt) found.push(lastDoc);
    const at = scanner.getTokenPos();
    if (first) headerAt = at;
    first = false;
    lastDoc = comment.startsWith('/**') && !comment.startsWith('/***') ? at : null;
  }
  return found.map((pos) => text.slice(0, pos).split('\n').length);
};

test('CONTROL: a planted detached doc is found; a header, an annotation and a `/**` in a string are not', () => {
  assert.deepEqual(detached('const a = 1;\n/** documents nothing */\n/** documents b */\nconst b = 2;\n'), [2]);
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
