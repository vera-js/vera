/**
 * Migrated from the audit-session verification suites (scratchpad, 2026-08-20). Tests BUILT
 * artifacts, development AND production (see ./dist.mjs), so build defects fail here too. Plain pass/fail scripts under
 * node --test: a nonzero exit marks the file failed.
 */
// Collections integrated in core: zero wiring, driven through a real store + hook.
import { load } from './dist.mjs';
const core = await load('core');
const { collections } = await load('reactivity/collections');
core.wire(collections);
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


/**
 * The reactivity boundary.
 *
 * `Map`, `Set`, `WeakMap` and `WeakSet` are all proxied — the same four Vue supports. `Date` and
 * `RegExp` are not, in Vue either: their methods read internal slots, so a bare proxy throws
 * (`this is not a Date object`) and making them reactive would mean wrapping every mutator for a
 * case whose idiom is to replace the value. `state.when = new Date(t)` is a property write and is
 * fully reactive.
 *
 * The weak collections took a change in how dependencies are stored, not just a type check. Keys
 * here are the collection's own entry keys, so the ordinary `Map` container would have held every
 * tracked key alive for as long as the collection — exactly the retention the weak types exist to
 * avoid. Weak collections get a `WeakMap` container instead, chosen once on the first tracked read.
 */
const k1 = { id: 1 }, k2 = { id: 2 };
const boundary = core.createStore({
  weakMap: new WeakMap([[k1, 'a']]), weakSet: new WeakSet([k1]),
  objMap: new Map([[k1, 'v']]), when: new Date(0), pattern: /x/,
});
/** A proxied collection hands back a stable bound method; a raw one hands back the native one. */
const isProxied = (value, method) => value[method] !== Object.getPrototypeOf(value)[method];

check('WeakMap is proxied', isProxied(boundary.weakMap, 'get'));
check('WeakSet is proxied', isProxied(boundary.weakSet, 'add'));
check('Date is not proxied', !isProxied(boundary.when, 'getTime'));
boundary.when.setTime(5);
check('an unproxied Date still works, it is only untracked', boundary.when.getTime() === 5);

let wRuns = 0, wSnap = '';
core.createHook({ element: host, priority: 60, callback: () => {
  wRuns++;
  wSnap = `${boundary.weakMap.get(k1)}|${boundary.weakSet.has(k2)}|${boundary.objMap.get(k1)}`;
}});
[...host._hooks[0]].at(-1)(undefined, true);
const w0 = wRuns;
check('weak collections read through', wSnap === 'a|false|v');

boundary.weakMap.set(k1, 'A');
check('WeakMap.set on a tracked key re-runs', wRuns === w0 + 1 && wSnap.startsWith('A|'));
boundary.weakSet.add(k2);
check('WeakSet.add on a tracked key re-runs', wRuns === w0 + 2 && wSnap.includes('|true|'));
boundary.weakMap.delete(k1);
check('WeakMap.delete re-runs', wRuns === w0 + 3 && wSnap.startsWith('undefined|'));

boundary.weakMap.set(k2, 'untracked');
check('a key nothing read does not re-run', wRuns === w0 + 3);
/** The first is a real change, because the key was just deleted; the second is the no-op. */
boundary.weakMap.set(k1, 'A');
check('re-adding a deleted key re-runs', wRuns === w0 + 4);
boundary.weakMap.set(k1, 'A');
check('a no-op set is silent', wRuns === w0 + 4);

/** A regular Map keyed by objects must keep the strong container — and its size channel. */
boundary.objMap.set(k1, 'v2');
check('object-keyed Map still tracks per key', wRuns === w0 + 5 && wSnap.endsWith('|v2'));

/**
 * **`for…of` and spread subscribe.**
 *
 * `Symbol.iterator` is the same function as `entries` on a `Map` and `values` on a `Set`, and it
 * used to fall through to the untracked default — so `${[...state.tags]}`, the most natural way to
 * render a collection, read it once and never heard about a change again. Nothing *failed*: the
 * first render was right and the list simply stopped moving. The documented workaround was
 * `[...state.tags.values()]`, which nobody arrives at from a component that renders correctly the
 * first time.
 *
 * Its own element, so its hook is the only one on it and can be driven the way the others here are.
 */
const iterHost = dom.window.document.createElement('div');
dom.window.document.body.appendChild(iterHost);
const iter = core.createStore({ m: new Map([['a', 1]]), s: new Set([1]) });
let iterRuns = 0, spreadSnap = '', forOfSnap = '';
core.createHook({ element: iterHost, priority: 60, callback: () => {
  iterRuns++;
  spreadSnap = [...iter.m].map(([k, v]) => `${k}${v}`).join('');
  let out = '';
  for (const v of iter.s) out += v;
  forOfSnap = out;
}});
[...iterHost._hooks[0]][0](undefined, true);
const i0 = iterRuns;

check('spread reads the Map', spreadSnap === 'a1');
check('for..of reads the Set', forOfSnap === '1');
iter.m.set('b', 2);
check('spread over a Map subscribes', iterRuns === i0 + 1 && spreadSnap === 'a1b2');
iter.s.add(2);
check('for..of over a Set subscribes', iterRuns === i0 + 2 && forOfSnap === '12');
iter.s.delete(2);
check('and hears a delete', iterRuns === i0 + 3 && forOfSnap === '1');

/**
 * **A chained mutation was called on the raw collection**, and everything after the first link went
 * unseen.
 *
 * `Map.prototype.set` and `Set.prototype.add` return the collection so they can be chained, and the
 * wrapper returned what `method.apply(rawCollection, args)` gave it — the unproxied one. So
 * `tags.add(1).add(2).add(3)` notified once, and the subscriber was left holding a stale value while
 * the data was completely correct.
 *
 * The case that makes it worth a test rather than a footnote is a chain whose **first** link happens
 * to change nothing — `add` of a value already present. Then there is no first notification either,
 * nothing else is pending, and the render never happens: the collection holds three items and the
 * page shows one, until something unrelated moves. Nothing throws and nothing logs.
 *
 * `forEach` had the same escape by a different door: it passes the collection to its callback as a
 * third argument, and that was the raw one too, so a callback writing through it mutated past the
 * proxy.
 */
{
  const chained = core.createStore({ m: new Map(), s: new Set([1]) });
  let notifications = 0;
  core.createHook({ element: host, priority: 61, callback: () => {
    notifications++;
    void chained.m.size;
    void chained.s.size;
  }});
  [...host._hooks[host._hooks.length - 1]][0](undefined, true);
  const base = notifications;

  /** The returned value is the collection you called it on, exactly as the built-in reports. */
  check('set returns the store collection, not the raw one', chained.m.set('a', 1) === chained.m);
  check('add returns the store collection', chained.s.add(2) === chained.s);

  const beforeChain = notifications;
  chained.m.set('b', 2).set('c', 3).set('d', 4);
  check('three chained sets notify three times', notifications - beforeChain === 3);
  check('and all three landed', chained.m.size === 4);

  /** The sharp one: the first link changes nothing, so without the fix nobody hears at all. */
  const beforeNoop = notifications;
  chained.s.add(1).add(3).add(4);
  check('a chain whose first link is a no-op still notifies', notifications - beforeNoop === 2);
  check('and the set holds everything', [...chained.s].join(',') === '1,2,3,4');

  /** forEach hands its callback the receiver, so writing through it is tracked. */
  const beforeEach = notifications;
  let sawReceiver = false;
  chained.m.forEach((value, key, self) => {
    if (key === 'a') { sawReceiver = self === chained.m; self.set('e', 5); }
  });
  check('forEach passes the store collection as its third argument', sawReceiver);
  check('so a write through it notifies', notifications - beforeEach > 0);
  check('and it landed', chained.m.get('e') === 5);
  void base;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
