/**
 * **The standalone loader's merged import map has no prototype** (2026-11-11). It merges every `<script
 * type="importmap">` first-wins with `mapped[name] ??= imports[name]`; over a plain `{}` an entry named like an
 * `Object.prototype` member (`constructor`, `toString`) found the inherited function, so the entry was silently
 * dropped, and a lookup of that specifier answered "mapped" with a built-in. Pinned at the source: the table `maps()`
 * builds is `Object.create(null)`. The loader runs only in a browser on a page's own maps, so the pin reads the code
 * rather than driving a page. CONTROL: the check finds exactly one assignment to the table and reads its initializer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const file = 'packages/jsx/src/standalone.ts';
const source = ts.createSourceFile(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);

/** Every `mapped = <expression>` assignment in the file, as the expression's text. */
const assignments = [];
const visit = (node) => {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText(source) === 'mapped')
    assignments.push(node.right.getText(source));
  ts.forEachChild(node, visit);
};
visit(source);

test('the merged import-map table is created with no prototype', () => {
  assert.equal(assignments.length, 1, 'CONTROL: exactly one assignment to the table was found');
  assert.match(assignments[0], /^Object\.create\(null\)/, `the table is ${assignments[0]}`);
});

test('CONTROL: the merge rule itself, over each table shape, on a map naming `constructor` and `toString`', () => {
  const imports = JSON.parse('{"constructor": "/c.js", "toString": "/t.js", "lib": "/lib.js"}');
  const merge = (table) => {
    for (const name in imports) table[name] ??= imports[name];
    return table;
  };
  const plain = merge({});
  assert.equal(typeof plain.constructor, 'function', 'over `{}` the entry is dropped: the inherited built-in answers');
  const bare = merge(Object.create(null));
  assert.deepEqual({ ...bare }, { constructor: '/c.js', toString: '/t.js', lib: '/lib.js' }, 'with no prototype every entry lands');
});
