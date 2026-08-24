/**
 * Every container shape crossed with every way of mutating it, checked against the data itself.
 *
 * The suites beside this one test reactivity case by case, which finds what someone thought to
 * write down. This one states the invariant instead — **after a mutation, what a component sees
 * equals what the data is** — and generates the cases: each container is built twice, once inside a
 * store and once as a plain mirror, the same mutation is applied to both, and the component's
 * reading of the store must equal the same reading of the mirror. A missed notification shows up as
 * a stale string; a notification that fires but computes the wrong thing shows up as a wrong one.
 *
 * The reader for each kind walks the whole container — keys, values, size, order — so the case is
 * also a subscription test: a key that was never read is a key that was never tracked, and adding
 * one afterwards is the mutation most likely to go unheard.
 *
 * Tests BUILT artifacts, development AND production (see ./dist.mjs).
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';

const core = await load('core');
const dom = new JSDOM('<div></div>');
globalThis.HTMLElement = dom.window.HTMLElement;
const { document } = dom.window;

let pass = 0;
const failures = [];

/* ── readers ─────────────────────────────────────────────────────────────────────────────────── */
/** Deliberately total: everything the container holds, plus its size, in a stable order. */
const readObject = (o) =>
  `{${Object.keys(o).sort().map((k) => `${k}:${String(o[k])}`).join(',')}}`;
const readArray = (a) => `[${Array.from(a, (x) => String(x)).join(',')}]#${a.length}`;
const readMap = (m) => `M{${[...m].map(([k, v]) => `${String(k)}:${String(v)}`).join(',')}}#${m.size}`;
const readSet = (s) => `S{${[...s].map(String).join(',')}}#${s.size}`;

/* ── the matrix ──────────────────────────────────────────────────────────────────────────────── */
const nested = () => ({ inner: { n: 1 }, list: [1, 2] });

const SYM = Symbol.for('vera.matrix');

/** A real class, so accessors, methods and prototype lookups all go through the proxy. */
class Thing {
  a = 1;
  b = 2;
  describe() {
    return `${this.a}/${this.b}`;
  }
}

/**
 * `mutations` lets several readers share one mutation set: how a component *reads* the container is
 * a separate axis from how the data changes, and the enumerating readers below — `in`, spread,
 * `JSON.stringify` — are exactly the ones that depend on the key set rather than on any one key.
 */
const KINDS = {
  object: { read: readObject, make: () => ({ a: 1, b: 2 }) },
  'object read by membership': {
    mutations: 'object',
    read: (o) => `a=${'a' in o} c=${'c' in o} 0=${0 in o}`,
    make: () => ({ a: 1, b: 2 }),
  },
  'object read by spread': { mutations: 'object', read: (o) => readObject({ ...o }), make: () => ({ a: 1, b: 2 }) },
  'object read by JSON': { mutations: 'object', read: (o) => JSON.stringify(o), make: () => ({ a: 1, b: 2 }) },
  'object read by for…in': {
    mutations: 'object',
    read: (o) => { const keys = []; for (const k in o) keys.push(`${k}:${String(o[k])}`); return keys.sort().join(','); },
    make: () => ({ a: 1, b: 2 }),
  },
  'nested object': { read: (o) => `${readObject(o.inner)}${readArray(o.list)}`, make: nested },
  'object with an accessor': {
    mutations: 'object',
    read: (o) => `${readObject(o)}|${o.double}`,
    make: () => ({ a: 1, b: 2, get double() { return (this.a ?? 0) * 2; } }),
  },
  'object with symbol keys': {
    mutations: 'object',
    read: (o) => `${readObject(o)}|${String(o[SYM])}|${Object.getOwnPropertySymbols(o).length}`,
    make: () => ({ a: 1, b: 2, [SYM]: 'sym' }),
  },
  'class instance': {
    mutations: 'object',
    read: (o) => `${readObject(o)}|${o.describe()}`,
    make: () => new Thing(),
  },
  'object mutated by defineProperty': {
    mutations: 'defineProperty',
    read: readObject,
    make: () => ({ a: 1, b: 2 }),
  },
  array: { read: readArray, make: () => [1, 2, 3] },
  'array read by Object.keys': { mutations: 'array', read: (a) => `${Object.keys(a).join(',')}#${a.length}`, make: () => [1, 2, 3] },
  'array of objects': { read: (a) => a.map(readObject).join('|'), make: () => [{ n: 1 }, { n: 2 }] },
  map: { read: readMap, make: () => new Map([['a', 1]]) },
  set: { read: readSet, make: () => new Set([1]) },
};

const MUTATIONS = {
  object: {
    'set an existing key': (o) => (o.a = 9),
    'set a key that was never there': (o) => (o.c = 3),
    'set a key to undefined': (o) => (o.a = undefined),
    'set a key to the value it already has': (o) => (o.a = 1),
    'delete a key': (o) => delete o.a,
    'delete a key that was never there': (o) => delete o.zz,
    'Object.assign a new key': (o) => Object.assign(o, { c: 3 }),
    'Object.assign over an existing key': (o) => Object.assign(o, { a: 9 }),
    'set a key to an object': (o) => (o.c = { n: 1 }),
    'set a key to an array': (o) => (o.c = [1, 2]),
    'set a numeric key': (o) => (o[0] = 'zero'),
    'set a symbol key': (o) => (o[SYM] = 'changed'),
    'delete a symbol key': (o) => delete o[SYM],
  },
  defineProperty: {
    'defineProperty a new key': (o) => Object.defineProperty(o, 'c', { value: 3, enumerable: true, configurable: true, writable: true }),
    'defineProperty over an existing key': (o) => Object.defineProperty(o, 'a', { value: 9, enumerable: true, configurable: true, writable: true }),
    'defineProperty a non-enumerable key': (o) => Object.defineProperty(o, 'c', { value: 3, enumerable: false, configurable: true, writable: true }),
    'defineProperty an accessor': (o) => Object.defineProperty(o, 'c', { get: () => 3, enumerable: true, configurable: true }),
  },
  'nested object': {
    'mutate the nested object': (o) => (o.inner.n = 9),
    'add to the nested object': (o) => (o.inner.m = 2),
    'delete from the nested object': (o) => delete o.inner.n,
    'replace the nested object': (o) => (o.inner = { n: 5 }),
    'push onto the nested array': (o) => o.list.push(3),
    'splice the nested array': (o) => o.list.splice(0, 1),
    'replace the nested array': (o) => (o.list = [7]),
  },
  array: {
    'assign an index': (a) => (a[0] = 9),
    'assign past the end': (a) => (a[5] = 9),
    'assign at length': (a) => (a[a.length] = 4),
    push: (a) => a.push(4),
    'push several': (a) => a.push(4, 5),
    pop: (a) => a.pop(),
    shift: (a) => a.shift(),
    unshift: (a) => a.unshift(0),
    'splice, removing': (a) => a.splice(1, 1),
    'splice, inserting': (a) => a.splice(1, 0, 9),
    'splice, replacing': (a) => a.splice(1, 1, 9),
    sort: (a) => a.sort((x, y) => y - x),
    reverse: (a) => a.reverse(),
    fill: (a) => a.fill(0),
    copyWithin: (a) => a.copyWithin(0, 1),
    'truncate with length': (a) => (a.length = 1),
    'grow with length': (a) => (a.length = 5),
    'delete an index': (a) => delete a[1],
    'pop the last element': (a) => (a.length = 0),
  },
  'array of objects': {
    'mutate an element': (a) => (a[0].n = 9),
    'add a key to an element': (a) => (a[0].m = 2),
    'replace an element': (a) => (a[0] = { n: 9 }),
    'push an element': (a) => a.push({ n: 3 }),
    'sort by a key': (a) => a.sort((x, y) => y.n - x.n),
  },
  map: {
    'set a new key': (m) => m.set('b', 2),
    'set an existing key': (m) => m.set('a', 9),
    'set a key to undefined': (m) => m.set('a', undefined),
    'set a falsy key': (m) => m.set(0, 'zero'),
    'set an object key': (m) => m.set({}, 1),
    delete: (m) => m.delete('a'),
    'delete a key that was never there': (m) => m.delete('zz'),
    clear: (m) => m.clear(),
  },
  set: {
    add: (s) => s.add(2),
    'add one it already has': (s) => s.add(1),
    'add a falsy value': (s) => s.add(0),
    'add an object': (s) => s.add({}),
    delete: (s) => s.delete(1),
    'delete one it never had': (s) => s.delete(99),
    clear: (s) => s.clear(),
  },
};

/* ── run ─────────────────────────────────────────────────────────────────────────────────────── */
for (const [kindName, kind] of Object.entries(KINDS)) {
  for (const [mutationName, mutate] of Object.entries(MUTATIONS[kind.mutations ?? kindName])) {
    const name = `${kindName}: ${mutationName}`;

    /** A fresh element and store per case — a shared one carries the previous case's tracking. */
    const element = document.createElement('div');
    document.body.appendChild(element);

    const store = core.createStore({ v: kind.make() });
    const mirror = kind.make();

    let seen = '';
    core.createHook({ element, priority: 60, callback: () => (seen = kind.read(store.v)) });
    [...element._hooks[0]][0](undefined, true);

    const before = seen;
    if (before !== kind.read(mirror)) {
      failures.push(`${name}\n      the store and the mirror did not start equal:\n` +
        `      store:  ${before}\n      mirror: ${kind.read(mirror)}`);
      continue;
    }

    mutate(store.v);
    mutate(mirror);
    const expected = kind.read(mirror);

    if (seen === expected) pass++;
    else
      failures.push(
        `${name}\n      component: ${seen}\n      data:      ${expected}` +
          (seen === before ? '\n      (the component never heard about it)' : '')
      );

    element.remove();
  }
}

/* ── one write, one notification ─────────────────────────────────────────────────────────────── */
/**
 * The matrix compares values, so it cannot see a notification that fires twice — and adding the
 * `defineProperty` trap made every ordinary write do exactly that.
 *
 * `Reflect.set(obj, prop, value, receiver)` does not write to `obj` when the receiver is a
 * different object, and the receiver is always the proxy: the spec routes the write through
 * `receiver.[[DefineOwnProperty]]`, so an assignment re-enters `defineProperty`. Passing the
 * receiver is what makes a setter run with `this` bound to the proxy, so it cannot simply be
 * dropped. Counted here rather than reasoned about, because nothing else would have shown it —
 * every value stayed correct, and only `computed`'s evaluation count moved.
 */
{
  const element = document.createElement('div');
  document.body.appendChild(element);
  const store = core.createStore({ a: 1, nested: { n: 1 }, list: [1, 2] });

  let runs = 0;
  core.createHook({
    element,
    priority: 60,
    callback: () => { runs++; void `${store.a}${store.nested.n}${store.list[0]}${store.list.length}`; },
  });
  [...element._hooks[0]][0](undefined, true);

  const counted = (name, mutate) => {
    const before = runs;
    mutate();
    const fired = runs - before;
    if (fired === 1) pass++;
    else failures.push(`${name}
      notified ${fired} time(s), expected exactly 1`);
  };

  counted('a plain write notifies once', () => (store.a = 2));
  counted('a nested write notifies once', () => (store.nested.n = 2));
  counted('an array index write notifies once', () => (store.list[0] = 9));
  counted('an array push notifies once', () => store.list.push(3));
  counted('a defineProperty notifies once', () =>
    Object.defineProperty(store, 'a', { value: 3, enumerable: true, configurable: true, writable: true }));
  element.remove();
}

/* ── a setter still runs against the proxy ───────────────────────────────────────────────────── */
/**
 * The reason `set` hands `Reflect.set` the receiver, and therefore the reason the re-entrancy above
 * has to be guarded rather than avoided: a setter's `this` is the proxy, so what it writes is
 * tracked like anything else.
 */
{
  const element = document.createElement('div');
  document.body.appendChild(element);
  const store = core.createStore({
    first: 'a',
    last: 'b',
    set full(value) { [this.first, this.last] = value.split(' '); },
  });

  let seen = '';
  core.createHook({ element, priority: 60, callback: () => (seen = `${store.first} ${store.last}`) });
  [...element._hooks[0]][0](undefined, true);

  store.full = 'x y';
  if (seen === 'x y') pass++;
  else failures.push(`a setter writes through the proxy
      component: ${seen}
      data:      x y`);
  element.remove();
}

if (failures.length) {
  console.log(`\n  ${failures.length} mutation(s) a component does not see correctly:\n`);
  for (const f of failures) console.log(`    ${f}\n`);
  process.exit(1);
}
console.log(`reactivity matrix: ${pass} mutations across ${Object.keys(KINDS).length} container kinds`);
