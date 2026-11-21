/**
 * **A browser test waits for an event, never for a time** (2026-11-20). Two tests flaked on a loaded Windows machine,
 * and both had one shape: sleep a fixed time, then assert. One slept 200 ms for an image's `onerror` and read the
 * handler as not run; the other sampled a transition once at 120 ms. When the assertion is that something did NOT
 * happen, a fixed sleep cannot even fail: a late event lands in a later test instead. Read from a parse of every file in
 * tests/browser:
 *
 * - no file defines its own `until` (tests/browser/until.js is the one: `until(predicate, what, timeout)`);
 * - no statement that sleeps a fixed time (`await new Promise((r) => setTimeout(r, N))`, N > 0, or `await settle(N)`
 *   through a local helper of that shape) is followed directly by an `expect(…)`. Wait for the event with `until`, or, for an absence, for a sentinel shown to have fired. A
 *   zero-delay yield orders tasks and measures no time, so it passes; so does `frames()`, a paint.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** The delay argument of `new Promise((r) => setTimeout(r, delay))`, or null. */
const timerDelay = (e) => {
  if (!e || !ts.isNewExpression(e) || e.expression.getText() !== 'Promise') return null;
  const [executor] = e.arguments ?? [];
  if (!executor || !(ts.isArrowFunction(executor) || ts.isFunctionExpression(executor))) return null;
  const call = ts.isCallExpression(executor.body) ? executor.body : null;
  if (!call || call.expression.getText() !== 'setTimeout' || call.arguments.length !== 2) return null;
  return call.arguments[1];
};
/** A local sleep helper: `const settle = (ms) => new Promise((r) => setTimeout(r, ms))`, its delay its one parameter. */
const helperOf = (node) => {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer || !ts.isArrowFunction(node.initializer)) return null;
  const [param, ...rest] = node.initializer.parameters;
  const delay = timerDelay(node.initializer.body);
  return param && rest.length === 0 && delay && ts.isIdentifier(param.name) && delay.getText() === param.name.text ? node.name.text : null;
};
/** The delay of a statement that is exactly a fixed sleep, or null: `await new Promise((r) => setTimeout(r, N))`, or
 *  `await settle(N)` through a helper in `helpers`. */
const sleepOf = (statement, helpers) => {
  const e = ts.isExpressionStatement(statement) && ts.isAwaitExpression(statement.expression) ? statement.expression.expression : null;
  const delay = e && ts.isCallExpression(e) && ts.isIdentifier(e.expression) && helpers.has(e.expression.text) && e.arguments.length === 1
    ? e.arguments[0]
    : timerDelay(e);
  return delay && ts.isNumericLiteral(delay) ? Number(delay.text) : null;
};
const isExpect = (statement) => {
  if (!ts.isExpressionStatement(statement)) return false;
  let e = statement.expression;
  while (ts.isCallExpression(e) || ts.isPropertyAccessExpression(e)) e = e.expression;
  return ts.isIdentifier(e) && e.text === 'expect';
};

/** Each refused construct in `text`: `line: what`. */
export const timedWaits = (text, name = 'x.js') => {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = [];
  const line = (node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const helpers = new Set();
  const collect = (node) => {
    const name = helperOf(node);
    if (name) helpers.add(name);
    ts.forEachChild(node, collect);
  };
  collect(file);
  const visit = (node) => {
    const named = (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name) ? node.name.text : null;
    if (named === 'until') found.push(`${line(node)}: a local until`);
    const statements = ts.isBlock(node) || ts.isSourceFile(node) ? node.statements : null;
    if (statements)
      statements.forEach((s, i) => {
        const delay = sleepOf(s, helpers);
        if (delay > 0 && statements[i + 1] && isExpect(statements[i + 1])) found.push(`${line(s)}: a ${delay} ms sleep, then an expect`);
      });
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
};

const files = execFileSync('git', ['ls-files', '--', 'tests/browser/*.js'], { encoding: 'utf8' }).split('\n').filter(Boolean);

test('no browser test defines its own until or sleeps a fixed time before an expect', () => {
  assert.ok(files.length >= 100 && files.includes('tests/browser/until.js'), `CONTROL: ${files.length} browser test files`);
  const found = files.filter((f) => f !== 'tests/browser/until.js').flatMap((f) => timedWaits(readFileSync(f, 'utf8'), f).map((hit) => `${f}:${hit}`));
  assert.deepEqual(found, [], 'wait with until() from ./until.js for the event, or for a sentinel shown to have fired');
});

test('the reader refuses each shape and passes a poll, a yield and a frame (planted)', () => {
  const sleep = (n) => `await new Promise((r) => setTimeout(r, ${n}));`;
  assert.deepEqual(timedWaits(`it('a', async () => {\n${sleep(200)}\nexpect(window.n).to.equal(0);\n});`), ['2: a 200 ms sleep, then an expect']);
  assert.deepEqual(timedWaits(`it('a', async () => {\n${sleep(120)}\nexpect(a, 'b').to.be.true;\n});`), ['2: a 120 ms sleep, then an expect']);
  const helper = 'const settle = (ms) => new Promise((r) => setTimeout(r, ms));\n';
  assert.deepEqual(timedWaits(`${helper}it('a', async () => {\nawait settle(700);\nexpect(a).to.equal(0);\n});`), ['3: a 700 ms sleep, then an expect']);
  assert.deepEqual(timedWaits(`${helper}it('a', async () => {\nawait settle(0);\nexpect(a).to.equal(0);\n});`), [], 'a zero-delay helper call yields');
  assert.deepEqual(timedWaits(`const read = (x) => compute(x);\nit('a', async () => {\nawait read(700);\nexpect(a).to.equal(0);\n});`), [], 'a call to a non-sleeping helper');
  assert.deepEqual(timedWaits('const until = async () => {};'), ['1: a local until']);
  assert.deepEqual(timedWaits('async function until() {}'), ['1: a local until']);
  for (const near of [
    `it('a', async () => {\n${sleep(0)}\nexpect(a).to.equal(1);\n});`,
    `it('a', async () => {\nawait until(() => a, 'a', 1000);\nexpect(a).to.equal(1);\n});`,
    `it('a', async () => {\nawait frames(2);\nexpect(a).to.equal(1);\n});`,
    `it('a', async () => {\nfor (;;) { if (a) break; ${sleep(10)} }\nexpect(a).to.equal(1);\n});`,
    `it('a', async () => {\n${sleep(50)}\nconst b = read();\n});`,
  ])
    assert.deepEqual(timedWaits(near), [], near);
});
