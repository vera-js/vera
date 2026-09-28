/**
 * **A `'store'` insert reaches every store, whenever it is wired — the import-order case and beyond.**
 *
 * A store module (batching, transactions, persistence, devtools) decides how a TYPE of value is
 * reactive. The ordinary way to get wiring wrong is import order: `store.js` runs `createStore(...)` at
 * module scope, imported before the entry calls `wire` — and a store may be read before that too. If
 * the decision were made per store and kept, the module wired a line later would never reach the app's
 * main store: registered, present in the registry, and silently never run.
 *
 * So every proxy of a type shares one handler core owns, and `wire` decides every type again INTO those
 * handlers: a module wired late reaches stores created before it, used before it, and stores that
 * already took an earlier module. This replaced a first-use rule (2026-09-28) under which a store
 * already used before the module was wired kept its handler — and paid seven placeholder closures each.
 *
 * This file used to hold the `'proxy-handler'` chain's cache to the same promise, through the
 * registry's `revision`; both retired with the per-read chain (2026-09-27).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame',
])
  globalThis[key] = dom.window[key];

const core = await load('core');

/** Created at "module scope", before anything is wired, and not used yet. */
const created = core.createStore({ n: 1 });
/** Created AND used before anything is wired. */
const used = core.createStore({ u: 1 });
void used.u;

const seen = [];
/** A store module that observes reads by wrapping core's `get`. */
const observer = (label) => (type, handler) =>
  handler?.get && {
    ...handler,
    get(obj, prop, receiver) {
      seen.push(`${label}:${String(prop)}`);
      return handler.get(obj, prop, receiver);
    },
  };

test('nothing observes a read before a store module is wired — the control', () => {
  void used.u;
  assert.deepEqual(seen, []);
});

test('a store module wired after a store was created reaches it', () => {
  core.wire({ on: 'store', fn: observer('first'), priority: 40 });
  seen.length = 0;
  void created.n;
  assert.deepEqual(seen, ['first:n'], 'the module-scope store took the module wired after it');
});

test('and reaches a store that was already USED before it was wired', () => {
  seen.length = 0;
  void used.u;
  assert.deepEqual(seen, ['first:u'], 'no per-store decision to keep — the type decides, and wire re-decides it');
});

test('a second module wired later reaches existing stores too, composing in priority order', () => {
  core.wire({ on: 'store', fn: observer('second'), priority: 41 });
  seen.length = 0;
  void created.n;
  /** The second wraps the first, so it sees the read first and hands it on. */
  assert.deepEqual(seen, ['second:n', 'first:n'], 'each wraps the handler chosen before it');
  const later = core.createStore({ z: 3 });
  seen.length = 0;
  void later.z;
  assert.deepEqual(seen, ['second:z', 'first:z'], 'a new store takes both');
});

/**
 * A type nothing claims is transparent in a store — until a module claiming it is wired, when the same
 * store becomes reactive. `createStore(new Map())` at module scope, imported before the entry wires
 * `collections`, is the ordinary case.
 */
test('a store of a type nothing claimed yet takes the module that claims it, once wired', () => {
  const dates = core.createStore(new Date(0));
  seen.length = 0;
  assert.equal(typeof dates.getTime, 'function', 'CONTROL: transparent until claimed');
  core.wire({
    on: 'store',
    priority: 42,
    fn: (type, handler) => (type === 'date' ? { get: (obj, prop) => (seen.push(`date:${String(prop)}`), Reflect.get(obj, prop)) } : handler),
  });
  void dates.getTime;
  assert.deepEqual(seen, ['date:getTime'], 'the existing store now runs the claiming handler');
});
