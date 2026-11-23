/**
 * **No hot function makes a closure over its own variables** (Brian, 2026-10-31: the hot-path read-through, automated
 * where it can be). A function whose parameter, local or `this` is captured by a nested arrow or function allocates that
 * environment on EVERY call, whichever branch runs (CLAUDE.md's hot-function rule): measured 2026-10-01 on the SSR
 * serializer (V8), and 2026-10-31 on `computed`'s getter, whose rarely-taken watch branch made every cached read 31%
 * slower in Firefox and 33% in WebKit. A closure that is needed goes in a separate function the hot one calls.
 *
 * Read from the TypeScript SOURCE (names intact), each hot function located by name, and found EXACTLY as many times as
 * listed (an accessor pair is two): a renamed or merged function fails rather than passing unread. Planted sources prove
 * the check fires and stays quiet. **Refuse-all**: a closure on a cold branch is still the tax (the getter's was on the
 * branch a cached read never takes), so an exception goes in `ALLOWED` with its reason and the race that priced it.
 *
 * **The work is split with the IIFE counter** (`tests/iife-count.mjs`): this guard reads the SOURCE's closures; what the
 * PRODUCTION minifier adds (a one-caller helper pasted as a function invoked where it stands) is that counter's, pinned
 * per bundle by the brick gate. Neither sees the other's half.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** file → the hot functions in it: a `const name = (…) => …`, a `function name`, or `object.member` for a literal's method or accessor. */
const HOT = {
  'packages/core/src/services/identity.ts': ['cached', 'dataRecord'],
  'packages/core/src/services/track.ts': ['track', 'wake', 'trigger', 'triggerAt', 'operation'],
  'packages/core/src/services/traps.ts': ['handler.get', 'handler.set', 'handler.has', 'handler.ownKeys', 'handler.deleteProperty', 'arrayHandler.get', 'resized'],
  'packages/core/src/store/store.ts': ['unlinkFrom', 'compactCell', 'placeAt', 'grow', 'claim', 'readerAt', 'slotAt'],
  'packages/core/src/modules/scheduler.ts': ['enqueue', 'drain', 'regroup'],
  /** A hook's run and its notification: every write that reaches a hook goes through `$n`, every flushed run through `$t`. */
  'packages/core/src/modules/createHook.ts': ['HookState.run', 'HookState.$n', 'HookState.$t'],
  'packages/core/src/modules/computed.ts': ['Computed.value'],
  /**
   * The lite tier (2026-11-17): every instance, commit, list item and queued render. Its part FACTORIES (`childPart`,
   * `attrPart`, `solePart`, `textPart`) return a closure by design and are not listed: the closure is the part.
   */
  'packages/lite/src/patch.ts': ['instantiate', 'commit', 'makeItem', 'updateItem'],
  'packages/lite/src/schedule.ts': ['render', 'queue', 'flush'],
  /** The server's scan (2026-11-19): every static at compile, and every `.innerHTML` value on every render. */
  'packages/ssr/src/vera/tokenizer.ts': ['scanTag', 'closerAt'],
  'packages/ssr/src/vera/select.ts': ['elementById', 'mayHoldId'],
};
/** How many functions a listed name is (1 unless an accessor pair). */
const COUNT = {};
/** `file name` → the reason and the race that priced a capture kept anyway. Empty: none is. */
const ALLOWED = {
  'packages/core/src/services/track.ts operation':
    'it RETURNS the sender closure, by design; what the sender captures sits in a block, made only when the block runs, so the early return allocates nothing (in function scope it cost +12–15%, 12/12, measured; the source comment).',
};
/**
 * `file name` → a capture KNOWN to be a defect, kept visible until its fix lands (reported as a todo, never a pass):
 * the base's cleanup removes each one in its file's pass and deletes the entry with it.
 */
const KNOWN_RED = {
};

const isFn = (n) => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n);

/** Every hot function node in a source file, by its listed name (an accessor name may match a getter AND a setter). */
const locate = (sf, names) => {
  const found = new Map(names.map((n) => [n, []]));
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if (found.has(node.name.text) && isFn(init)) found.get(node.name.text).push(init);
      if (ts.isObjectLiteralExpression(init))
        for (const p of init.properties) {
          const key = `${node.name.text}.${p.name && ts.isIdentifier(p.name) ? p.name.text : '?'}`;
          if (!found.has(key)) continue;
          if (isFn(p)) found.get(key).push(p);
          else if (ts.isPropertyAssignment(p) && isFn(p.initializer)) found.get(key).push(p.initializer);
        }
    }
    if (ts.isFunctionDeclaration(node) && node.name && found.has(node.name.text)) found.get(node.name.text).push(node);
    /** `Class.member`: a class's method or accessor. */
    if (ts.isClassDeclaration(node) && node.name)
      for (const m of node.members) {
        const key = `${node.name.text}.${m.name && ts.isIdentifier(m.name) ? m.name.text : '?'}`;
        if (found.has(key) && isFn(m)) found.get(key).push(m);
      }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
};

/** The names a function declares at its own level: parameters and the variables of its body, not of nested functions. */
const ownNames = (fn) => {
  const names = new Set();
  const bind = (b) => {
    if (ts.isIdentifier(b)) names.add(b.text);
    else if (ts.isObjectBindingPattern(b) || ts.isArrayBindingPattern(b)) for (const e of b.elements) if (!ts.isOmittedExpression(e)) bind(e.name);
  };
  for (const p of fn.parameters) bind(p.name);
  const walk = (node) => {
    if (node !== fn && isFn(node)) return;
    if (ts.isVariableDeclaration(node)) bind(node.name);
    if (ts.isCatchClause(node) && node.variableDeclaration) bind(node.variableDeclaration.name);
    ts.forEachChild(node, walk);
  };
  if (fn.body) walk(fn.body);
  return names;
};

/** The captures in `fn`: each nested function that references one of `fn`'s own names (not re-declared by itself), or `this`. */
const captures = (fn) => {
  const outer = ownNames(fn);
  const out = [];
  const nested = (node) => {
    if (node !== fn && isFn(node)) {
      const inner = ownNames(node);
      const hits = new Set();
      const refs = (n) => {
        if (ts.isIdentifier(n) && outer.has(n.text) && !inner.has(n.text)) {
          const p = n.parent;
          /** A property NAME (`x.name`, `{ name: … }`) is not a reference to a variable. */
          const isName = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n);
          if (!isName) hits.add(n.text);
        }
        if (n.kind === ts.SyntaxKind.ThisKeyword && ts.isArrowFunction(node) && !ts.isArrowFunction(fn)) hits.add('this');
        ts.forEachChild(n, refs);
      };
      ts.forEachChild(node, refs);
      if (hits.size) out.push(`${[...hits].join(', ')} (line ${node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1})`);
      return;
    }
    ts.forEachChild(node, nested);
  };
  ts.forEachChild(fn, nested);
  return out;
};

const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

test('CONTROL: a planted capture is found; a closure in a separate function and a nested function using only its own names are not', () => {
  const planted = parse('p.ts', `
    const hot = (box: { a: number }) => { if (box.a) watch(() => box.a); return box.a; };
    const cool = (box: { a: number }) => { if (box.a) separate(box); return box.a; };
    const separate = (box: { a: number }) => watch(() => box.a);
    const own = (n: number) => { const f = (n: number) => n + 1; return f(n); };
    const O = { get value() { const self = this; return [1].map((x) => x + self.k); } };
    const P = { get value() { return [1].map((x) => x + this.k); } };
    class C { get value() { const v = this.v; return [1].map((x) => x + v); } run() { return this.v; } }`);
  const found = locate(planted, ['hot', 'cool', 'own', 'O.value', 'P.value', 'C.value', 'C.run']);
  assert.deepEqual(captures(found.get('C.value')[0]).map((c) => c.split(' ')[0]), ['v'], 'a class getter is located and its capture found');
  assert.deepEqual(captures(found.get('C.run')[0]), []);
  assert.deepEqual(captures(found.get('hot')[0]).map((c) => c.split(' ')[0]), ['box']);
  assert.deepEqual(captures(found.get('cool')[0]), []);
  assert.deepEqual(captures(found.get('own')[0]), [], 'a nested function re-declaring the name captures nothing');
  assert.deepEqual(captures(found.get('O.value')[0]).map((c) => c.split(' ')[0]), ['self']);
  assert.deepEqual(captures(found.get('P.value')[0]).map((c) => c.split(' ')[0]), ['this']);
});

for (const [file, names] of Object.entries(HOT))
  test(`${file}: ${names.join(', ')} capture nothing of their own`, (t) => {
    const sf = parse(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    const found = locate(sf, names);
    for (const [name, fns] of found) {
      assert.equal(fns.length, COUNT[name] ?? 1, `CONTROL: ${name} found exactly ${COUNT[name] ?? 1}× in ${file} (renamed or merged? update the list)`);
      if (ALLOWED[`${file} ${name}`]) continue;
      const known = KNOWN_RED[`${file} ${name}`];
      if (known) {
        const found = fns.flatMap(captures);
        assert.ok(found.length > 0, `${file} ${name} is on KNOWN_RED but captures nothing now: remove its entry`);
        t.todo(`KNOWN RED ${name}: ${found.join('; ')} — ${known}`);
        continue;
      }
      for (const fn of fns) assert.deepEqual(captures(fn), [], `${file} ${name}: a nested closure captures its variables`);
    }
  });
