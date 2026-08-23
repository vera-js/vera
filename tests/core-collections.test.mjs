/**
 * Migrated from the audit-session verification suites (scratchpad, 2026-08-20). Tests BUILT
 * artifacts, development AND production (see ./dist.mjs), so build defects fail here too. Plain pass/fail scripts under
 * node --test: a nonzero exit marks the file failed.
 */
// Collections integrated in core: zero wiring, driven through a real store + hook.
import { load } from './dist.mjs';
const core = await load('core');
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<div id="host"></div>');
globalThis.HTMLElement = dom.window.HTMLElement;
const host = dom.window.document.getElementById('host');
let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : (fail++, console.log('FAIL:', n)); };

const state = core.createStore({ m: new Map(), s: new Set() });
let runs = 0, snap = '';
core.createHook({ element: host, priority: 60, callback: () => {
  runs++;
  snap = [...state.m.entries()].map(([k, v]) => `${k}=${v}`).join(',') + '|' + state.m.size + '|' + state.s.size;
}});
[...host._hooks[0]][0](undefined, true);
const r0 = runs;

check('zero-wiring methods + size', snap === '|0|0');
state.m.set(0, 'zero');                       // falsy key
check('falsy key set re-renders', runs === r0 + 1 && snap === '0=zero|1|0');
state.m.set(0, 'zero');
check('no-op set silent', runs === r0 + 1);
state.m.set('u', undefined);
check('undefined value set fires', runs === r0 + 2);
state.m.delete('u');
check('delete of undefined-valued key fires', runs === r0 + 3);
state.s.add('x'); state.s.add('x');
check('Set add fires once', runs === r0 + 4 && snap.endsWith('|1'));
state.s.delete('nope');
check('no-op delete silent', runs === r0 + 4);
state.m.clear();
check('clear fires (keyed + size)', runs === r0 + 5 && snap === '|0|1');
state.m.clear();
check('clear of empty silent', runs === r0 + 5);
check('wrapper identity stable', state.m.get === state.m.get && state.s.add === state.s.add);
check('forEach works', (() => { let n = 0; state.s.forEach(() => n++); return n === 1; })());
check('iteration protocols intact', [...state.s].length === 1 && JSON.stringify([...state.m.keys()]) === '[]');

// keyed subscription: a hook reading only get('a') must hear set('a') and clear, not set('b')
const host2 = dom.window.document.createElement('div');
dom.window.document.body.appendChild(host2);
let keyedRuns = 0;
core.createHook({ element: host2, priority: 60, callback: () => { keyedRuns++; state.m.get('a'); } });
[...host2._hooks[0]][0](undefined, true);
const k0 = keyedRuns;
state.m.set('b', 1);
check('unrelated key does not re-run keyed hook', keyedRuns === k0);
state.m.set('a', 1);
check('tracked key re-runs keyed hook', keyedRuns === k0 + 1);
state.m.clear();
check('clear re-runs keyed hook', keyedRuns === k0 + 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * The reactivity boundary, pinned.
 *
 * `Map` and `Set` are proxied; `WeakMap`, `WeakSet`, `Date` and `RegExp` are not. Mutating an
 * unproxied one succeeds and simply does not re-render, which is the failure mode worth asserting —
 * silence, not an error.
 *
 * The weak collections are excluded deliberately rather than pending. Per-key dependencies live in
 * a `Map` keyed by the entry key, so tracking `weakMap.get(obj)` would hold `obj` strongly and
 * defeat the weakness the type exists for. Supporting them needs a second, weak dependency
 * structure in core.
 */
const boundaryKey = {};
const boundary = core.createStore({
  set: new Set(), map: new Map(),
  weakSet: new WeakSet(), weakMap: new WeakMap(), when: new Date(0), pattern: /x/,
});
/** A proxied collection hands back a stable bound method; a raw one hands back the native one. */
const isProxied = (value, method) => value[method] !== Object.getPrototypeOf(value)[method];

check('Set is proxied', isProxied(boundary.set, 'add'));
check('Map is proxied', isProxied(boundary.map, 'get'));
check('WeakSet is not proxied', !isProxied(boundary.weakSet, 'add'));
check('WeakMap is not proxied', !isProxied(boundary.weakMap, 'get'));

boundary.weakMap.set(boundaryKey, 1);
check('a WeakMap in a store still works, it is only untracked', boundary.weakMap.get(boundaryKey) === 1);
boundary.when.setTime(5);
check('so does a Date', boundary.when.getTime() === 5);

