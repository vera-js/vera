/**
 * Migrated from the audit-session verification suites (scratchpad, 2026-08-20). Tests BUILT
 * artifacts, development AND production (see ./dist.mjs), so build defects fail here too. Plain pass/fail scripts under
 * node --test: a nonzero exit marks the file failed.
 */
import { load } from './dist.mjs';
const core = await load('core');
const { computed, computedValues } = await import(new URL('../examples/cdn-js/src/inserts/computed.js', import.meta.url).href);
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<div id="host"></div>');
globalThis.HTMLElement = dom.window.HTMLElement;
const host = dom.window.document.getElementById('host');
let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : (fail++, console.log('FAIL:', n)); };

core.wire({ on: 'proxy-handler', fn: computedValues, priority: 40 });
const state = core.createStore({ count: 1, doubled: computed(() => state.count * 2) });

let runs = 0, seen = -1;
core.createHook({ element: host, priority: 60, callback: () => { runs++; seen = state.doubled; } });
[...host._hooks[0]][0](undefined, true);
check('computed reads as a value', seen === 2);
const r0 = runs;
state.count = 5;
check('computed tracks its dependencies automatically', runs === r0 + 1 && seen === 10);
const handler = () => 'plain';
const s2 = core.createStore({ fn: handler });
check('unmarked functions untouched', s2.fn === handler);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
