/**
 * **Read a host's own sections as its CHILDREN, never with `querySelector(':scope > …')`.** jsdom resolves `:scope`
 * wrongly when the same tag nests in itself — an `fz-host` inside an `fz-host` — and answers the INNER host's
 * `footer`: every seed of this harness once "diverged" (data right, screen = fallback) on a page that was correct.
 * Extended by vera-5a (2026-10-02) with `hold()` around a slotted binding, a spread-driven `slot=` row shape, and a
 * nested slot host receiving its own keyed rows, checked against its own oracle.
 */
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
import { shown } from './rendered-text.mjs';
import { extendSeeds } from './fuzz-seeds.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment',
  'Event', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver']) globalThis[k] = dom.window[k];
const { html, wire, init } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { slots, slotted } = await load('renderer/slots');
const { keyed } = await load('renderer/keyed');
const { spread } = await load('renderer/spread');
const { hold } = await load('renderer');
wire([renderer, slots]);
const doc = dom.window.document;


customElements.define('fz-host', class extends dom.window.HTMLElement {
  connectedCallback() {
    init(this);
    renderInto(html`<header><slot name="a">FA</slot></header><main><slot>FD</slot></main><footer><slot name="b">FB</slot></footer>`, this);
  }
});

/**
 * **A commit into a run DURING the host's own first render** (vera-5a, 2026-10-02 — the path `unrun()` exists for).
 * `fz-fire` fires from a ref in its own first render and commits the FINAL rows into the run an applier first filled
 * with the PRE rows — by then the slots module has already distributed the pre rows, leaving stand-ins in the run. The
 * oracle is the final rows, by slot name, never read back from the DOM.
 */
let fireFinal = null;
let firePart = null;
function applyFire(part, previous) {
  if (previous) return previous;
  part._$commit$(this.pre.map(rowValue));
  firePart = part;
  return {};
}
const FIRE = () => html`<span &ref=${() => { const rows = fireFinal; fireFinal = null; if (rows !== null) firePart._$commit$(rows.map(rowValue)); }}></span><header><slot name="a">FA</slot></header><main><slot>FD</slot></main><footer><slot name="b">FB</slot></footer>`;
customElements.define('fz-fire', class extends dom.window.HTMLElement {
  connectedCallback() {
    init(this);
    renderInto(FIRE(), this);
  }
});
/** In a LIST: a key is honored only there — a lone keyed value updates the same element, and its render is no longer a first. */
const fireValue = (fire) => (fire === null ? null : [keyed(fire.gen, html`<fz-fire class="fire">${{ _$child$: applyFire, pre: fire.pre }}</fz-fire>`)]);

const SEEDS = extendSeeds([31337, 271828, 141421, 173205, 223606, 161803]);
let seed = 0;
const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (list) => list[Math.floor(random() * list.length)];
const NAMES = ['a', 'b', '', 'zz'];
const SHAPES = ['el', 'frag', 'text', 'spread'];

/** One row's template and the light nodes it contributes, in order, as `[slotName, text]`. */
const ROW_EL = (id, slot) => html`<i slot=${slot}>${id}</i>`;
const ROW_FRAG = (id, slot, slot2) => html`<b slot=${slot}>${id}</b><u slot=${slot2}>${id}u</u>`;
/** A row that is bare text: a template holding only a text binding (keyed rows are always templates). */
const ROW_TEXT = (id) => html`${`t${id}`}`;
const ROW_SPREAD = (id, slot) => html`<i ${spread({ slot })}>${id}s</i>`;
const rowValue = (row) =>
  row.shape === 'el' ? keyed(row.id, ROW_EL(row.id, row.slot))
  : row.shape === 'frag' ? keyed(row.id, ROW_FRAG(row.id, row.slot, row.slot2))
  : row.shape === 'spread' ? keyed(row.id, ROW_SPREAD(row.id, row.slot))
  : keyed(row.id, ROW_TEXT(row.id));
const rowNodes = (row) =>
  row.shape === 'el' ? [[row.slot, row.id]]
  : row.shape === 'frag' ? [[row.slot, row.id], [row.slot2, `${row.id}u`]]
  : row.shape === 'spread' ? [[row.slot, `${row.id}s`]]
  : [['', `t${row.id}`]];

const LEADS = [null, 'L', 'S'];
const leadValue = (lead) => (lead === null ? null : lead === 'L' ? 'L' : html`<s slot="a">S</s>`);
const leadNodes = (lead) => (lead === null ? [] : lead === 'L' ? [['', 'L']] : [['a', 'S']]);

const HX = () => html`<i slot="a">HX</i>`;
const HY = () => html`<b slot="b">HY</b><u>HY2</u>`;
const heldValue = (h) => hold(h === 'x' ? HX() : h === 'y' ? HY() : null);
const heldNodes = (h) => (h === 'x' ? [['a', 'HX']] : h === 'y' ? [['b', 'HY'], ['', 'HY2']] : []);
const composed = (exp) => ['a', '', 'b'].map((n) => (exp[n].length ? exp[n].join('') : { a: 'FA', '': 'FD', b: 'FB' }[n])).join('');
/** One draw for every step: one template literal, so updates are updates, never rebuilds. */
const draw = (state) => html`<fz-host>${leadValue(state.lead)}${heldValue(state.held)}<em slot="b">E</em>${state.rows.map(rowValue)}<fz-host slot="a" class="inner">${state.inner.map(rowValue)}</fz-host>${leadValue(state.tail)}</fz-host>${fireValue(state.fire)}`;

/** The oracle: each slot's content, from the data — light order, filtered by slot name. */
const innerExpected = (state) => {
  const nodes = state.inner.flatMap(rowNodes);
  const out = {};
  for (const name of ['a', '', 'b']) out[name] = nodes.filter(([slot]) => slot === name).map(([, text]) => text);
  return out;
};
const expected = (state) => {
  const inner = innerExpected(state);
  const nodes = [...leadNodes(state.lead), ...heldNodes(state.held), ['b', 'E'], ...state.rows.flatMap(rowNodes), ['a', composed(inner)], ...leadNodes(state.tail)];
  const out = {};
  for (const name of ['a', '', 'b']) out[name] = nodes.filter(([slot]) => slot === name).map(([, text]) => text);
  return out;
};

const rowsOf = (next, prefix) => Array.from({ length: Math.floor(random() * 5) }, () => ({ id: `${prefix}${next()}`, slot: pick(NAMES), slot2: pick(NAMES), shape: pick(SHAPES) }));
const mutate = (state, next) => {
  const op = pick(['insert', 'insert', 'remove', 'move', 'reslot', 'reshape', 'reverse', 'lead', 'tail', 'held', 'inner', 'inner', 'innermove', 'fire']);
  if (op === 'fire') {
    /** A NEW fz-fire (a new key), so its render is a first render; the commit lands during it. */
    state.fire = { gen: `g${next()}`, pre: rowsOf(next, 'p'), final: rowsOf(next, 'f') };
    fireFinal = state.fire.final;
    return op;
  }
  if (op === 'held') { state.held = pick([null, 'x', 'y']); return op; }
  if (op === 'inner') { if (random() < 0.6 || !state.inner.length) state.inner.splice(Math.floor(random() * (state.inner.length + 1)), 0, { id: `n${next()}`, slot: pick(NAMES), slot2: pick(NAMES), shape: pick(SHAPES) }); else state.inner.splice(Math.floor(random() * state.inner.length), 1); return op; }
  if (op === 'innermove') { if (state.inner.length) { const [r] = state.inner.splice(Math.floor(random() * state.inner.length), 1); state.inner.splice(Math.floor(random() * (state.inner.length + 1)), 0, r); } return op; }
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
  /** CONTROL: first renders whose own commit REPLACED pre rows with final ones — or the new op measured nothing. */
  let fired = 0;
  for (const s of SEEDS) {
    seed = s;
    let counter = 0;
    const next = () => counter++;
    const page = doc.createElement('div');
    doc.body.append(page);
    const state = { lead: null, tail: null, held: null, rows: [], inner: [], fire: null };
    const script = [];
    for (let step = 0; step < 80; step++) {
      script.push(mutate(state, next));
      /** Rows as they are now, copied — the template reads them during the render. */
      renderInto(draw({ ...state, rows: state.rows.map((row) => ({ ...row })), inner: state.inner.map((row) => ({ ...row })) }), page);
      steps++;
      if (state.fire !== null) {
        const fireHost = page.querySelector('fz-fire');
        const nodes = state.fire.final.flatMap(rowNodes);
        let diverged = false;
        for (const name of ['a', '', 'b']) {
          const want = nodes.filter(([slot]) => slot === name).map(([, text]) => text);
          const got = slotted(fireHost, name).map(shown);
          const section = shown([...fireHost.children].find((c) => c.localName === { a: 'header', '': 'main', b: 'footer' }[name]));
          const screen = want.length > 0 ? want.join('') : { a: 'FA', '': 'FD', b: 'FB' }[name];
          if (JSON.stringify(got) !== JSON.stringify(want) || section !== screen) {
            divergences.push({ seed: s, step, fire: true, name, want, got, screen: section, pre: state.fire.pre, final: state.fire.final, script: script.slice(-6).join(',') });
            diverged = true;
            break;
          }
        }
        if (diverged) break;
        if (script[script.length - 1] === 'fire' && state.fire.final.length > 0 && state.fire.pre.length > 0) fired++;
      }
      const host = page.querySelector('fz-host');
      const innerHost = page.querySelector('fz-host.inner');
      const iw = innerExpected(state);
      for (const name of ['a', '', 'b']) { const ig = slotted(innerHost, name).map(shown); if (JSON.stringify(ig) !== JSON.stringify(iw[name])) { divergences.push({ seed: s, step, inner: true, name, want: iw[name], got: ig, script: script.slice(-6).join(',') }); break; } }
      if (divergences.length && divergences[divergences.length - 1].step === step && divergences[divergences.length - 1].seed === s) break;
      const want = expected(state);
      const got = {
        a: slotted(host, 'a').map(shown),
        '': slotted(host, '').map(shown),
        b: slotted(host, 'b').map(shown),
      };
      /** And what is ON SCREEN: each section shows its slot's content, or the fallback when it has none. */
      const screen = {
        a: shown([...host.children].find((c) => c.localName === 'header')),
        '': shown([...host.children].find((c) => c.localName === 'main')),
        b: shown([...host.children].find((c) => c.localName === 'footer')),
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
  console.log(`replay storm: ${SEEDS.length} seeds, ${steps} renders, ${filled} with both named slots filled, ${fired} mid-first-render commits`);
  for (const d of divergences) console.log('DIVERGE', JSON.stringify(d));
  assert.ok(filled > steps / 4, `CONTROL: only ${filled} of ${steps} renders filled both named slots — the run compared fallbacks`);
  assert.ok(fired >= SEEDS.length, `CONTROL: only ${fired} mid-first-render commits replaced content — the fire op measured nothing`);
  assert.deepEqual(divergences, [], `${divergences.length} seed(s) diverged from the data`);
});
