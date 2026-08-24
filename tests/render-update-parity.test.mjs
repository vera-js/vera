/**
 * An updated render must equal a fresh one.
 *
 * `render-parity.test.mjs` compares the server and the client, but only ever on a **first** render.
 * Everything a renderer is actually for happens on the second one: finding the part that changed,
 * leaving the rest alone, and reconciling a list against the nodes already standing. A stale part,
 * a node left behind, a keyed row moved to the wrong place — none of it is visible in a first pass,
 * and all of it is visible here, because a first render is the definition of correct.
 *
 * Two matrices. The first crosses every binding **position** with every ordered pair of **values**,
 * which is where transitions live: value → null (does the attribute come off?), template → text
 * (is the old subtree torn down?), array → shorter array (are the extra nodes removed?). The second
 * crosses list shapes with each other, keyed and unkeyed, which is the reconciliation question.
 *
 * Tests BUILT artifacts, development AND production (see ./dist.mjs).
 */
import { load } from './dist.mjs';
import { canonical } from './canonical.mjs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>');
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;

const { render, keyed, hold } = await load('renderer');
const { spread } = await load('renderer/spread');
const html = (strings, ...values) => ({ _$litType$: 1, strings, values });

/* ── values ──────────────────────────────────────────────────────────────────────────────────── */
/** Thunks, because a template is an object and each render must get its own. */
const VALUES = {
  'a string': () => 'v',
  'another string': () => 'w',
  'an empty string': () => '',
  'zero': () => 0,
  'a number': () => 3,
  'true': () => true,
  'false': () => false,
  'null': () => null,
  'undefined': () => undefined,
  'an array': () => ['a', 'b'],
  'a shorter array': () => ['a'],
  'an empty array': () => [],
  'a template': () => html`<i>t</i>`,
  'a different template': () => html`<u>t</u>`,
  'a list of templates': () => [html`<b>1</b>`, html`<b>2</b>`],
};

/* ── positions ───────────────────────────────────────────────────────────────────────────────── */
const POSITIONS = {
  'a text child': (v) => html`<b>${v}</b>`,
  'a text child between statics': (v) => html`<b>before${v}after</b>`,
  'a text child beside an element': (v) => html`<b><i>a</i>${v}<u>b</u></b>`,
  'two children of one parent': (v) => html`<b>${v}${v}</b>`,
  'two children in separate parents': (v) => html`<b>${v}</b><i>${v}</i>`,
  'a child of a nested element': (v) => html`<div><section><b>${v}</b></section></div>`,
  'an attribute': (v) => html`<b title=${v}>x</b>`,
  'an attribute between statics': (v) => html`<b id="i" title=${v} lang="en">x</b>`,
  'a multipart attribute': (v) => html`<b title="x${v}y">z</b>`,
  'two attributes on one element': (v) => html`<b title=${v} lang=${v}>x</b>`,
  'a boolean': (v) => html`<b ?hidden=${v}>x</b>`,
  'a value property': (v) => html`<input .value=${v} />`,
  'a checked property': (v) => html`<input type="checkbox" .checked=${v} />`,
  'a live checked property': (v) => html`<input type="checkbox" !checked=${v} />`,
  'a live value property': (v) => html`<input !value=${v} />`,
  'a spread attribute': (v) => html`<b ${spread({ title: v })}>x</b>`,
  'a spread boolean': (v) => html`<b ${spread({ '?hidden': v })}>x</b>`,
  'an attribute and a child': (v) => html`<b title=${v}>${v}</b>`,
  'a child inside a list': (v) => html`<ul>${[html`<li>${v}</li>`]}</ul>`,
  'held content': (v) => html`<div>${hold(v)}</div>`,
};

/* ── list shapes ─────────────────────────────────────────────────────────────────────────────── */
const LISTS = {
  'empty': [],
  'one': [1],
  'three': [1, 2, 3],
  'three reversed': [3, 2, 1],
  'three rotated': [2, 3, 1],
  'four': [1, 2, 3, 4],
  'the middle removed': [1, 3],
  'the ends removed': [2],
  'prepended': [0, 1, 2, 3],
  'appended': [1, 2, 3, 4, 5],
  'replaced wholesale': [7, 8, 9],
  'a repeated value': [1, 1, 2],
};

const LIST_POSITIONS = {
  'unkeyed': (rows) => html`<ul>${rows.map((n) => html`<li>${n}</li>`)}</ul>`,
  'keyed': (rows) => html`<ul>${rows.map((n, i) => keyed(`${n}-${i}`, html`<li>${n}</li>`))}</ul>`,
  'keyed by value': (rows) => html`<ul>${rows.map((n) => keyed(n, html`<li>${n}</li>`))}</ul>`,
  'unkeyed with an attribute': (rows) => html`<ul>${rows.map((n) => html`<li data-n=${n}>${n}</li>`)}</ul>`,
  'keyed with a sibling': (rows) => html`<ul><li>head</li>${rows.map((n) => keyed(n, html`<li>${n}</li>`))}<li>tail</li></ul>`,
};

/* ── run ─────────────────────────────────────────────────────────────────────────────────────── */
let pass = 0;
const failures = [];

const fresh = () => dom.window.document.createElement('div');

const compare = (label, first, second) => {
  const updated = fresh();
  render(first(), updated);
  render(second(), updated);

  const direct = fresh();
  render(second(), direct);

  const a = canonical(updated);
  const b = canonical(direct);
  if (a === b) pass++;
  else failures.push(`${label}\n      updated: ${a}\n      fresh:   ${b}`);
};

for (const [positionName, position] of Object.entries(POSITIONS))
  for (const [fromName, from] of Object.entries(VALUES))
    for (const [toName, to] of Object.entries(VALUES)) {
      if (fromName === toName) continue;
      compare(`${positionName}: ${fromName} → ${toName}`, () => position(from()), () => position(to()));
    }

for (const [positionName, position] of Object.entries(LIST_POSITIONS))
  for (const [fromName, from] of Object.entries(LISTS))
    for (const [toName, to] of Object.entries(LISTS)) {
      if (fromName === toName) continue;
      compare(`${positionName} list: ${fromName} → ${toName}`, () => position(from), () => position(to));
    }

/* ── a spread whose key set changes ──────────────────────────────────────────────────────────── */
/**
 * A spread is the one binding whose *names* are not known until runtime, so it is the one that has
 * to take an attribute back off when the next render stops mentioning it. Every ordered pair of key
 * sets, including the kinds crossing each other — an attribute becoming a boolean, a property
 * becoming an event — since each is applied and removed by a different mechanism.
 */
const SPREAD_SETS = {
  'two attributes': { title: 't', lang: 'en' },
  'one attribute': { title: 't' },
  'a different key': { alt: 'a' },
  'no keys': {},
  'a boolean, on': { '?hidden': true },
  'a boolean, off': { '?hidden': false },
  'a property': { '.value': 'v' },
  'an event': { '@click': () => {} },
  'an attribute and a boolean': { title: 't', '?hidden': true },
  'an attribute and a property': { title: 't', '.value': 'v' },
  'an attribute given null': { title: null },
};

for (const [fromName, from] of Object.entries(SPREAD_SETS))
  for (const [toName, to] of Object.entries(SPREAD_SETS)) {
    if (fromName === toName) continue;
    compare(
      `a spread: ${fromName} → ${toName}`,
      () => html`<input ${spread(from)} />`,
      () => html`<input ${spread(to)} />`
    );
  }

/* ── and again, three renders deep ───────────────────────────────────────────────────────────── */
/**
 * Two renders can hide a defect that only bites once a part has been through a transition already —
 * a cleared list that kept its old markers, an attribute removed and then set again.
 */
for (const [positionName, position] of Object.entries(POSITIONS))
  for (const [name, value] of Object.entries(VALUES)) {
    const label = `${positionName}: null → ${name} → null → ${name}`;
    const updated = fresh();
    render(position(null), updated);
    render(position(value()), updated);
    render(position(null), updated);
    render(position(value()), updated);

    const direct = fresh();
    render(position(value()), direct);

    const a = canonical(updated);
    const b = canonical(direct);
    if (a === b) pass++;
    else failures.push(`${label}\n      updated: ${a}\n      fresh:   ${b}`);
  }

if (failures.length) {
  console.log(`\n  ${failures.length} update(s) that do not match a fresh render:\n`);
  for (const failure of failures.slice(0, 25)) console.log(`    ${failure}\n`);
  if (failures.length > 25) console.log(`    …and ${failures.length - 25} more\n`);
  process.exit(1);
}
console.log(`update parity: ${pass} transitions render as a fresh render would`);
