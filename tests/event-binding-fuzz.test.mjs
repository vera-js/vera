/**
 * Event bindings under generated handler sequences.
 *
 * `renderer.ts` states the contract: *"Stable listener registered once; swapping the handler never
 * touches the DOM."* Three invariants follow, all checkable by counting rather than by comparing the
 * framework against itself.
 *
 * 1. **One click runs the live handler exactly once**, however many times the handler has been
 *    swapped, including through `undefined`, `false`, `null` and back.
 * 2. **The live handler is the last one bound**, and no earlier one survives alongside it.
 * 3. **Replacing the element in the template detaches its behaviour** — a click on what is there now
 *    does not reach a handler bound to what was there before.
 *
 * ## The dedup this quietly depends on
 *
 * A `function -> undefined -> function` sequence makes the renderer call `addEventListener` a
 * **second** time: it nulls `_handler` without removing the listener, so the next non-null value sees
 * `_handler === null` and re-registers. Measured, and it is correct — the listener it passes is the
 * *part object*, and the platform ignores an identical `(type, listener, capture)` triple. Verified
 * with no framework involved: the same listener object added three times fires once.
 *
 * That makes **listener identity load-bearing**. If the part ever passed a fresh closure instead of
 * itself, dedup would stop applying and every swap through null would add another live listener —
 * silently, and only for components that toggle a handler off and on. Invariant 1 is what would
 * notice, which is why it counts *fires* rather than `addEventListener` calls.
 *
 * A first version asserted `addEventListener` was called at most once per element and reported 153
 * failures; the call count is 2 and the behaviour is right. It also asserted that a handler must not
 * fire on an element removed from the template — but dispatching directly on a detached node runs its
 * listeners in any DOM, with or without a framework, so that invariant was about the platform rather
 * than about this code.
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
const { renderInto } = await load('renderer');

const D = dom.window.document;
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
const click = (element) => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

const SEEDS = [6, 15, 28, 73, 190, 5150];
const ROUNDS = 15;

test('a click runs the last-bound handler exactly once, through any swap sequence', () => {
  const failures = [];
  let swaps = 0;

  for (const seed of SEEDS) {
    const random = rng(seed);

    for (let round = 0; round < ROUNDS; round++) {
      const host = D.createElement('div');
      D.body.appendChild(host);
      /** One call site, so every render updates the same part rather than building a new one. */
      const draw = (handler) => html`<button @click=${handler}>go</button>`;

      const fired = [];
      const named = {
        a: () => fired.push('a'),
        b: () => fired.push('b'),
        c: () => fired.push('c'),
        obj: { handleEvent: () => fired.push('obj') },
      };
      const choices = [
        ['a', named.a], ['b', named.b], ['c', named.c],
        ['none', undefined], ['none', false], ['none', null],
        ['obj', named.obj],
      ];

      const steps = 3 + Math.floor(random() * 5);
      for (let step = 0; step < steps; step++) {
        const [label, handler] = choices[Math.floor(random() * choices.length)];
        renderInto(draw(handler), host);
        swaps++;

        fired.length = 0;
        click(host.querySelector('button'));

        const expected = label === 'none' ? [] : [label];
        if (JSON.stringify(fired) !== JSON.stringify(expected))
          failures.push(
            `seed ${seed} round ${round} step ${step}: bound ${label}, one click fired ${JSON.stringify(fired)}, expected ${JSON.stringify(expected)}`
          );
      }

      /** Invariant 3: the template moved on, so a click on what is there now reaches nothing. */
      renderInto(html`<p>replaced</p>`, host);
      fired.length = 0;
      click(host.querySelector('p'));
      if (fired.length)
        failures.push(`seed ${seed} round ${round}: after the button was replaced, a click on its successor fired ${JSON.stringify(fired)}`);

      host.remove();
    }
  }

  assert.ok(swaps > 300, `only ${swaps} handler swaps were generated`);
  assert.deepEqual(
    failures.slice(0, 10),
    [],
    `${failures.length} of ${swaps} swaps misbehaved:\n  ${failures.slice(0, 10).join('\n  ')}`
  );
});

/**
 * The dedup above, asserted directly rather than left as a comment — this is the property that makes
 * the re-registration harmless, and it lives in the platform, not in this framework.
 */
test('toggling a handler off and back on leaves exactly one live listener', () => {
  const host = D.createElement('div');
  D.body.appendChild(host);
  let fired = 0;
  const handler = () => fired++;
  const draw = (value) => html`<button @click=${value}>go</button>`;

  try {
    renderInto(draw(handler), host);
    renderInto(draw(undefined), host);
    renderInto(draw(handler), host);
    renderInto(draw(false), host);
    renderInto(draw(handler), host);

    fired = 0;
    click(host.querySelector('button'));
    assert.equal(fired, 1, 'toggling through null re-registered a second live listener');
  } finally {
    host.remove();
  }
});
