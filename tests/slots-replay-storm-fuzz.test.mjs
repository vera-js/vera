/**
 * **What an OUTER template does to a light host's children, against an oracle computed from the data.** The page's
 * template writes the host's light children through bindings — keyed rows reordered, inserted, removed, re-slotted,
 * changing shape between an element, a two-element fragment aimed at two different slots, and a bare text node —
 * and slots replays every one of those writes into the binding's run. The expected content of each slot is computed
 * from the data alone (the light order, filtered by each node's slot name), never read back from the DOM, so a replay
 * that loses, duplicates or misorders a node cannot agree with it by accident.
 *
 * Controls: a healthy share of steps must leave each named slot non-empty, or the run compared fallbacks.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';
import { extendSeeds } from './fuzz-seeds.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment',
  'Event', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver']) globalThis[k] = dom.window[k];
const { html, wire, init } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { slots, slotted } = await load('renderer/slots');
const { keyed } = await load('renderer/keyed');
wire([renderer, slots]);
const doc = dom.window.document;

customElements.define('fz-host', class extends dom.window.HTMLElement {
  connectedCallback() {
    init(this);
    renderInto(html`<header><slot name="a">FA</slot></header><main><slot>FD</slot></main><footer><slot name="b">FB</slot></footer>`, this);
  }
});

const SEEDS = extendSeeds([31337, 271828, 141421, 173205, 223606, 161803]);
let seed = 0;
const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (list) => list[Math.floor(random() * list.length)];
const NAMES = ['a', 'b', '', 'zz'];
const SHAPES = ['el', 'frag', 'text'];

/** One row's template and the light nodes it contributes, in order, as `[slotName, text]`. */
const ROW_EL = (id, slot) => html`<i slot=${slot}>${id}</i>`;
const ROW_FRAG = (id, slot, slot2) => html`<b slot=${slot}>${id}</b><u slot=${slot2}>${id}u</u>`;
/** A row that is bare text: a template holding only a text binding (keyed rows are always templates). */
const ROW_TEXT = (id) => html`${`t${id}`}`;
const rowValue = (row) =>
  row.shape === 'el' ? keyed(row.id, ROW_EL(row.id, row.slot))
  : row.shape === 'frag' ? keyed(row.id, ROW_FRAG(row.id, row.slot, row.slot2))
  : keyed(row.id, ROW_TEXT(row.id));
const rowNodes = (row) =>
  row.shape === 'el' ? [[row.slot, row.id]]
  : row.shape === 'frag' ? [[row.slot, row.id], [row.slot2, `${row.id}u`]]
  : [['', `t${row.id}`]];

const LEADS = [null, 'L', 'S'];
const leadValue = (lead) => (lead === null ? null : lead === 'L' ? 'L' : html`<s slot="a">S</s>`);
const leadNodes = (lead) => (lead === null ? [] : lead === 'L' ? [['', 'L']] : [['a', 'S']]);

/** One draw for every step: one template literal, so updates are updates, never rebuilds. */
const draw = (state) => html`<fz-host>${leadValue(state.lead)}<em slot="b">E</em>${state.rows.map(rowValue)}${leadValue(state.tail)}</fz-host>`;

/** The oracle: each slot's content, from the data — light order, filtered by slot name. */
const expected = (state) => {
  const nodes = [...leadNodes(state.lead), ['b', 'E'], ...state.rows.flatMap(rowNodes), ...leadNodes(state.tail)];
  const out = {};
  for (const name of ['a', '', 'b']) out[name] = nodes.filter(([slot]) => slot === name).map(([, text]) => text);
  return out;
};

const mutate = (state, next) => {
  const op = pick(['insert', 'insert', 'remove', 'move', 'reslot', 'reshape', 'reverse', 'lead', 'tail']);
  const rows = state.rows;
  if (op === 'insert' || rows.length === 0)
    rows.splice(Math.floor(random() * (rows.length + 1)), 0, { id: `r${next()}`, slot: pick(NAMES), slot2: pick(NAMES), shape: pick(SHAPES) });
  else if (op === 'remove') rows.splice(Math.floor(random() * rows.length), 1);
  else if (op === 'move') {
    const [row] = rows.splice(Math.floor(random() * rows.length), 1);
    rows.splice(Math.floor(random() * (rows.length + 1)), 0, row);
  } else if (op === 'reslot') {
    const row = pick(rows);
    if (random() < 0.5) row.slot = pick(NAMES);
    else row.slot2 = pick(NAMES);
  } else if (op === 'reshape') pick(rows).shape = pick(SHAPES);
  else if (op === 'reverse') rows.reverse();
  else if (op === 'lead') state.lead = pick(LEADS);
  else state.tail = pick(LEADS);
  return op;
};

test('an outer template\'s keyed reorders, inserts, removals, re-slots and shape changes land where the data says', () => {
  const divergences = [];
  let steps = 0;
  let filled = 0;
  for (const s of SEEDS) {
    seed = s;
    let counter = 0;
    const next = () => counter++;
    const page = doc.createElement('div');
    doc.body.append(page);
    const state = { lead: null, tail: null, rows: [] };
    const script = [];
    for (let step = 0; step < 80; step++) {
      script.push(mutate(state, next));
      /** Rows as they are now, copied — the template reads them during the render. */
      renderInto(draw({ ...state, rows: state.rows.map((row) => ({ ...row })) }), page);
      steps++;
      const host = page.querySelector('fz-host');
      const want = expected(state);
      const got = {
        a: slotted(host, 'a').map((n) => n.textContent),
        '': slotted(host, '').map((n) => n.textContent),
        b: slotted(host, 'b').map((n) => n.textContent),
      };
      /** And what is ON SCREEN: each section shows its slot's content, or the fallback when it has none. */
      const screen = {
        a: host.querySelector('header').textContent,
        '': host.querySelector('main').textContent,
        b: host.querySelector('footer').textContent,
      };
      const fallback = { a: 'FA', '': 'FD', b: 'FB' };
      if (want.a.length > 0 && want.b.length > 0) filled++;
      for (const name of ['a', '', 'b']) {
        const shown = want[name].length > 0 ? want[name].join('') : fallback[name];
        if (JSON.stringify(got[name]) !== JSON.stringify(want[name]) || screen[name] !== shown) {
          divergences.push({ seed: s, step, name, want: want[name], got: got[name], screen: screen[name], script: script.slice(-6).join(',') });
          break;
        }
      }
      if (divergences.length > 0 && divergences[divergences.length - 1].seed === s && divergences[divergences.length - 1].step === step) break;
    }
    page.remove();
  }
  console.log(`replay storm: ${SEEDS.length} seeds, ${steps} renders, ${filled} with both named slots filled`);
  assert.ok(filled > steps / 4, `CONTROL: only ${filled} of ${steps} renders filled both named slots — the run compared fallbacks`);
  for (const d of divergences) console.log('DIVERGE', JSON.stringify(d));
  assert.deepEqual(divergences, [], `${divergences.length} seed(s) diverged from the data`);
});
