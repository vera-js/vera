/**
 * `@verajs/reactivity/computed` — memoised derived values.
 *
 * The distinction being tested is against a plain function, not against nothing. `() => a + b` runs
 * on every read; a computed runs once per *change*, and only when something it actually read moves.
 * The docs previously offered a ten-line `'proxy-handler'` recipe as the answer, but that one
 * re-invoked the function on every read — a getter with extra steps, and the one property that
 * makes the primitive worth having was the property it lacked.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';

const core = await load('core');
const { computed } = await load('reactivity/computed');
const dom = new JSDOM('<body></body>');
globalThis.HTMLElement = dom.window.HTMLElement;

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => ok ? pass++ : (fail++, console.log('FAIL:', name, extra));

const mount = () => {
  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  return host;
};

/* ── memoisation ────────────────────────────────────────────────────────────────────────────── */
{
  const state = core.createStore({ a: 1, b: 2, unrelated: 0 });
  let evaluations = 0;
  const total = computed(() => { evaluations++; return state.a + state.b; });

  check('evaluates once up front', evaluations === 1 && total.value === 3);
  total.value; total.value; total.value;
  check('repeated reads are free', evaluations === 1, `evaluated ${evaluations} times`);

  state.a = 10;
  check('a dependency change re-evaluates', evaluations === 2 && total.value === 12);

  const before = evaluations;
  state.unrelated = 99;
  check('an unrelated write does not', evaluations === before);
}

/* ── it is a store, so reads subscribe ──────────────────────────────────────────────────────── */
{
  const state = core.createStore({ n: 1 });
  const doubled = computed(() => state.n * 2);
  const host = mount();
  let renders = 0, seen;
  core.createHook({ element: host, priority: 60, callback: () => { renders++; seen = doubled.value; } });
  [...host._hooks[0]][0](undefined, true);

  check('a reader sees the value', seen === 2);
  const before = renders;
  state.n = 5;
  check('a reader re-runs when the computed changes', renders > before && seen === 10, `saw ${seen}`);

  const stable = renders;
  state.n = 5;
  check('writing the same value re-runs nothing', renders === stable);
}

/* ── chaining ───────────────────────────────────────────────────────────────────────────────── */
{
  const state = core.createStore({ n: 1 });
  const doubled = computed(() => state.n * 2);
  const quadrupled = computed(() => doubled.value * 2);
  check('a computed can read another', quadrupled.value === 4);
  state.n = 3;
  check('the chain propagates', doubled.value === 6 && quadrupled.value === 12, `${doubled.value}/${quadrupled.value}`);
}

/* ── shape ──────────────────────────────────────────────────────────────────────────────────── */
{
  const state = core.createStore({ n: 1 });
  const c = computed(() => state.n);
  const r = core.ref(1);
  check('matches ref()’s shape, so both are `.value`', 'value' in c && 'value' in r);
}

/* ── collections and nesting work, because it is just a store read ──────────────────────────── */
{
  const state = core.createStore({ items: new Map([['a', 2], ['b', 3]]), nested: { deep: 1 } });
  let evaluations = 0;
  const sum = computed(() => { evaluations++; return [...state.items.values()].reduce((n, v) => n + v, 0); });
  check('derives from a reactive Map', sum.value === 5);
  state.items.set('c', 4);
  check('and a Map mutation re-evaluates', sum.value === 9 && evaluations === 2);

  const deep = computed(() => state.nested.deep + 1);
  state.nested.deep = 10;
  check('derives through nested objects', deep.value === 11);
}

/* ── a throwing evaluation is reported, not propagated ──────────────────────────────────────── */
{
  const state = core.createStore({ n: 1 });
  const seen = [];
  core.wire({ on: 'error', fn: (error) => seen.push(error), priority: 25 });
  let threw = false;
  try {
    const bad = computed(() => { if (state.n > 1) throw new Error('boom'); return state.n; });
    check('a computed that starts fine has its value', bad.value === 1);
    state.n = 2;
  } catch { threw = true; }
  check('an evaluation that throws does not escape', threw === false);
  check('it reaches the error insert instead', seen.some((e) => e?.message === 'boom'));
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
