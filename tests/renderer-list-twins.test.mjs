/**
 * **Rendering and hydration must agree on what a LIST is, and this test is the second address of that rule.** The
 * renderer's `ChildPart.$p` and hydration's `adoptObject` each decide whether a child value commits as a list: an
 * array, or any other iterable that is not a node (a `<select>` and a `<form>` are iterable, and are placed). The two
 * live in separately bundled files, and one shared `listOf` was measured and refused (2026-11-13: one caller per bundle,
 * so the minifier pasted it in as an invoked function, +13 B gzipped, or +39 B annotated to stay a call). So each keeps
 * its own lines, and a change to one that misses the other turns this red.
 *
 * Read from the TypeScript SOURCE, so it adds no production bytes: each site's test is located by name, found EXACTLY
 * as many times as expected (a renamed or merged site fails rather than passing unread), compiled with its types
 * stripped, and run over one table of values; the two must answer alike on every row. A planted hydration test with the
 * node exclusion removed must disagree, which shows the table can see a difference.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const parse = (file) => ts.createSourceFile(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const walk = (node, visit) => {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
};
/**
 * A condition's source, types stripped, as a function of `value`. The transpiler prepends a `"use strict"` prologue,
 * which `return` would hand back as the result (every row then throws alike, and agrees): it is cut first.
 */
const compile = (text) => {
  const js = ts.transpile(`(value) => (${text})`, { target: ts.ScriptTarget.ES2022 }).replace(/^"use strict";\s*/, '').trim().replace(/;$/, '');
  const fn = new Function(`return ${js}`)();
  assert.equal(typeof fn, 'function', `compiled to a function: ${js}`);
  return fn;
};

/** The renderer: the `if`s in `ChildPart.$p` that return `this._commitList(…)`. A value is a list when either holds. */
const rendererTest = () => {
  const sf = parse('packages/renderer/src/renderer.ts');
  const methods = [];
  walk(sf, (n) => {
    if (ts.isClassDeclaration(n) && n.name?.text === 'ChildPart')
      for (const m of n.members) if (ts.isMethodDeclaration(m) && m.name.getText(sf) === '$p') methods.push(m);
  });
  assert.equal(methods.length, 1, 'ChildPart.$p found exactly once');
  const conditions = [];
  walk(methods[0].body, (n) => {
    if (!ts.isIfStatement(n) || !ts.isReturnStatement(n.thenStatement)) return;
    const call = n.thenStatement.expression;
    if (call && ts.isCallExpression(call) && call.expression.getText(sf) === 'this._commitList') conditions.push(n.expression.getText(sf));
  });
  assert.equal(conditions.length, 2, '$p: two list tests (the array, then any other iterable)');
  return compile(conditions.map((c) => `(${c})`).join(' || '));
};

/** Hydration: the one `if` in `adoptObject` whose condition asks `Array.isArray`. */
const hydrationSource = () => {
  const sf = parse('packages/renderer/src/hydration.ts');
  const fns = [];
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'adoptObject' && n.initializer && ts.isArrowFunction(n.initializer)) fns.push(n.initializer);
  });
  assert.equal(fns.length, 1, 'adoptObject found exactly once');
  const conditions = [];
  walk(fns[0].body, (n) => {
    if (ts.isIfStatement(n) && n.expression.getText(sf).includes('Array.isArray')) conditions.push(n.expression.getText(sf));
  });
  assert.equal(conditions.length, 1, 'adoptObject: one list test');
  return conditions[0];
};

const { window } = new JSDOM('<!doctype html><body><p>a</p><p>b</p><select><option>x</option></select><form></form></body>');
const doc = window.document;
/** Every row: a label and a value. Primitives and `null` cannot reach either site, which test objects only; asked anyway. */
const ROWS = [
  ['an array', [1, 2]],
  ['an empty array', []],
  ['a Set', new Set([1])],
  ['a Map', new Map([[1, 2]])],
  ['a string', 'ab'],
  ['a String object', new String('ab')],
  ['an arguments object', (function () { return arguments; })(1, 2)],
  ['a NodeList', doc.querySelectorAll('p')],
  ['a generator', (function* () { yield 1; })()],
  ['a DOM node', doc.createElement('div')],
  ['a <select> (an iterable node)', doc.querySelector('select')],
  ['a <form> (an iterable node)', doc.querySelector('form')],
  ['an iterable with nodeType', { nodeType: 1, *[Symbol.iterator]() { yield 1; } }],
  ['null', null],
  ['a plain object', { a: 1 }],
  ['a Symbol.iterator returning a non-iterator', { [Symbol.iterator]: () => 1 }],
];
/** The answer, or `'throws'`: both sites must agree on that too. */
const answer = (fn, value) => {
  try {
    return Boolean(fn(value));
  } catch {
    return 'throws';
  }
};
const table = (a, b) => ROWS.map(([label, value]) => [label, answer(a, value), answer(b, value)]);

test('rendering and hydration classify every value as a list, or not, alike', () => {
  const rows = table(rendererTest(), compile(hydrationSource()));
  const differ = rows.filter(([, r, h]) => r !== h);
  assert.deepEqual(differ, [], 'rows where the renderer and hydration disagree');
  /** The table must hold both answers, or agreement says nothing. */
  assert.ok(rows.some(([, r]) => r === true) && rows.some(([, r]) => r === false), 'the table has lists and non-lists');
});

test('control: a hydration test without the node exclusion disagrees', () => {
  const source = hydrationSource();
  const planted = source.replace(/\s*&&\s*\(value as Node\)\.nodeType === undefined/, '');
  assert.notEqual(planted, source, 'the plant changed the source');
  const differ = table(rendererTest(), compile(planted)).filter(([, r, h]) => r !== h);
  assert.ok(differ.length > 0, 'the planted test disagrees on some row');
});
