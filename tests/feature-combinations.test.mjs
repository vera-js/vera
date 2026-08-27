/**
 * Documented features in **combination** — which is where an app lives and where per-feature suites
 * do not look.
 *
 * Pass 95's lens was mechanical, in the shape pass 94 used for bundles: build the matrix of feature
 * pairs and find the cells no test file covers. Fifteen pairs had never appeared together. Most are
 * uninteresting; these are the ones where the two features make claims about the *same* node, and
 * where one getting it wrong is invisible in either feature's own tests.
 *
 * The `spread + hydrate` case is here because pass 94 verified it with a throwaway probe and said in
 * its commit message that it was "now asserted rather than assumed" — which it was not, because the
 * probe was deleted. The matrix caught that on the next pass, which is the argument for the matrix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'DocumentFragment',
                   'Text', 'Comment', 'Event', 'CSSStyleSheet'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderInto, hold } = await load('renderer');
const { renderInto: hydrateInto } = await load('renderer/hydrate');
const { keyed } = await load('renderer/keyed');
const { spread } = await load('renderer/spread');
const { html } = core;
const div = () => dom.window.document.createElement('div');

test('spread + hydrate: bindings apply to the adopted node, and updates keep it', () => {
  const host = div();
  host.innerHTML = '<b title="keep" id="a1" data-k="v1">x</b>';
  const server = host.querySelector('b');
  server.dataset.probe = 'survived';

  const draw = (n) => html`<b title="keep" ${spread({ id: `a${n}`, 'data-k': `v${n}`, '.lang': `l${n}` })}>x</b>`;
  hydrateInto(draw(1), host);
  const adopted = host.querySelector('b');
  assert.equal(adopted, server, 'adoption did not keep the server node');
  assert.equal(adopted.dataset.probe, 'survived', 'out-of-band state on the adopted node was lost');
  assert.equal(adopted.getAttribute('title'), 'keep', 'the static beside the spread was dropped');
  assert.equal(adopted.lang, 'l1', 'a spread property binding did not apply');

  hydrateInto(draw(2), host);
  assert.equal(host.querySelector('b'), server, 'the update replaced the node instead of mutating it');
  assert.equal(adopted.getAttribute('data-k'), 'v2');
  assert.equal(adopted.lang, 'l2');
});

test('ref + hydrate: the ref receives the server node, not a fresh one', () => {
  const host = div();
  host.innerHTML = '<input value="server">';
  const server = host.querySelector('input');
  const reference = core.ref(null);
  hydrateInto(html`<input value="server" ${reference} />`, host);
  assert.equal(reference.value, server, 'the ref got a node the page is not showing');
});

/**
 * The documented reason adoption *records* a form value rather than writing it: the page is usable
 * before the bundle lands, and the window between the two is where someone types. Writing the
 * binding then would throw that away silently on every hydrating page.
 */
test('!live + hydrate: what a person typed survives adoption, and a real change still lands', () => {
  const host = div();
  host.innerHTML = '<input value="from-server">';
  host.querySelector('input').value = 'typed by a person';

  const draw = (value) => html`<input !value=${value} />`;
  hydrateInto(draw('from-server'), host);
  assert.equal(host.querySelector('input').value, 'typed by a person',
    'adoption overwrote what the user had already typed');

  hydrateInto(draw('from-state'), host);
  assert.equal(host.querySelector('input').value, 'from-state',
    'the binding stayed inert after adoption instead of staying live');
});

test('hold + hydrate: a held subtree survives a toggle away and back', () => {
  const host = div();
  host.innerHTML = '<div><p>a</p></div>';
  const draw = (on) => html`<div>${hold(on ? html`<p>${'a'}</p>` : html`<b>${'b'}</b>`)}</div>`;
  hydrateInto(draw(true), host);
  const first = host.querySelector('p');
  hydrateInto(draw(false), host);
  hydrateInto(draw(true), host);
  assert.equal(host.querySelector('p'), first, 'hold rebuilt the subtree it exists to preserve');
});

/**
 * A keyed **move** must not look like a teardown. Refs are released on teardown — that is what stops
 * a detached node being handed back — so a reorder that released them would break every ref in a
 * sortable list, and a removal that failed to release one would keep a detached node alive.
 */
test('keyed + ref: a reorder keeps every ref, a removal releases exactly one', () => {
  const refs = { a: core.ref(null), b: core.ref(null), c: core.ref(null) };
  const host = div();
  const draw = (order) =>
    renderInto(html`<ul>${order.map((id) => keyed(id, html`<li data-id=${id} ${refs[id]}>${id}</li>`))}</ul>`, host);

  draw(['a', 'b', 'c']);
  const nodes = Object.fromEntries(['a', 'b', 'c'].map((id) => [id, host.querySelector(`li[data-id="${id}"]`)]));
  for (const id of ['a', 'b', 'c']) assert.equal(refs[id].value, nodes[id], `${id} did not get its node`);

  draw(['c', 'b', 'a']);
  for (const id of ['a', 'b', 'c']) {
    assert.equal(host.querySelector(`li[data-id="${id}"]`), nodes[id], `${id} was rebuilt by a reorder`);
    assert.equal(refs[id].value, nodes[id], `${id}'s ref was released by a reorder`);
  }

  draw(['c', 'a']);
  assert.equal(refs.b.value, null, "the removed row's ref was not released — it holds a detached node");
  assert.equal(refs.a.value, nodes.a, 'a surviving ref was released by an unrelated removal');
  assert.equal(refs.c.value, nodes.c);

  draw([]);
  assert.equal(refs.a.value, null);
  assert.equal(refs.c.value, null);
});
