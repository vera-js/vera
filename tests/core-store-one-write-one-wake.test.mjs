/**
 * **One write wakes a hook once, however many of its channels the write changes.** A key added (or deleted, or defined
 * new) changes the key AND the key set; a hook that read both, as a render reads a field and lists the keys, runs once
 * per write, as it does for a whole-array method. CONTROL: an own key overwritten changes one channel and runs it once.
 *
 * **An array's single write is one wake too** (2026-11-23): a truncating `length = n` also drops the indices past `n`,
 * and every write to an array also changes its contents (`ITEMS`, the channel a list's walk subscribes to). Each of those
 * took a wake number of its own, so a `'sync'` effect or a watched `computed` that read `length` and a dropped index, or
 * an index and the walk, ran twice per write. A whole-array method (`splice`) is the control: it always sent one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const core = await load('core');
const { computed, createStore, effect } = core;
/** The walk a list render subscribes through (`ITEMS`), taken now: core's hand-off to the renderer. */
const walk = core.inserts.$w;
/** A sync hook reading `s.x` and the key set of `s`; returns how many times one `write` re-ran it. */
const runsOf = (initial, write) => {
  const s = createStore(initial);
  let runs = 0;
  effect(() => { void s.x; void Object.keys(s); runs++; }, { owner: {}, timing: 'sync' }).run();
  write(s);
  return runs - 1;
};

test('a key added, deleted or defined new runs a hook that read the key and the key set ONCE', () => {
  assert.equal(runsOf({}, (s) => { s.x = 2; }), 1, 'added');
  assert.equal(runsOf({ x: 1 }, (s) => { delete s.x; }), 1, 'deleted');
  assert.equal(runsOf({}, (s) => { Object.defineProperty(s, 'x', { value: 1, writable: true, enumerable: true, configurable: true }); }), 1, 'defined');
});

test('an index past the end runs a hook that read it, length and the key set ONCE', () => {
  const list = createStore({ l: ['a'] }).l;
  let runs = 0;
  effect(() => { void list[3]; void list.length; void Object.keys(list); runs++; }, { owner: {}, timing: 'sync' }).run();
  list[3] = 'd';
  assert.equal(runs - 1, 1);
});

test('CONTROL: an own key overwritten runs it once', () => {
  assert.equal(runsOf({ x: 1 }, (s) => { s.x = 2; }), 1);
});

/** A sync hook running `read` over an array store; returns how many times one `write` re-ran it and what it last read. */
const arrayRuns = (read, write) => {
  const list = createStore({ l: [1, 2, 3] }).l;
  let runs = 0;
  let seen;
  effect(() => { seen = read(list); runs++; }, { owner: {}, timing: 'sync' }).run();
  write(list);
  return `${runs - 1} ${JSON.stringify(seen)}`;
};
const lengthAndOne = (a) => [a.length, a[1]];
const walked = (a) => { const out = []; walk(a, (raw) => out.push(raw)); return out; };
const indexAndWalk = (a) => [a[0], walked(a)];

test("a truncating length runs a 'sync' hook that read length and a dropped index ONCE, and it reads the result", () => {
  assert.equal(arrayRuns(lengthAndOne, (a) => a.splice(0)), '1 [0,null]', 'CONTROL: splice(0)');
  assert.equal(arrayRuns(lengthAndOne, (a) => { a.length = 0; }), '1 [0,null]', 'length = 0');
  assert.equal(arrayRuns(lengthAndOne, (a) => { a.length = 1; }), '1 [1,null]', 'length = 1');
  assert.equal(arrayRuns(lengthAndOne, (a) => Object.defineProperty(a, 'length', { value: 1 })), '1 [1,null]', 'length defined shorter');
  /** A reader of the dropped index alone is still told. */
  assert.equal(arrayRuns((a) => a[2], (a) => { a.length = 1; }), '1 undefined', 'a dropped index alone');
  assert.equal(arrayRuns((a) => Object.keys(a).length, (a) => { a.length = 1; }), '1 1', 'the key set alone');
});

test("an array's single write runs a 'sync' hook that read an index and walked the list ONCE", () => {
  assert.equal(arrayRuns(indexAndWalk, (a) => a.push(4)), '1 [1,[1,2,3,4]]', 'CONTROL: push');
  assert.equal(arrayRuns(indexAndWalk, (a) => { a[0] = 9; }), '1 [9,[9,2,3]]', 'an index written');
  assert.equal(arrayRuns(indexAndWalk, (a) => { a[3] = 4; }), '1 [1,[1,2,3,4]]', 'an index written past the end');
  assert.equal(arrayRuns(indexAndWalk, (a) => { delete a[0]; }), '1 [null,[null,2,3]]', 'an index deleted');
  assert.equal(arrayRuns(indexAndWalk, (a) => Object.defineProperty(a, 0, { value: 9 })), '1 [9,[9,2,3]]', 'an index defined');
  assert.equal(arrayRuns(indexAndWalk, (a) => { a.length = 1; }), '1 [1,[1]]', 'length = 1');
  /** The walk alone is still told. */
  assert.equal(arrayRuns(walked, (a) => { a[1] = 7; }), '1 [1,7,3]', 'the walk alone');
});

test('a watched computed that read length and a dropped index evaluates ONCE per truncating write', () => {
  const list = createStore({ l: [1, 2, 3] }).l;
  let evaluations = 0;
  const c = computed(() => { evaluations++; return `${list.length}:${list[1]}`; });
  let seen;
  effect(() => { seen = c.value; }, { owner: {}, timing: 'sync' }).run();
  const before = evaluations;
  list.length = 0;
  assert.equal(`${evaluations - before} ${seen}`, '1 0:undefined');
});
