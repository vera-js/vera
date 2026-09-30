/**
 * **Every instance is built in its container's document, and a ref is handed its element once the pass's DOM
 * exists.**
 *
 * A plain template is cloned from the inert template document and committed before it is inserted, and a nested
 * part used to read its document back off its own markers — which, inside a fresh clone, still belong to that
 * inert document. So a nested template holding a custom element was imported into a document with no window: no
 * clone-time upgrade, and `adoptProperty` read the missing window as "already upgraded", so a lazily defined
 * element kept a stale value. Every ref saw a windowless element too.
 *
 * Now the document is the pass's own — read once off the container — and a ref (a function, or `{ value }`) runs
 * after the pass: inserted, upgraded, in its own document. A value with `_$apply$` still applies mid-commit
 * (spread delivers properties through it, and they must arrive before insertion).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'customElements', 'DocumentFragment'])
  globalThis[key] = dom.window[key];
const { renderInto, hold, renderer } = await load('renderer');
const html = (strings, ...values) => ({ _$litType$: 1, strings, values });

test("a nested template's ref sees its element in the page document, with a window", () => {
  const host = document.body.appendChild(document.createElement('div'));
  let seen = null;
  renderInto(html`<section><div>${html`<x-nested ${(el) => (seen ??= el)}></x-nested>`}</div></section>`, host);
  assert.ok(seen, 'the ref ran');
  assert.equal(seen.ownerDocument, document);
  assert.ok(seen.ownerDocument.defaultView, 'its document has a window');
  assert.ok(seen.isConnected, 'and it is inserted by the time the ref runs');
});

test('a lazily defined element nested in a plain template keeps the LATEST value until it upgrades', () => {
  const host = document.body.appendChild(document.createElement('div'));
  const draw = (v) => renderInto(html`<section>${html`<x-late .data=${v}></x-late>`}</section>`, host);
  draw(1);
  draw(2);
  const el = host.querySelector('x-late');
  assert.equal(el._$props$?.data, 2, 'the record a draining init() restores holds 2, not the stale 1');
});

test("a container in another document builds every instance there — nested templates included", () => {
  const other = new JSDOM('<!doctype html><body></body>').window.document;
  const host = other.body.appendChild(other.createElement('div'));
  renderInto(html`<section>${html`<b>plain</b>`}${html`<x-other></x-other>`}</section>`, host);
  for (const el of host.querySelectorAll('section, b, x-other')) assert.equal(el.ownerDocument, other, el.localName);
});

/**
 * Observed at CREATION, because inserting an element adopts it into the right document afterwards and hides where
 * it was built: a defined element built in its own document is upgraded at clone time, so a bound property reaches
 * its setter; built in the inert template document it is not, and the value lands as a plain own property.
 */
test("a list inside a freshly cloned plain template builds its items where they upgrade at clone time", () => {
  const delivered = [];
  customElements.define('x-row-acc', class extends HTMLElement {
    set data(v) { delivered.push(v); }
  });
  const host = document.body.appendChild(document.createElement('div'));
  const row = (n) => html`<x-row-acc .data=${n}></x-row-acc>`;
  renderInto(html`<section>${[1, 2].map(row)}</section>`, host);
  assert.deepEqual(delivered, [1, 2], 'each item\'s setter received its value');
});

/** In ANOTHER document, because in the page's own the module's document would give the same answer by accident. */
test("an applier committing later into a hold-parked subtree still builds in the container's document", () => {
  const other = new JSDOM('<!doctype html><body></body>').window.document;
  const host = other.body.appendChild(other.createElement('div'));
  let later = null;
  const applier = { _$child$: (part) => { later = part; } };
  const shown = () => html`<b>a</b><i>${applier}</i>`;
  const elsewhere = () => html`<p>elsewhere</p>`;
  renderInto(html`<div>${hold(shown())}</div>`, host);
  renderInto(html`<div>${hold(elsewhere())}</div>`, host); // parks the fragment-rooted instance, applier and all
  later._$commit$(html`<x-parked></x-parked>`);
  const built = later._start.parentNode.querySelector?.('x-parked') ?? [...later._start.parentNode.childNodes].find((n) => n.localName === 'x-parked');
  assert.ok(built, 'the applier rendered');
  /** Which window constructed it — a node moved between documents keeps the realm it was created in. */
  assert.ok(built instanceof other.defaultView.HTMLElement, "built by the container's window, not the module's or the inert template's");
});

test('a ref that removes a sibling row during the flush leaves that sibling never handed a stale element', () => {
  const host = document.body.appendChild(document.createElement('div'));
  const b = { value: null };
  let first = true;
  const row = (r) => html`<li ${r}></li>`;
  const draw = (refs) => renderInto(html`<ul>${refs.map(row)}</ul>`, host);
  const a = (el) => {
    if (el && first) {
      first = false;
      draw([a]);
    }
  };
  const cCalls = [];
  const c = (el) => cCalls.push(el);
  draw([a, b, c]);
  assert.equal(host.querySelectorAll('li').length, 1, 'the siblings were removed');
  assert.equal(b.value, null, 'an object ref was never handed the removed element');
  assert.deepEqual(cCalls, [], 'and a function ref was neither handed it nor told it was gone — it never had it');
});

test('a ref replaced within one pass is applied once, with the value it holds when the pass ends', () => {
  const host = document.body.appendChild(document.createElement('div'));
  let calls = 0;
  const A = (el) => el && calls++;
  const B = () => {};
  const tpl = (r) => html`<i ${r}></i>`;
  const applier = { _$child$: (part) => { part._$commit$(tpl(A)); part._$commit$(tpl(B)); part._$commit$(tpl(A)); } };
  renderInto(html`<div>${applier}</div>`, host);
  assert.equal(calls, 1);
});

test("a ref's error is reported against the render it belongs to", () => {
  const host = document.body.appendChild(document.createElement('div'));
  const reported = [];
  renderer.connect({ get: (name) => (name === 'error' ? [(error, element) => reported.push([error.message, element])] : undefined) });
  try {
    renderInto(html`<b ${() => { throw new Error('boom'); }}></b>`, host);
  } finally {
    renderer.connect({ get: () => undefined });
  }
  assert.deepEqual(reported, [['boom', host]]);
});

test('a ref on a <select> sees the value its pass set, once the options exist', () => {
  const host = document.body.appendChild(document.createElement('div'));
  let seen = null;
  const option = (o) => html`<option value=${o}>${o}</option>`;
  renderInto(html`<select ${(el) => (seen = el?.value)} .value=${'b'}>${['a', 'b'].map(option)}</select>`, host);
  assert.equal(seen, 'b');
});
