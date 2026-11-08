/**
 * **Core's own handlers are the first link of its OWN door, never a page-wide insert.** The `'store'` chain is shared by
 * every copy of core on a page in development (the copies share one `@verajs/inserts`), so a default registered there by
 * one copy would replace another copy's, and that copy's stores would be decided to the wrong traps. Each copy hands its
 * door its own handlers at load instead, and every module still joins the shared chain after them.
 *
 * Rows: a store made before anything is wired is reactive (records, arrays, nested); two copies on one page each decide
 * to THEIR traps (each hears its own writes), with a module in the chain seen by both; the door refuses its own handlers
 * a second time in development, and production folds the check away.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { isProduction, load } from './dist.mjs';

const core = await load('core');
/** A second copy of core: its own module instance, as the other two-cores rows load it. */
const second = await load('core', '?copy=door-defaults');
/** A hook owner that is not an element: the effect API's documented form for code outside a component. */
const owned = (store, read) => {
  const seen = [];
  const run = core.effect(() => { seen.push(read(store)); }, { owner: {}, timing: 'sync' });
  run.run();
  return seen;
};

test('a store made before anything is wired is reactive: records, arrays and nested objects', () => {
  assert.equal(core.inserts.get('store')?.length ?? 0, 0, 'CONTROL: no module in the store chain yet');
  const s = core.createStore({ a: 1, list: [1, 2], o: { b: 1 } });
  const a = owned(s, (x) => x.a);
  const n = owned(s, (x) => x.list.length);
  const b = owned(s, (x) => x.o.b);
  s.a = 2;
  s.list.push(3);
  s.o.b = 2;
  assert.deepEqual([a, n, b], [[1, 2], [2, 3], [1, 2]]);
});

test("two copies of core on one page each decide to THEIR traps, and a module in the chain reaches both", () => {
  const one = core.createStore({ a: 1, list: [1] });
  const two = second.createStore({ a: 1, list: [1] });
  const seenOne = owned(one, (x) => `${x.a}/${x.list.length}`);
  const seenTwo = [];
  second.effect(() => { seenTwo.push(`${two.a}/${two.list.length}`); }, { owner: {}, timing: 'sync' }).run();
  one.a = 2;
  two.list.push(2);
  assert.deepEqual([seenOne, seenTwo], [['1/1', '2/1'], ['1/1', '1/2']], "each copy's write woke only its own reader");

  /**
   * A module claiming a type NEITHER copy has decided yet (`date`), so each copy's first decision of it comes after the
   * wire. In development ONE wire must reach both copies (they share one chain, after their own first links); in
   * production each bundle has its own registry, so it is wired into each, as a page loading both bundles would. (A type a
   * copy had ALREADY decided is re-decided only by that copy's own `wire`, which does not run when the shared chain did
   * not change: a known edge of two copies in development.)
   */
  let reads = 0;
  const dates = { on: 'store', priority: 50, fn: (type, handler) => (type === 'date' ? { get: (t, p) => { reads++; return Reflect.get(t, p); } } : handler) };
  core.wire(dates);
  if (isProduction) second.wire(dates);
  const d1 = core.createStore(Object.assign(new Date(0), { x: 1 }));
  const d2 = second.createStore(Object.assign(new Date(0), { x: 2 }));
  assert.equal(d1.x + d2.x, 3);
  assert.equal(reads, 2, "the module's handler served a read of each copy's store");
  one.a = 3;
  two.a = 3;
  assert.deepEqual([seenOne.at(-1), seenTwo.at(-1)], ['3/1', '3/2'], 'and each copy still decides to its own traps under it');
});

test('the door takes its own handlers once: a second hand-off throws in development, and production folds the check', () => {
  const bundle = (dev) =>
    buildSync({
      stdin: { contents: "import { useDefaults } from './packages/core/src/services/door.ts'; const f = () => undefined; useDefaults(f); useDefaults(f);", resolveDir: process.cwd(), loader: 'ts' },
      bundle: true, write: false, format: 'esm', platform: 'node', define: { __DEV__: String(dev) }, tsconfigRaw: '{}', logLevel: 'silent',
    }).outputFiles[0].text;
  const run = (code) => import(`data:text/javascript,${encodeURIComponent(code)}`);
  return Promise.all([
    assert.rejects(run(bundle(true)), /store-defaults-twice/, 'development refuses the second hand-off'),
    run(bundle(false)),
  ]);
});
