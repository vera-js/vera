/**
 * **The slot READ API against native shadow slotting, on generated fallback shapes.**
 *
 * `slots-native-parity-fuzz.test.mjs` is the sibling of this file and compares what each slot
 * position ends up SHOWING. It reads the shadow side through `assignedNodes()` and the light side
 * through `textContent`, which is the right comparison for distribution and leaves the light
 * module's own `assignedNodes()`/`assignedElements()` entirely unexercised. A defect lived in that
 * gap: `{ flatten: true }` answered from the restore list rather than the live region, so it
 * returned nodes already removed from the document, a user's own comment written into fallback
 * content, and this module's markers around a nested slot's content. Six hundred cases of the
 * distribution fuzz saw none of it, because the rendered text was right the whole time.
 *
 * So this compares the API to the API, on both sides, for the same generated structure. The
 * generator emits ONE shape two ways — markup for a real shadow root, and `strings`/`values` with a
 * `&ref` per slot for the light host — because the slot element is deliberately not in the document
 * and a ref is the only way to hold it.
 *
 * **The fallback pool is the point.** It carries a comment, a nested `<slot>`, an empty body and a
 * whitespace-only body: the shapes where "the fallback" and "the nodes in the fallback region"
 * stop being the same list. A pool of plain text and elements — which is what the hand-written
 * test had — cannot tell the two apart and passes against either implementation.
 *
 * Only the OUTER slots are compared. A nested slot appears in the shadow root's `querySelectorAll`
 * and has no ref on the light side, so including it compares arrays of different lengths and every
 * case with a nested fallback "fails" while every entry present agrees — a false alarm that cost
 * one debugging pass here before the shapes were read rather than the count.
 *
 * Controls, because a comparison that compares nothing reports perfect behaviour: most cases must
 * read something other than empty, and the corruption test below must be caught. Measured against
 * the pre-fix implementation, this reports 290 of 600 cases wrong; against the current one, none.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';
import { extendSeeds } from './fuzz-seeds.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
  'MutationObserver', 'Comment', 'Text',
]) {
  globalThis[key] = dom.window[key];
}

const { wire } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { slots } = await load('renderer/slots');
wire([renderer, slots]);
const doc = dom.window.document;

const SEEDS = extendSeeds([20260904, 5, 313, 88888]);
let seed = 0;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (list) => list[Math.floor(random() * list.length)];

/** The shapes where the fallback region is not simply the fallback: comments, nesting, emptiness. */
const FALLBACKS = [
  'F', '<em>E</em>', 'F<!--c-->', '<!--c--><em>E</em>',
  '<slot name="i">D</slot>', '<em>E</em><slot name="i">D</slot>', '', ' ',
];
const NAMES = ['a', 'b', ''];

/**
 * One structure, emitted twice. The light half is a real template object — a `strings` array with a
 * hole per slot and a `&ref` collector in `values` — so it goes through the ordinary render path
 * rather than a special one.
 */
const build = (count) => {
  const parts = Array.from({ length: count }, () => ({ name: pick(NAMES), body: pick(FALLBACKS) }));
  const open = (part) => `<slot${part.name === '' ? '' : ` name="${part.name}"`}`;
  const markup = parts.map((part) => `<p>${open(part)}>${part.body}</slot></p>`).join('');
  const strings = [];
  const refs = [];
  let tail = '';
  for (const part of parts) {
    strings.push(`${tail}<p>${open(part)} &ref=`);
    tail = `>${part.body}</slot></p>`;
  }
  strings.push(tail);
  const values = parts.map((_, index) => (node) => { refs[index] = node; });
  return { markup, template: { strings: Object.assign(strings, { raw: [...strings] }), values }, refs };
};

/** All three reads at once, node types included — an element and a text node of the same text
 *  are different answers, and `assignedElements` differing from `assignedNodes` is the point. */
const read = (slot) => {
  const show = (nodes) =>
    nodes.map((node) => `${node.nodeType}:${node.nodeType === 1 ? node.localName : node.textContent}`).join('|');
  return [
    show(slot.assignedNodes()),
    show(slot.assignedNodes({ flatten: true })),
    show(slot.assignedElements({ flatten: true })),
  ].join(' /// ');
};

test('assignedNodes/assignedElements/flatten read the same as native shadow slotting', () => {
  const mismatches = [];
  let compared = 0;
  let nonTrivial = 0;

  for (const start of SEEDS) {
    seed = start;
    for (let run = 0; run < 150; run++) {
      const user = Array.from({ length: Math.floor(random() * 4) + 1 }, () => {
        if (pick(['element', 'element', 'text']) === 'text') return pick(['t1', ' ', 'hi']);
        const name = pick(['a', 'b', 'i', '', null]);
        return `<u${name === null ? '' : ` slot="${name}"`}>${Math.floor(random() * 90) + 10}</u>`;
      }).join('');
      const { markup, template, refs } = build(Math.floor(random() * 3) + 1);

      const shadowHost = doc.createElement('div');
      shadowHost.innerHTML = user;
      doc.body.append(shadowHost);
      shadowHost.attachShadow({ mode: 'open' }).innerHTML = markup;
      /** `p > slot` and not `slot`: a nested one has no counterpart ref on the light side. */
      const native = [...shadowHost.shadowRoot.querySelectorAll('p > slot')].map(read);

      const lightHost = doc.createElement('div');
      lightHost.innerHTML = user;
      doc.body.append(lightHost);
      renderInto(template, lightHost);
      const light = refs.map((slot) => (slot ? read(slot) : 'NO REF — the slot never mounted'));

      compared++;
      if (native.some((reading) => reading !== ' ///  /// ')) nonTrivial++;
      if (JSON.stringify(native) !== JSON.stringify(light))
        mismatches.push({ seed: start, run, user, markup, native, light });

      shadowHost.remove();
      lightHost.remove();
    }
  }

  assert.equal(compared, SEEDS.length * 150);
  assert.ok(nonTrivial > compared * 0.5,
    `CONTROL: only ${nonTrivial} of ${compared} cases read anything at all — the run proves little`);
  assert.deepEqual(mismatches, [], 'every read must answer as the platform answers');
});

test('CONTROL — the comparison detects a difference when there is one', () => {
  const host = doc.createElement('div');
  doc.body.append(host);
  host.attachShadow({ mode: 'open' }).innerHTML = '<p><slot name="a">F<!--c--></slot></p>';
  const slot = host.shadowRoot.querySelector('slot');

  assert.equal(read(slot), ' /// 3:F /// ', 'the oracle flattens to the slottable, without the comment');
  /** The exact corruption the fix removed: hand back the region rather than its slottables. */
  const leaky = { assignedNodes: (o) => (o?.flatten ? [...slot.childNodes] : []), assignedElements: () => [] };
  assert.notEqual(read(leaky), read(slot), 'and a reading that includes the comment is caught');
  host.remove();
});
