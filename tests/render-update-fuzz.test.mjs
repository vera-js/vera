/**
 * Update *sequences*, fuzzed against a fresh render.
 *
 * `render-differential-fuzz` renders each shape once, and says so. Everything interesting in a
 * template renderer happens on the **second** render: parts are reused, a value changes type, a list
 * grows and shrinks, a directive is replaced by a plain value. A first render cannot reach any of it.
 *
 * **The oracle.** For any sequence of values, rendering `v1…vN` into one host must end at the same
 * DOM as rendering `vN` alone into a fresh one. That is what "updates in place" means — and any
 * difference is a part that kept state it should have released.
 *
 * ## What this cannot see, established by mutation rather than assumed
 *
 * A fresh render is the oracle, so **a defect that affects both paths equally is invisible here**.
 * Making an attribute part never call `removeAttribute` leaves this suite completely green: the
 * update leaves `class="null"` behind, and so does the fresh render, so the two agree on the wrong
 * answer. That is not a gap to fix by widening this file — it is what `hydrate-parity`,
 * `render-parity` and the example-based suites are for.
 *
 * What it *does* catch is state a reused part failed to release. Committing only on the first render
 * — `value !== this._committed && this._committed === UNSET` — fails it immediately across attribute,
 * boolean-attribute and property shapes.
 *
 * Both mutations were run. The first one surviving is the reason the limitation above is stated as
 * fact instead of as a caveat.
 *
 * Seeded, per `CLAUDE.md`, and each shape is one function so every render in a sequence shares a call
 * site — otherwise each render would be a different template and every "update" a rebuild.
 */
import { load } from './dist.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'MouseEvent',
])
  globalThis[key] = dom.window[key];

const { html } = await load('core');
const { renderInto, hold } = await load('renderer');
const { keyed } = await load('renderer/keyed');
const { spread } = await load('renderer/spread');

const D = dom.window.document;
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);

/** Chosen to cross type boundaries, which is where a reused part has to change strategy. */
const VALUES = ['text', '', 0, 1, null, undefined, false, true, 42, 'other', ['a', 'b'], [], ['only']];

const SHAPES = [
  ['plain hole', (v) => html`<p>${v}</p>`],
  ['two holes', (v) => html`<p>${v}|${v}</p>`],
  ['attribute', (v) => html`<p class=${v}>t</p>`],
  ['boolean attribute', (v) => html`<input ?disabled=${v}>`],
  ['property', (v) => html`<input .value=${String(v ?? '')}>`],
  ['nested template', (v) => html`<div>${html`<i>${v}</i>`}</div>`],
  ['plain list', (v) => html`<ul>${(Array.isArray(v) ? v : [v]).map((x) => html`<li>${x}</li>`)}</ul>`],
  [
    'keyed list',
    (v) => html`<ul>${(Array.isArray(v) ? v : [v]).map((x, i) => keyed(`${x}-${i}`, html`<li>${x}</li>`))}</ul>`,
  ],
  ['spread', (v) => html`<p ${spread({ class: String(v ?? ''), 'data-n': v })}>t</p>`],
  ['hold', (v) => html`<div>${hold(v ? html`<em>${v}</em>` : html`<b>none</b>`)}</div>`],
  ['conditional subtree', (v) => html`<div>${v ? html`<p>${v}</p>` : html`<span>empty</span>`}</div>`],
  ['list inside text', (v) => html`<div>a${(Array.isArray(v) ? v : [v]).map((x) => html`<i>${x}</i>`)}b</div>`],
];

/**
 * Properties as well as attributes. `.value` and `.disabled` write no attribute, so an attribute-only
 * comparison would report agreement for a property left stale — which is one of the shapes here.
 */
const canonical = (host) => {
  const out = [];
  const walk = (node, depth) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) out.push(`${depth}t ${JSON.stringify(child.data)}`);
      else if (child.nodeType === 1) {
        const attributes = [...child.attributes].map((a) => `${a.name}=${a.value}`).sort();
        out.push(
          `${depth}<${child.localName} ${attributes.join(' ')}> value=${JSON.stringify(child.value ?? null)} disabled=${child.disabled ?? null}`
        );
        walk(child, depth + 1);
      }
    }
  };
  walk(host, 0);
  return out.join('\n');
};

const SEEDS = [1, 5, 11, 23, 77, 2024];
const ROUNDS = 80;

test('a sequence of updates ends where a fresh render of the last value starts', () => {
  const failures = [];
  let cases = 0;

  for (const seed of SEEDS) {
    const random = rng(seed);
    for (let round = 0; round < ROUNDS; round++) {
      const [name, shape] = SHAPES[round % SHAPES.length];
      const length = 2 + Math.floor(random() * 3);
      const sequence = Array.from({ length }, () => VALUES[Math.floor(random() * VALUES.length)]);
      const where = `seed ${seed}, ${name}, ${JSON.stringify(sequence)}`;
      cases++;

      const updated = D.createElement('div');
      try {
        for (const value of sequence) renderInto(shape(value), updated);
      } catch (error) {
        failures.push(`${where}\n      threw during the update sequence: ${error.message}`);
        continue;
      }

      const fresh = D.createElement('div');
      try {
        renderInto(shape(sequence[sequence.length - 1]), fresh);
      } catch (error) {
        failures.push(`${where}\n      a fresh render of the last value threw: ${error.message}`);
        continue;
      }

      const afterUpdates = canonical(updated);
      const fromScratch = canonical(fresh);
      if (afterUpdates !== fromScratch)
        failures.push(`${where}\n      after updates: ${JSON.stringify(afterUpdates)}\n      fresh render:  ${JSON.stringify(fromScratch)}`);
    }
  }

  assert.equal(cases, SEEDS.length * ROUNDS, 'the generator did not produce the expected number of sequences');
  assert.deepEqual(
    failures.slice(0, 10),
    [],
    `${failures.length} of ${cases} update sequences left the DOM somewhere a fresh render would not:\n\n  ${failures.slice(0, 10).join('\n\n  ')}`
  );
});
