/**
 * The reactive graph under generated write sequences.
 *
 * `reactivity-graph` covers shapes a person chose — a diamond, a chain, a cycle. This generates the
 * write **order**, which is the part nobody enumerates: which key changes, how often, whether a value
 * is rewritten to itself, whether a nested object is replaced or mutated in place, whether an array is
 * pushed to or swapped out.
 *
 * ## Two oracles, because each hides the other
 *
 * 1. **Value.** Every `computed` must equal the same expression evaluated *directly against the
 *    store* at that moment. A stale computed is what renders a wrong page.
 * 2. **Work.** A write that does not change a value must recompute nothing.
 *
 * The second cannot be checked by comparing `.value` — an unnecessary recompute produces the same
 * number — so each computed counts its own evaluations. Over-notifying renders constantly and
 * under-notifying renders stale, and both are completely silent.
 *
 * ## Why the oracle here is stronger than the renderer fuzzers'
 *
 * `render-update-fuzz` compares the framework against *itself* — a fresh render — so a defect
 * affecting both paths equally is invisible to it, and that file says so. This compares against a
 * **direct evaluation in plain JavaScript**, which shares no code with the thing under test. A defect
 * has nowhere to hide symmetrically.
 *
 * Both oracles were confirmed to bite, separately: making `computed` evaluate once and cache forever
 * fails the value check across `sum`, `all` and `viaSum`; removing the store's `prevValue === value`
 * guard fails the work check with 1–3 needless recomputes per same-value write, and leaves the value
 * check completely green.
 */
import { load } from './dist.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent',
])
  globalThis[key] = dom.window[key];

const { createStore } = await load('core');
const { computed } = await load('reactivity');

const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);

const KEYS = ['a', 'b', 'c'];
const NUMBERS = [0, 1, 2, 3, -1, 42];
const SEEDS = [3, 9, 21, 55, 101, 7777];
const ROUNDS = 40;

test('every computed matches a direct evaluation after any sequence of writes', () => {
  const failures = [];
  let graphs = 0;
  let sameValueWrites = 0;

  for (const seed of SEEDS) {
    const random = rng(seed);
    const pick = (list) => list[Math.floor(random() * list.length)];

    for (let round = 0; round < ROUNDS; round++) {
      graphs++;
      const state = createStore({ a: 1, b: 2, c: 3, nested: { n: 0 }, list: [1, 2] });

      /** Overlapping subsets, so a shared dependency and a computed-reading-a-computed are exercised. */
      let runs = 0;
      const sum = computed(() => (runs++, state.a + state.b));
      const all = computed(() => (runs++, state.a + state.b + state.c));
      const viaSum = computed(() => (runs++, sum.value * 2));
      const deep = computed(() => (runs++, state.nested.n + state.list.length));

      /** The oracle: the same expressions in plain JavaScript, sharing no code with `computed`. */
      const direct = {
        sum: () => state.a + state.b,
        all: () => state.a + state.b + state.c,
        viaSum: () => (state.a + state.b) * 2,
        deep: () => state.nested.n + state.list.length,
      };
      const reactive = { sum, all, viaSum, deep };

      const compare = (when) => {
        for (const name of Object.keys(direct)) {
          const want = direct[name]();
          const got = reactive[name].value;
          if (want !== got) failures.push(`seed ${seed} round ${round}: ${name} is ${got}, direct evaluation says ${want} (${when})`);
        }
      };

      compare('before any write');

      const writes = 3 + Math.floor(random() * 5);
      for (let write = 0; write < writes; write++) {
        const kind = random();
        if (kind < 0.5) {
          state[pick(KEYS)] = pick(NUMBERS);
        } else if (kind < 0.65) {
          /** Rewrite a key to the value it already holds: no change, so no work. */
          const key = pick(KEYS);
          const valueBefore = all.value;
          const runsBefore = runs;
          /**
           * The self-assignment is the subject, not an accident: it is the write that must reach the
           * store's `prevValue === value` guard and stop there. `no-self-assign` is right about
           * ordinary code and wrong about the one line testing that guard.
           */
          // eslint-disable-next-line no-self-assign
          state[key] = state[key];
          sameValueWrites++;
          if (all.value !== valueBefore)
            failures.push(`seed ${seed} round ${round}: writing \`${key}\` to its own value changed a computed`);
          if (runs !== runsBefore)
            failures.push(`seed ${seed} round ${round}: writing \`${key}\` to its own value caused ${runs - runsBefore} recompute(s)`);
        } else if (kind < 0.8) {
          state.nested.n = pick(NUMBERS);
        } else if (kind < 0.9) {
          /** Replacing the object, rather than mutating through it — a different subscription path. */
          state.nested = { n: pick(NUMBERS) };
        } else if (random() < 0.5) {
          state.list.push(pick(NUMBERS));
        } else {
          state.list = [pick(NUMBERS)];
        }
        compare(`after write ${write + 1}`);
      }
    }
  }

  assert.equal(graphs, SEEDS.length * ROUNDS, 'the generator did not build the expected number of graphs');
  assert.ok(sameValueWrites > 100, `only ${sameValueWrites} same-value writes were generated — the work oracle is barely exercised`);
  assert.deepEqual(
    failures.slice(0, 10),
    [],
    `${failures.length} disagreement(s) across ${graphs} generated graphs:\n\n  ${failures.slice(0, 10).join('\n  ')}`
  );
});
