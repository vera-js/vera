/**
 * Reactive `Map` and `Set` against plain ones, over generated method sequences.
 *
 * `collections.ts` intercepts nine members — `set`, `add`, `delete`, `clear`, `get`, `has`,
 * `forEach` and the three iterators — because a native collection method throws
 * (`called on incompatible receiver`) when invoked on a proxy. Every interception is a chance to
 * answer differently from the thing it imitates, and the **return values** are the subtle part:
 * `set` and `add` return the collection, `delete` returns a boolean, `clear` returns `undefined`.
 *
 * ## Two oracles, because either alone passes for the wrong reason
 *
 * 1. **Behaviour** — a plain collection driven through the same sequence. Independent of the subject,
 *    in the way pass 59's direct evaluation was and pass 58's fresh render was not. Contents, size,
 *    iteration order and every return value are compared after each step.
 * 2. **Notification** — a reader that must wake when the collection changes and stay quiet when it
 *    does not. Without this, an implementation that notified *nobody* would behave exactly like a
 *    plain `Map` and pass the whole of the first oracle.
 *
 * ## `rewrite`, and why it is in the operation list
 *
 * Re-setting an existing entry to the value it already holds is the case that separates "notifies on
 * a change" from "notifies on every call". Left to chance the generator produced **3 of them in 360
 * steps, all of them `add`** — so a mutation making `set` notify unconditionally survived the entire
 * run. Generating it deliberately is what kills that mutation.
 *
 * Four mutations, all caught: `set` returning the raw collection rather than the proxy, `delete`
 * returning `undefined`, `set` notifying nobody, and `set` notifying unconditionally.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window','document','HTMLElement','customElements','CSSStyleSheet','Node','Element','DocumentFragment','Text','Comment','requestAnimationFrame','cancelAnimationFrame','Event','CustomEvent'])
  globalThis[k] = dom.window[k];

const core = await load('core');
const { collections } = await load('reactivity/collections');
core.wire([collections]);
const { createStore } = core;

const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);

const KEYS = ['a', 'b', 'c', 1, 2, true, null];
const VALUES = ['x', 'y', 0, null, undefined, { tag: 'obj' }];

/** Everything a caller can observe, as one string. */
const shape = (collection) => {
  const entries = [...collection.entries()].map(([k, v]) => `${String(k)}=${typeof v === 'object' && v ? v.tag ?? 'obj' : String(v)}`);
  const keys = [...collection.keys()].map(String);
  const values = [...collection.values()].map((v) => (typeof v === 'object' && v ? v.tag ?? 'obj' : String(v)));
  const forEached = [];
  collection.forEach(function (v, k) { forEached.push(`${String(k)}:${typeof v === 'object' && v ? v.tag ?? 'obj' : String(v)}`); });
  return JSON.stringify({ size: collection.size, entries, keys, values, forEached, spread: [...collection].length });
};

const failures = [];
let steps = 0;
let notifications = 0;

/**
 * **The second oracle.** Comparing against a plain collection only tests behavioural equivalence — an
 * implementation that notified nobody would behave exactly like a plain `Map` and pass every check
 * above. So each mutating operation is also asked whether it woke a reader, and each non-mutating one
 * whether it stayed quiet.
 */
const { computed } = await load('reactivity');


test('a reactive Map and Set behave like plain ones, and notify exactly when they change', () => {
  for (const kind of ['Map', 'Set']) {
    for (const seed of [6, 23, 47, 88, 191, 5309]) {
      const random = rng(seed);
      /** The subject: a collection inside a store, so every access goes through the insert. */
      const state = createStore({ c: kind === 'Map' ? new Map() : new Set() });
      const subject = state.c;
      /** The oracle: a plain one, driven identically. */
      const plain = kind === 'Map' ? new Map() : new Set();

      const history = [];
      for (let step = 0; step < 30; step++) {
        const key = KEYS[Math.floor(random() * KEYS.length)];
        const value = VALUES[Math.floor(random() * VALUES.length)];
        /**
         * `rewrite` re-sets an existing entry to the value it already holds — a **no-op write**, the
         * case that separates "notifies on a change" from "notifies on every call". Left to chance the
         * generator produced 3 of them in 360 steps and all 3 were `add`, so a mutation making `set`
         * notify unconditionally survived the whole run.
         */
        const operations = kind === 'Map'
          ? ['set', 'get', 'has', 'delete', 'clear', 'size', 'rewrite']
          : ['add', 'has', 'delete', 'clear', 'size', 'rewrite'];
        const operation = operations[Math.floor(random() * operations.length)];
        history.push(`${operation}(${String(key)})`);
        steps++;

        const run = (collection) => {
          try {
            switch (operation) {
              case 'set': return `returned:${collection.set(key, value) === collection ? 'self' : 'OTHER'}`;
              case 'add': return `returned:${collection.add(key) === collection ? 'self' : 'OTHER'}`;
              case 'get': { const got = collection.get(key); return `got:${typeof got === 'object' && got ? got.tag ?? 'obj' : String(got)}`; }
              case 'has': return `has:${collection.has(key)}`;
              case 'delete': return `deleted:${collection.delete(key)}`;
              case 'clear': return `cleared:${String(collection.clear())}`;
              case 'size': return `size:${collection.size}`;
              case 'rewrite': {
                /** The first existing entry, re-written with what it already holds. */
                const existing = [...collection.keys()][0];
                if (existing === undefined) return 'rewrite:empty';
                return collection.set
                  ? `rewrote:${collection.set(existing, collection.get(existing)) === collection ? 'self' : 'OTHER'}`
                  : `rewrote:${collection.add(existing) === collection ? 'self' : 'OTHER'}`;
              }
              default: return 'none';
            }
          } catch (error) {
            return `THREW ${error.constructor.name}: ${String(error.message).slice(0, 50)}`;
          }
        };

        /**
         * A reader over the whole collection, re-derived each step so it observes exactly this call.
         * `size` is read through the proxy, which is what subscribes.
         */
        let runs = 0;
        const reader = computed(() => { runs++; return `${subject.size}:${[...subject.keys()].join(',')}`; });
        void reader.value;
        const runsBefore = runs;
        const contentsBefore = shape(plain);

        const mine = run(subject);
        const theirs = run(plain);

        /** Did the collection actually change? The plain one is the authority on that. */
        const changed = shape(plain) !== contentsBefore;
        void reader.value;
        const woke = runs > runsBefore;
        if (changed && !woke)
          failures.push(`${kind} seed ${seed} step ${step}: ${operation}(${String(key)}) changed the collection and notified nobody`);
        if (!changed && woke)
          failures.push(`${kind} seed ${seed} step ${step}: ${operation}(${String(key)}) changed nothing and still notified`);
        if (changed) notifications++;
        const where = `${kind} seed ${seed} step ${step}, after ${history.slice(-4).join(' ')}`;

        if (mine !== theirs) {
          failures.push(`${where}\n      reactive: ${mine}\n      plain:    ${theirs}`);
          break;
        }
        const shapeMine = shape(subject);
        const shapeTheirs = shape(plain);
        if (shapeMine !== shapeTheirs) {
          failures.push(`${where}\n      reactive: ${shapeMine.slice(0, 200)}\n      plain:    ${shapeTheirs.slice(0, 200)}`);
          break;
        }
      }
    }
  }

  assert.equal(steps, 360, `expected 360 operations, ran ${steps}`);
  assert.ok(notifications > 50, `only ${notifications} operations actually changed the collection`);
  assert.deepEqual(
    failures.slice(0, 8),
    [],
    `${failures.length} of ${steps} operations disagreed with a plain collection or notified wrongly:\n\n  ${failures.slice(0, 8).join('\n\n  ')}`
  );
});
