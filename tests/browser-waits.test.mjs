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
/**
 * A local sleep helper, as `[name, delay]`: `const settle = (ms) => new Promise((r) => setTimeout(r, ms))` (delay null:
 * the caller's one argument) or `const settle = () => new Promise((r) => setTimeout(r, 80))` (the literal it fixes).
 */
const helperOf = (node) => {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer || !ts.isArrowFunction(node.initializer)) return null;
  const params = node.initializer.parameters;
  const delay = timerDelay(node.initializer.body);
  if (!delay) return null;
  if (params.length === 0) return ts.isNumericLiteral(delay) ? [node.name.text, delay] : null;
  return params.length === 1 && ts.isIdentifier(params[0].name) && delay.getText() === params[0].name.text ? [node.name.text, null] : null;
};
/** A timer bound to a name, as `[name, delay]`: `const past = new Promise((r) => setTimeout(r, 300))`, awaited later. */
const timerOf = (node) => {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return null;
  const delay = timerDelay(node.initializer);
  return delay && ts.isNumericLiteral(delay) ? [node.name.text, delay] : null;
};
/** The delay of a statement that is exactly a fixed sleep, or null: `await new Promise((r) => setTimeout(r, N))`, a call
 *  to a helper in `helpers` (`await settle(N)`, or `await settle()` for one that fixes its delay), or `await past` for a
 *  timer bound in `timers`. */
const sleepOf = (statement, helpers, timers) => {
  const e = ts.isExpressionStatement(statement) && ts.isAwaitExpression(statement.expression) ? statement.expression.expression : null;
  if (e && ts.isIdentifier(e) && timers.has(e.text)) return Number(timers.get(e.text).text);
  const name = e && ts.isCallExpression(e) && ts.isIdentifier(e.expression) && helpers.has(e.expression.text) ? e.expression.text : null;
  const fixed = name ? helpers.get(name) : null;
  const delay = name === null ? timerDelay(e)
    : fixed ? (e.arguments.length === 0 ? fixed : null)
    : e.arguments.length === 1 ? e.arguments[0] : null;
  return delay && ts.isNumericLiteral(delay) ? Number(delay.text) : null;
};
const isExpect = (statement) => {
  if (!ts.isExpressionStatement(statement)) return false;
  let e = statement.expression;
  while (ts.isCallExpression(e) || ts.isPropertyAccessExpression(e)) e = e.expression;
  return ts.isIdentifier(e) && e.text === 'expect';
};

/** An expect anywhere inside `node`. */
const asserts = (node) => isExpect(node) || (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'expect') || ts.forEachChild(node, asserts) === true;

/** The waits that end a sleep's reach: until, ever, failedLoad and whenDefined by name, and a promise that is not a timer (an event). */
const EVENT_WAITS = new Set(['until', 'ever', 'whenDefined', 'failedLoad']);
const waitsForEvent = (statement, helpers) => {
  const e = ts.isExpressionStatement(statement) && ts.isAwaitExpression(statement.expression) ? statement.expression.expression
    : ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1 && statement.declarationList.declarations[0].initializer
      && ts.isAwaitExpression(statement.declarationList.declarations[0].initializer) ? statement.declarationList.declarations[0].initializer.expression
    : null;
  if (!e) return false;
  if (ts.isNewExpression(e)) return e.expression.getText() === 'Promise' && timerDelay(e) === null;
  if (!ts.isCallExpression(e)) return false;
  const callee = ts.isIdentifier(e.expression) ? e.expression.text : ts.isPropertyAccessExpression(e.expression) ? e.expression.name.text : null;
  return callee !== null && EVENT_WAITS.has(callee) && !helpers.has(callee);
};

/** Each refused construct in `text`: `line: what`. */
export const timedWaits = (text, name = 'x.js') => {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = [];
  const line = (node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const helpers = new Map();
  const timers = new Map();
  const collect = (node) => {
    const helper = helperOf(node);
    if (helper) helpers.set(...helper);
    const timer = timerOf(node);
    if (timer) timers.set(...timer);
    ts.forEachChild(node, collect);
  };
  collect(file);
  const visit = (node) => {
    const named = (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name) ? node.name.text : null;
    if (named === 'until') found.push(`${line(node)}: a local until`);
    const statements = ts.isBlock(node) || ts.isSourceFile(node) ? node.statements : null;
    if (statements)
      statements.forEach((s, i) => {
        const delay = sleepOf(s, helpers, timers);
        if (!(delay > 0)) return;
        /** Every later statement of the block, nested blocks included, up to the first wait for an event. */
        for (const next of statements.slice(i + 1)) {
          if (waitsForEvent(next, helpers)) return;
          if (asserts(next)) return void found.push(`${line(s)}: a ${delay} ms sleep, then an expect`);
        }
      });
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
};

const files = execFileSync('git', ['ls-files', '--', 'tests/browser/*.js'], { encoding: 'utf8' }).split('\n').filter(Boolean);

/**
 * **A deliberate timer, pinned.** A row whose claim is that time passed (a persist window, a debounce, a sentinel timer
 * queued after the test's own) sleeps on purpose. Each is pinned by its file, its sleep's line and that line's exact text,
 * with its reason: an entry that no longer names a refused sleep is stale and refused, so a pin cannot outlive its row.
 */
const ALLOWED = [
  // ['tests/browser/x.test.js', 12, 'await new Promise((r) => setTimeout(r, 300));', 'the reason'],
];

test('no browser test defines its own until or sleeps a fixed time before an expect', () => {
  assert.ok(files.length >= 100 && files.includes('tests/browser/until.js'), `CONTROL: ${files.length} browser test files`);
  const texts = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
  const hits = files.filter((f) => f !== 'tests/browser/until.js').flatMap((f) => timedWaits(texts.get(f), f).map((hit) => ({ f, at: Number(hit.split(':')[0]), hit })));
  const pinned = ({ f, at }) => ALLOWED.some(([file, line, text]) => file === f && line === at && texts.get(f).split('\n')[at - 1].trim() === text);
  const stale = ALLOWED.filter(([file, line, text]) => texts.get(file)?.split('\n')[line - 1]?.trim() !== text || !hits.some((h) => h.f === file && h.at === line));
  assert.deepEqual(stale.map(([file, line]) => `${file}:${line}`), [], 'an ALLOWED pin no longer names a refused sleep at that line and text: update or delete it');
  assert.deepEqual(hits.filter((h) => !pinned(h)).map(({ f, hit }) => `${f}:${hit}`), [], 'wait with until() from ./until.js for the event, or for a sentinel shown to have fired');
});

test('the reader refuses each shape and passes a poll, a yield, an event and an until (planted)', () => {
  const sleep = (n) => `await new Promise((r) => setTimeout(r, ${n}));`;
  const helper = 'const settle = (ms) => new Promise((r) => setTimeout(r, ms));\n';
  /** The four refused shapes: directly before, later in the block, inside a nested block, through a helper. */
  assert.deepEqual(timedWaits(`it('a', async () => {\n${sleep(200)}\nexpect(window.n).to.equal(0);\n});`), ['2: a 200 ms sleep, then an expect']);
  assert.deepEqual(timedWaits(`it('a', async () => {\n${sleep(120)}\nconst v = read();\nexpect(v, 'b').to.be.true;\n});`), ['2: a 120 ms sleep, then an expect']);
  assert.deepEqual(timedWaits(`it('a', async () => {\n${sleep(50)}\nfor (const x of xs) {\n  expect(x).to.equal(0);\n}\n});`), ['2: a 50 ms sleep, then an expect']);
  assert.deepEqual(timedWaits(`${helper}it('a', async () => {\nawait settle(700);\nexpect(a).to.equal(0);\n});`), ['3: a 700 ms sleep, then an expect']);
  /** A helper that fixes its own delay, the shape seven files used. */
  const fixed = 'const settle = () => new Promise((r) => setTimeout(r, 80));\n';
  assert.deepEqual(timedWaits(`${fixed}it('a', async () => {\nawait settle();\nexpect(a).to.equal(0);\n});`), ['3: a 80 ms sleep, then an expect']);
  assert.deepEqual(timedWaits(`const tick = () => new Promise((r) => setTimeout(r, 0));\nit('a', async () => {\nawait tick();\nexpect(a).to.equal(0);\n});`), [], 'a fixed zero-delay helper yields');
  /** A timer bound to a name and awaited later, reported at the await. */
  assert.deepEqual(timedWaits(`it('a', async () => {\nconst past = new Promise((r) => setTimeout(r, 300));\nwork();\nawait past;\nexpect(a).to.equal(0);\n});`), ['4: a 300 ms sleep, then an expect']);
  assert.deepEqual(timedWaits(`it('a', async () => {\nconst ready = new Promise((r) => el.addEventListener('load', r));\nawait ready;\nexpect(a).to.equal(0);\n});`), [], 'a bound event promise is not a sleep');
  /** A frame is not an event wait: a sleep before it still reaches the expect after it. */
  assert.deepEqual(timedWaits(`it('a', async () => {\n${sleep(300)}\nawait frames(2);\ncheck(() => expect(a).to.equal(0));\n});`), ['2: a 300 ms sleep, then an expect']);
  assert.deepEqual(timedWaits('const until = async () => {};'), ['1: a local until']);
  assert.deepEqual(timedWaits('async function until() {}'), ['1: a local until']);
  for (const near of [
    `it('a', async () => {\n${sleep(0)}\nexpect(a).to.equal(1);\n});`,
    `${helper}it('a', async () => {\nawait settle(0);\nexpect(a).to.equal(0);\n});`,
    `const read = (x) => compute(x);\nit('a', async () => {\nawait read(700);\nexpect(a).to.equal(0);\n});`,
    `it('a', async () => {\n${sleep(100)}\nawait until(() => a, 'a', 1000);\nexpect(a).to.equal(1);\n});`,
    `it('a', async () => {\n${sleep(100)}\nconst seen = await ever(() => a, 900);\nexpect(seen).to.equal(true);\n});`,
    `it('a', async () => {\n${sleep(100)}\nawait new Promise((r) => el.addEventListener('load', r));\nexpect(a).to.equal(1);\n});`,
    `it('a', async () => {\n${sleep(100)}\nawait customElements.whenDefined('x-a');\nexpect(a).to.equal(1);\n});`,
    `it('a', async () => {\nawait frames(2);\nexpect(a).to.equal(1);\n});`,
    `it('a', async () => {\nfor (;;) { if (a) break; ${sleep(10)} }\nexpect(a).to.equal(1);\n});`,
    `it('a', async () => {\n${sleep(50)}\nconst b = read();\n});`,
  ])
    assert.deepEqual(timedWaits(near), [], near);
});
