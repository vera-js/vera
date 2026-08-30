/**
 * Lifecycle sequences, generated: connect, disconnect, move between parents, write, reconnect.
 *
 * **The oracle needs no comparison against the framework**, which is what makes it the strongest one
 * in this repo. Every effect run must be balanced by exactly one cleanup — before its next run, or at
 * teardown. That is the effect contract stated as arithmetic:
 *
 * ```
 * cleanups === runs        while torn down
 * cleanups === runs - 1    while set up
 * ```
 *
 * Anything else is one of two silent failures. Too few cleanups is a **leak**: a listener, timer or
 * subscription outliving the component that made it, which shows up much later as a handler firing on
 * a page that has moved on. Too many is a **double teardown**: a cleanup undoing something it did not
 * do.
 *
 * `render-update-fuzz` compares the framework against itself and records that a defect affecting both
 * paths equally is invisible to it. This has no such bound — the invariant is arithmetic, not a second
 * opinion from the same code.
 *
 * **A move is the case worth generating.** `appendChild` to a different parent fires
 * `disconnectedCallback` and then `connectedCallback`, synchronously, so a component is torn down and
 * rebuilt by an operation that looks like neither. It is also how the sequences here find the
 * imbalance: skipping a single cleanup on teardown is caught first at `["connect","move"]`.
 *
 * ## Which half of the invariant this actually reaches
 *
 * The **leak** direction is caught: dropping one cleanup at teardown fails immediately.
 *
 * The **double-teardown** direction is *not reached*, and the reason is that it appears unreachable
 * through the DOM rather than untested. Removing `init`'s `this._cleanups?.clear()` — so a torn-down
 * element keeps its cleanup set — leaves this suite green, because every disconnect in these
 * sequences is either final or followed by a connect, and connecting re-runs `init`, which installs a
 * fresh set. Calling `remove()` on an already-removed element fires no second `disconnectedCallback`,
 * so nothing in the platform's vocabulary tears an element down twice.
 *
 * That makes `clear()` a guard against a path the DOM does not offer, which is a reasonable thing to
 * keep and a dishonest thing to claim coverage of. Stated here so a green run is not read as
 * verifying it.
 */
import { load } from './dist.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="one"></div><div id="two"></div></body>', {
  pretendToBeVisual: true,
});
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'MouseEvent',
])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer } = await load('renderer');
core.wire([renderer]);
const { init, createStore, render, useEffect, html } = core;

const D = dom.window.document;
const one = D.getElementById('one');
const two = D.getElementById('two');
const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));

const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);

const SEEDS = [4, 17, 31, 66, 123, 9001];
const ROUNDS = 12;
let nextTag = 0;

test('every effect run is balanced by exactly one cleanup, through any lifecycle sequence', async () => {
  const failures = [];
  let components = 0;
  let operations = 0;

  for (const seed of SEEDS) {
    const random = rng(seed);

    for (let round = 0; round < ROUNDS; round++) {
      components++;
      const name = `x-life-${nextTag++}`;
      const counts = { runs: 0, cleanups: 0 };
      let store;

      dom.window.customElements.define(
        name,
        class extends dom.window.HTMLElement {
          connectedCallback() {
            init(this, { mode: 'open' });
            store = createStore({ n: 0 });
            useEffect(() => {
              counts.runs++;
              void store.n;
              return () => {
                counts.cleanups++;
              };
            });
            render(() => html`<i>${store.n}</i>`);
          }
        }
      );

      const element = D.createElement(name);
      let connected = false;
      const history = [];

      const balanced = (label) => {
        const expected = connected ? counts.runs - 1 : counts.runs;
        if (counts.cleanups !== expected)
          failures.push(
            `seed ${seed} ${JSON.stringify(history)} (after ${label}): runs=${counts.runs} cleanups=${counts.cleanups}, expected ${expected}`
          );
      };

      const steps = 4 + Math.floor(random() * 5);
      for (let step = 0; step < steps; step++) {
        const action = random();
        operations++;
        if (!connected) {
          history.push('connect');
          one.appendChild(element);
          connected = true;
        } else if (action < 0.4) {
          history.push('disconnect');
          element.remove();
          connected = false;
        } else if (action < 0.7) {
          history.push('move');
          (element.parentElement === one ? two : one).appendChild(element);
        } else {
          history.push('write');
          store.n++;
        }
        await frame();
        balanced(history[history.length - 1]);
      }

      /** End torn down, which is the state the balance reads most plainly in. */
      if (connected) {
        element.remove();
        await frame();
        connected = false;
        history.push('final disconnect');
        balanced('final');
      }
    }
  }

  assert.equal(components, SEEDS.length * ROUNDS, 'the generator did not build the expected number of components');
  assert.ok(operations > 300, `only ${operations} lifecycle operations were generated`);
  assert.deepEqual(
    failures.slice(0, 10),
    [],
    `${failures.length} imbalance(s) across ${operations} operations — each is a leaked or double-run cleanup:\n  ${failures.slice(0, 10).join('\n  ')}`
  );
});
