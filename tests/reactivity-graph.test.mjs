/**
 * The dependency graph under shapes a component can actually produce.
 *
 * A reactive graph fails quietly. A stale read, a subscription that outlives its reason, an effect
 * that runs twice for one change — none of it throws, and the page is usually right anyway, until
 * one of them happens to be the value someone rendered. So each of these asserts a number rather
 * than "it worked".
 *
 * The diamond case is here because it is a **limitation and not a bug**, which is the kind of thing
 * that gets rediscovered every eighteen months and re-argued from scratch. It is measured here so
 * that if the scheduler ever changes, the change is deliberate.
 */
import { load, isProduction } from './dist.mjs';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import test from 'node:test';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent',
])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { createStore, useSyncEffect, useEffect, init, render, mount: commit, html, wire } = core;
const { renderer } = await load('renderer');
const { computed } = await load('reactivity');
wire([renderer]);

const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const host = document.createElement('div');
document.body.appendChild(host);

let seq = 0;
/** Hooks need an instance, and setup has to be closed or none of them ever run. */
const mount = (body, { renders = false } = {}) => {
  const tag = `x-graph-${seq++}`;
  customElements.define(
    tag,
    class extends HTMLElement {
      connectedCallback() {
        init(this, { mode: 'open' });
        body(this);
        if (!renders) commit();
      }
    }
  );
  const element = document.createElement(tag);
  host.appendChild(element);
  return element;
};

/** The same diamond every time: two computeds over one store, and a third over both. */
const diamond = () => {
  const state = createStore({ n: 1 });
  const double = computed(() => state.n * 2);
  const triple = computed(() => state.n * 3);
  return { state, sum: computed(() => double.value + triple.value) };
};

test('nothing that renders can observe a half-settled diamond', async () => {
  const { state, sum } = diamond();
  const painted = [];
  const element = mount(
    () => render(() => { painted.push(sum.value); return html`<i>${sum.value}</i>`; }),
    { renders: true }
  );
  await settle();
  state.n = 2;
  await settle();
  state.n = 3;
  await settle();
  assert.deepEqual(painted, [5, 10, 15], 'render() is coalesced, so it only sees settled values');
  assert.equal(element.shadowRoot.textContent, '15');

  const seen = [];
  const other = diamond();
  mount(() => useEffect(() => { seen.push(other.sum.value); }));
  await settle();
  other.state.n = 2;
  await settle();
  other.state.n = 3;
  await settle();
  assert.deepEqual(seen, [5, 10, 15], 'a coalesced effect only sees settled values too');
});

test('a synchronous effect does see a half-settled diamond, and that is the documented edge', () => {
  const { state, sum } = diamond();
  const seen = [];
  mount(() => useSyncEffect(() => { seen.push(sum.value); }));
  state.n = 2;
  state.n = 3;
  /**
   * 7 is `double(2) + triple(1)` — a value `sum` never has. One write propagates depth-first, so
   * the dependent re-evaluates once with half its inputs updated. `useSyncEffect` is the only thing
   * that can see it, which is what its own documentation is for: it runs on every individual change
   * rather than once per tick.
   *
   * Asserted exactly rather than loosely. If this ever becomes `[5, 10, 15]` the scheduler has been
   * made to settle a graph before notifying, which would be an improvement — and this line is what
   * makes that a decision someone made rather than something that drifted.
   */
  assert.deepEqual(seen, [5, 7, 10, 12, 15]);
});

test('the extra work a diamond costs is one evaluation of the dependent', () => {
  const state = createStore({ n: 1 });
  let doubles = 0;
  let triples = 0;
  let sums = 0;
  const double = computed(() => { doubles++; return state.n * 2; });
  const triple = computed(() => { triples++; return state.n * 3; });
  const sum = computed(() => { sums++; return double.value + triple.value; });
  mount(() => useSyncEffect(() => { void sum.value; }));
  const before = [doubles, triples, sums];
  state.n = 2;
  assert.deepEqual(
    [doubles - before[0], triples - before[1], sums - before[2]],
    [1, 1, 2],
    'the two halves evaluate once each; the dependent evaluates once per half'
  );
});

test('a computed evaluates once per change and not at all for an unrelated write', () => {
  const state = createStore({ watched: 1, unrelated: 1 });
  let evaluations = 0;
  const value = computed(() => { evaluations++; return state.watched; });
  void value.value;
  const baseline = evaluations;
  for (let i = 0; i < 10; i++) state.unrelated = i;
  assert.equal(evaluations - baseline, 0, 'an unrelated store write costs none at all');
  state.watched = 2;
  assert.equal(evaluations - baseline, 1, 'and a watched one costs exactly one');
  void value.value;
  void value.value;
  void value.value;
  assert.equal(evaluations - baseline, 1, 'reading it three times costs nothing further');
});

test('a branch that was not taken is not subscribed, and one abandoned is unsubscribed', () => {
  const state = createStore({ useA: true, a: 1, b: 100 });
  const pick = computed(() => (state.useA ? state.a : state.b));
  let runs = 0;
  mount(() => useSyncEffect(() => { void pick.value; runs++; }));
  const afterSetup = runs;
  state.b = 101;
  assert.equal(runs, afterSetup, 'b is never read while useA is true, so writing it notifies nobody');
  state.a = 2;
  assert.ok(runs > afterSetup, 'a is read, so writing it does');
  state.useA = false;
  assert.equal(pick.value, 101, 'and the value follows the flip');
  const afterFlip = runs;
  state.a = 3;
  assert.equal(runs, afterFlip, 'a is no longer read, so the old subscription is gone');
});

test('a write that changes nothing notifies nobody', () => {
  const held = { deep: 1 };
  const state = createStore({ n: 1, o: held });
  let runs = 0;
  mount(() => useSyncEffect(() => { void state.n; void state.o; runs++; }));
  const afterSetup = runs;
  state.n = 1;
  /** The self-assignment is the subject, not an accident: reads are wrapped, so this arrives at the
   * set trap as proxy-against-raw and is exactly the comparison being tested. */
  // eslint-disable-next-line no-self-assign
  state.o = state.o;
  assert.equal(runs, afterSetup, 'neither the same number nor the same object is a change');
});

test('a twenty-deep chain of computeds settles', () => {
  const state = createStore({ n: 1 });
  const chain = [computed(() => state.n + 1)];
  for (let i = 1; i < 20; i++) {
    const previous = chain[i - 1];
    chain.push(computed(() => previous.value + 1));
  }
  assert.equal(chain.at(-1).value, 21);
  state.n = 100;
  assert.equal(chain.at(-1).value, 120, 'and follows a write all the way down');
});

test('a deep store notifies for every kind of mutation', () => {
  const state = createStore({ deep: { list: [1, 2, 3], map: { a: 1 } } });
  const seen = [];
  mount(() => useSyncEffect(() => { seen.push(JSON.parse(JSON.stringify(state.deep))); }));
  const afterSetup = seen.length;
  state.deep.list.push(4);
  state.deep.list[0] = 9;
  state.deep.map.b = 2;
  delete state.deep.map.a;
  state.deep.list.length = 2;
  assert.deepEqual(seen.at(-1), { list: [9, 2], map: { b: 2 } });
  /** `push` moves an index *and* the length, so it notifies twice — a proxy over an array cannot
   * tell one write from two, and every library built this way reports the same. */
  assert.equal(seen.length - afterSetup, 6, 'five statements, six notifications: push counts twice');
});

test('a sync effect that writes what it reads is stopped by name, not by a stack overflow', {
  skip: isProduction && 'the recursion counter is development-only',
}, () => {
  const state = createStore({ n: 0 });
  let runs = 0;
  /** Guarded, so this one terminates on its own — the unguarded case is what the depth-50 check in
   * `useSyncEffect` is for, and is covered where that diagnostic lives. */
  mount(() => useSyncEffect(() => { runs++; if (state.n < 3) state.n = state.n + 1; }));
  assert.equal(state.n, 3);
  assert.equal(runs, 4, 'one setup pass and one per write it made');
});

/**
 * **The same nested object, read back and assigned, was treated as a change.**
 *
 * The set trap reads the previous value off the raw target while the *getter* hands out that
 * object's proxy, so `state.o = state.o` compared proxy against raw, notified every subscriber that
 * nothing had happened, and wrote the proxy into the target — where code still holding the original
 * object saw its own property stop being what it passed in.
 *
 * Worth a test rather than a shrug because of which idiom it breaks:
 * `state.items = update(state.items)`, where `update` returns its input untouched when there is
 * nothing to do, is how "no change" is normally written. It cost a render pass every time, and the
 * only symptom was work nobody asked for.
 *
 * The primitive half of this rule was already there — `state.n = 1` was correctly quiet — which is
 * what makes it a gap rather than a decision.
 */
test('a nested object assigned back to its own slot is not a change', () => {
  const original = { deep: 1 };
  const target = { n: 1, o: original };
  const state = createStore(target);
  let runs = 0;
  mount(() => useSyncEffect(() => { void state.n; void state.o.deep; runs++; }));

  const afterSetup = runs;
  state.n = 1;
  assert.equal(runs, afterSetup, 'the same primitive is not a change');
  // eslint-disable-next-line no-self-assign -- the self-assignment is the subject of the test
  state.o = state.o;
  assert.equal(runs, afterSetup, 'the same object read back through the proxy is not one either');
  state.o = original;
  assert.equal(runs, afterSetup, 'nor is the object the store was built from');

  /** And the store still holds what it was given, rather than a wrapper around it. */
  assert.equal(target.o, original, 'assigning it back wrote a proxy into the target');

  /** A real change still is one, and the subscription still works afterwards. */
  state.o = { deep: 2 };
  assert.equal(runs, afterSetup + 1, 'a different object notifies');
  const before = runs;
  state.o.deep = 3;
  assert.ok(runs > before, 'and the new object is tracked');
  assert.equal(state.o.deep, 3);
});
