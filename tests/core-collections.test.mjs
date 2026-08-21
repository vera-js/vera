/**
 * Migrated from the audit-session verification suites (scratchpad, 2026-08-20). Tests BUILT
 * artifacts (dist/development), so build defects fail here too. Plain pass/fail scripts under
 * node --test: a nonzero exit marks the file failed.
 */
// Collections integrated in core: zero wiring, driven through a real store + hook.
const core = await import(new URL('../packages/core/dist/development/vera.js', import.meta.url).href);
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
