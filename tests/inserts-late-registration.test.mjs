/**
 * **A `'store'` insert wired after a store was created still reaches it — the import-order case.**
 *
 * A store module (batching, transactions, persistence, devtools) is consulted when a store first
 * meets a value and decides, once, how that value is reactive. The ordinary way to get this wrong is
 * import order: `store.js` runs `createStore(...)` at module scope, and it is imported before the entry
 * calls `wire`. If the decision were made at creation, the module wired a line later would never reach
 * the app's main store — registered, present in the registry, and silently never run.
 *
 * So a store decides on **first use**: its first read or write, which happens in a render, after
 * `wire`. What stays true is the other half of the rule, pinned here as well: a store already USED
 * before the module was wired keeps the handler it got — the decision is per value and final, which
 * is what keeps the seam off the hot path.
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
const observer = (label) => (value, handler) =>
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

test('a store module wired after a store was created reaches it, if it was not used yet', () => {
  core.wire({ on: 'store', fn: observer('first'), priority: 40 });
  seen.length = 0;
  void created.n;
  assert.deepEqual(seen, ['first:n'], 'the module-scope store took the module wired after it');
});

test('a store used before the module was wired keeps the handler it got', () => {
  seen.length = 0;
  void used.u;
  assert.deepEqual(seen, [], 'decided on first use, and final');
});

test('two store modules compose in priority order', () => {
  core.wire({ on: 'store', fn: observer('second'), priority: 41 });
  const later = core.createStore({ z: 3 });
  seen.length = 0;
  void later.z;
  /** The second wraps the first, so it sees the read first and hands it on. */
  assert.deepEqual(seen, ['second:z', 'first:z'], 'each wraps the handler chosen before it');
});
