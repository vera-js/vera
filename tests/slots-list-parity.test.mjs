/**
 * **A list that renders a light host's children, against the platform.**
 *
 * `@verajs/renderer/slots` distributes by MOVING nodes into the component's tree. Native slotting
 * PROJECTS them — they stay children of the host — and everything in the renderer that walks a
 * part's range was written against that second, gentler world. A list rendering a host's children
 * therefore ends up split: items inside the component, the part's own markers left behind in the
 * host. Three separate paths assumed otherwise, and they failed in three different ways:
 *
 * 1. **keyed reorder threw `NotFoundError`** — `$m` asked the host to insert before a reference
 *    that had moved into the component. Unconditional, both builds, first reorder.
 * 2. **A plain list losing a row threw the same** — the shrink path walked the doomed run calling
 *    `parent.removeChild`. No keyed list involved: `<x-card>${rows}</x-card>` was enough.
 * 3. **Clearing removed nothing** — `_clear()` found the markers adjacent and stopped. Its other
 *    branch was worse: nothing precedes the start and nothing follows the end, so it would have
 *    taken `parent.textContent = ''` and wiped the host, component render and all.
 *
 * Ordering had two more, both silent: `slotted()` answered in CAPTURE order while native answers in
 * flat-tree order, and a refill re-placed everything from the bucket, so a correctly reordered list
 * snapped back the next time anything touched it.
 *
 * **The oracle is the same component with a shadow root.** Not a table of expected strings — those
 * encode today's answer and drift into being the spec. Every case below runs the identical markup
 * both ways and asserts light equals shadow, so the platform stays the definition and this test
 * fails when we diverge from it rather than when we change our mind.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window','document','HTMLElement','customElements','CSSStyleSheet','Node','Element','DocumentFragment','Text','Comment','requestAnimationFrame','cancelAnimationFrame','Event','CustomEvent','MutationObserver','NodeFilter'])
  globalThis[key] = dom.window[key];

const { init, html, render, wire } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { keyed } = await load('renderer/keyed');
const { slots, slotted } = await load('renderer/slots');
wire([renderer, slots]);

const D = dom.window.document;
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(r));

/** The SAME template both ways — only the argument to `init` differs, which is the whole claim. */
for (const [tag, mode] of [['p-light', undefined], ['p-shadow', { mode: 'open' }]])
  customElements.define(
    tag,
    class extends dom.window.HTMLElement {
      connectedCallback() {
        init(this, mode);
        render(() => html`<div class="box"><slot name="a">EMPTY</slot></div>`);
      }
    }
  );

/**
 * One `draw` per mode, built once and called many times. Two template literals are two templates
 * even with identical text — the engine interns per CALL SITE — so writing the markup inside the
 * loop would rebuild instead of update and every conclusion here would be drawn about the wrong
 * thing (`CLAUDE.md`).
 */
const DRAW = {
  'p-light': {
    keyed: (ids) => html`<p-light>${ids.map((id) => keyed(id, html`<b slot="a" data-id=${id}>${id}</b>`))}</p-light>`,
    plain: (ids) => html`<p-light>${ids.map((id) => html`<b slot="a" data-id=${id}>${id}</b>`)}</p-light>`,
  },
  'p-shadow': {
    keyed: (ids) => html`<p-shadow>${ids.map((id) => keyed(id, html`<b slot="a" data-id=${id}>${id}</b>`))}</p-shadow>`,
    plain: (ids) => html`<p-shadow>${ids.map((id) => html`<b slot="a" data-id=${id}>${id}</b>`)}</p-shadow>`,
  },
};

/** Runs a script of list states and reports what the component's slot held after each one. */
const runScript = async (tag, kind, script) => {
  const page = D.createElement('div');
  D.body.append(page);
  const draw = DRAW[tag][kind];
  const seen = [];
  for (const ids of script) {
    renderInto(draw(ids), page);
    await frame();
    await frame();
    const host = page.querySelector(tag);
    seen.push(slotted(host, 'a').map((node) => node.dataset.id).join('') || '(empty)');
  }
  page.remove();
  return seen;
};

/** Reorder, insert in the middle, remove, insert at the head, empty, refill. */
const SCRIPT = [
  ['a', 'b', 'c'],
  ['c', 'a', 'b'],
  ['c', 'x', 'a', 'b'],
  ['c', 'x', 'b'],
  ['n', 'c', 'x', 'b'],
  [],
  ['p', 'q'],
];

for (const kind of ['keyed', 'plain']) {
  test(`a ${kind} list of a light host's children behaves as the platform does`, async () => {
    const shadow = await runScript('p-shadow', kind, SCRIPT);
    /**
     * CONTROL. Native is only an oracle if it actually did the work: a run of `(empty)` would make
     * every assertion below pass while proving nothing, which is this repository's most expensive
     * recurring mistake.
     */
    assert.equal(shadow[0], 'abc', `CONTROL: native distributed nothing — got ${JSON.stringify(shadow)}`);
    assert.notEqual(shadow[1], shadow[0], 'CONTROL: native did not even reorder, so nothing is being compared');

    const light = await runScript('p-light', kind, SCRIPT);
    for (let i = 0; i < SCRIPT.length; i++)
      assert.equal(light[i], shadow[i],
        `step ${i} (${JSON.stringify(SCRIPT[i])}): light DOM says ${light[i]}, the platform says ${shadow[i]}`);
  });
}

/**
 * **A list whose items go to DIFFERENT slots**, which is the case that decided the design.
 *
 * Positioning against the part's markers cannot be repaired for this one — a single part's content
 * is in two containers, and no pair of anchors brackets both. Placing each item before its
 * successor IN ITS OWN CONTAINER needs no anchors at all, so this case comes out right for the same
 * reason the simple one does, rather than as a special case.
 */
test('one keyed list feeding two different slots orders each of them independently', async () => {
  customElements.define(
    'p-two',
    class extends dom.window.HTMLElement {
      connectedCallback() {
        init(this); // LIGHT
        render(() => html`<p class="A"><slot name="a">-</slot></p><q class="B"><slot name="b">-</slot></q>`);
      }
    }
  );
  const page = D.createElement('div');
  D.body.append(page);
  const draw = (rows) =>
    html`<p-two>${rows.map((row) => keyed(row.id, html`<b slot=${row.to} data-id=${row.id}>${row.id}</b>`))}</p-two>`;

  renderInto(draw([{ id: '1', to: 'a' }, { id: '2', to: 'b' }, { id: '3', to: 'a' }]), page);
  await frame();
  await frame();
  const host = page.querySelector('p-two');
  const read = (name) => slotted(host, name).map((node) => node.dataset.id).join('');
  assert.equal(read('a'), '13', 'CONTROL: the initial split distributed to both slots');
  assert.equal(read('b'), '2');

  renderInto(draw([{ id: '3', to: 'a' }, { id: '1', to: 'a' }, { id: '2', to: 'b' }]), page);
  await frame();
  await frame();
  assert.equal(read('a'), '31', 'each slot follows the logical order restricted to its own members');
  assert.equal(read('b'), '2');
  page.remove();
});

/**
 * **The host must still be standing.** `_clear()`'s fast path is `parent.textContent = ''`, taken
 * when the part appears to own its parent outright — which is exactly how a relocated list looks
 * from the host, where its markers sit alone. That would delete the component's own rendered
 * output, so the failure is not "the list did not clear" but "the component is gone".
 */
test('clearing a relocated list leaves the component itself intact', async () => {
  const page = D.createElement('div');
  D.body.append(page);
  const draw = DRAW['p-light'].keyed;
  renderInto(draw(['a', 'b', 'c']), page);
  await frame();
  await frame();
  const host = page.querySelector('p-light');
  assert.ok(host.querySelector('.box'), 'CONTROL: the component rendered in the first place');

  renderInto(draw([]), page);
  await frame();
  await frame();
  assert.ok(host.querySelector('.box'), 'the component render was wiped along with the list');
  assert.deepEqual(slotted(host, 'a'), [], 'and the list really is empty');
  assert.equal(host.querySelector('slot, .box').textContent.trim(), 'EMPTY',
    'with the fallback back on screen, as an empty slot shows');
  page.remove();
});
