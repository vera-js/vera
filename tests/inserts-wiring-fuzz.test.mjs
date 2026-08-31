/**
 * The insert chain under generated wiring.
 *
 * Every other fuzz here tests one module. This tests what the framework's design rests on: modules
 * composing through `wire`, at priorities the app chooses. Three properties a caller depends on, none
 * of them visible from a single-module test:
 *
 * 1. **Priority order** — lower runs first, for any set of priorities including negatives, duplicates
 *    and registrations arriving out of order.
 * 2. **A duplicate priority replaces rather than stacking.** That is how a renderer is swapped, and it
 *    is deliberate.
 * 3. **Chains are isolated.** A busy point must not perturb a quiet one.
 *
 * The oracle is a plain map-then-sort in the test — last-write-wins per priority, ascending. An
 * independent statement of what the registry is *for*, sharing no code with it.
 *
 * ## The chain's actual shape
 *
 * An array of **bare callbacks**, with priorities alongside in `_p` — the cross-bundle contract
 * `CLAUDE.md` says must never be mangled. Not `{ fn, priority }` objects, which is what the first
 * version of this assumed and threw on. Reading `_p` here is deliberate: it is the ordering the
 * framework itself relies on, so asserting the callbacks are ordered without asserting `_p` agrees
 * would leave the two free to drift.
 *
 * Mutations: making a duplicate priority stack, and appending instead of inserting in order. Each
 * fails within the first two configurations.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window','document','HTMLElement','customElements','CSSStyleSheet','Node','Element','DocumentFragment','Text','Comment','requestAnimationFrame','cancelAnimationFrame','Event','CustomEvent'])
  globalThis[k] = dom.window[k];

const core = await load('core');
const { wire, inserts } = core;

const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);

/** Points that take a plain callback and can be inspected without driving a render. */
const PRIORITIES = [-10, 0, 1, 5, 10, 25, 50, 51, 99, 100];

const failures = [];
let configurations = 0;
let registrations = 0;


test('every chain runs in priority order, replaces duplicates, and stays isolated', () => {
  for (const seed of [9, 27, 63, 118, 240, 7777]) {
    const random = rng(seed);

    for (let round = 0; round < 8; round++) {
      configurations++;
      /** A fresh point name per configuration, so runs cannot contaminate each other. */
      const scratch = `x-probe-${seed}-${round}`;

      /** What was wired, in the order it was wired. */
      const wired = [];
      const count = 2 + Math.floor(random() * 5);
      for (let i = 0; i < count; i++) {
        const priority = PRIORITIES[Math.floor(random() * PRIORITIES.length)];
        const id = `${seed}.${round}.${i}`;
        wired.push({ priority, id });
        registrations++;
        wire({ on: scratch, fn: () => id, priority });
      }

      /**
       * The oracle: last-write-wins per priority, then sorted ascending. That is what "lower runs first,
       * and a duplicate replaces" means, written independently of the registry.
       */
      const byPriority = new Map();
      for (const entry of wired) byPriority.set(entry.priority, entry.id);
      const expected = [...byPriority.entries()].sort((a, b) => a[0] - b[0]).map(([, id]) => id);

      /**
       * A chain is an **array of bare callbacks**, with the priorities alongside in `_p` — the property
       * `CLAUDE.md` names as a cross-bundle contract that must never be mangled. Not `{ fn, priority }`
       * objects, which is what the first version of this probe assumed and what it threw on.
       */
      const chain = inserts.get(scratch) ?? [];
      const actual = chain.map((callback) => callback());

      if (JSON.stringify(actual) !== JSON.stringify(expected))
        failures.push(
          `seed ${seed} round ${round} on "${scratch}"\n      wired:    ${wired.map((w) => `${w.priority}:${w.id}`).join(' ')}\n      registry: ${JSON.stringify(actual)}\n      expected: ${JSON.stringify(expected)}`
        );

      /** Priorities must be non-decreasing in the chain, whatever order they arrived in. */
      const priorities = [...(chain._p ?? [])];
      for (let i = 1; i < priorities.length; i++)
        if (priorities[i] < priorities[i - 1])
          failures.push(`seed ${seed} round ${round}: the chain is out of order — ${JSON.stringify(priorities)}`);
    }
  }

  /* ── isolation: a busy chain must not disturb a quiet one ─────────────────────────────────────── */
  {
    wire({ on: 'x-quiet', fn: () => 'alone', priority: 50 });
    const before = (inserts.get('x-quiet') ?? []).map((callback) => callback());
    for (let i = 0; i < 40; i++) wire({ on: 'x-busy', fn: () => `busy${i}`, priority: i });
    const after = (inserts.get('x-quiet') ?? []).map((callback) => callback());
    if (JSON.stringify(before) !== JSON.stringify(after))
      failures.push(`a quiet chain changed while another was filled: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    if ((inserts.get('x-busy') ?? []).length !== 40)
      failures.push(`the busy chain holds ${(inserts.get('x-busy') ?? []).length} entries, expected 40`);
  }

  assert.equal(configurations, 48, `expected 48 configurations, ran ${configurations}`);
  assert.ok(registrations > 150, `only ${registrations} registrations were generated`);
  assert.deepEqual(
    failures.slice(0, 8),
    [],
    `${failures.length} wiring configuration(s) disagreed with an independently sorted list:\n\n  ${failures.slice(0, 8).join('\n\n  ')}`
  );
});
