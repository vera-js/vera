/**
 * Migrated from the audit-session verification suites (scratchpad, 2026-08-20). Tests BUILT
 * artifacts, development AND production (see ./dist.mjs), so build defects fail here too. Plain pass/fail scripts under
 * node --test: a nonzero exit marks the file failed.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="host"></div>');
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.document = dom.window.document;
const host = dom.window.document.getElementById('host');
const core = await load('core');
const { batch, batching } = await import(new URL('../examples/cdn-js/src/inserts/batch.js', import.meta.url).href);
const { errorBoundary } = await import(new URL('../examples/cdn-js/src/inserts/error-boundary.js', import.meta.url).href);
let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : (fail++, console.log('FAIL:', n)); };

core.wire({ on: 'set-handler', fn: batching, priority: 50 });
const state = core.createStore({ a: 0, b: 0 });
let syncRuns = 0, lastA = -1;
core.createHook({ element: host, priority: 60, callback: () => { syncRuns++; lastA = state.a; state.b; } });
[...host._hooks[0]][0](undefined, true);
const r0 = syncRuns;

batch(() => { state.a = 1; state.b = 2; state.a = 3; });
check('batch: 3 writes -> flush per property (2 runs), final values', syncRuns === r0 + 2 && lastA === 3);
batch(() => { state.a = 3; });
check('batch: no-op write flushes nothing', syncRuns === r0 + 2);
state.a = 4;
check('outside batch: default propagation intact', syncRuns === r0 + 3);
batch(() => { batch(() => { state.a = 5; }); state.b = 9; });
check('nested batches join, one flush', syncRuns === r0 + 5 && lastA === 5);

core.wire({ on: 'error', fn: errorBoundary, priority: 50 });
const el = dom.window.document.createElement('div');
dom.window.document.body.appendChild(el);
const oe = console.error; console.error = () => {};
core.createHook({ element: el, priority: 60, callback: () => { throw new Error('boom'); } });
[...el._hooks[0]][0](undefined, true);
console.error = oe;
check('error boundary renders fallback with role=alert', el.querySelector('[role="alert"]')?.textContent.includes('wrong'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
