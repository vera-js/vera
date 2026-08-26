/**
 * A subtree on its way out tells what asked to be told.
 *
 * Two clients, one walk: an element ref is released, and a child directive that declared
 * `_$detach$` is notified. Both are gated on a **process-wide** flag — nothing has asked, nothing
 * walks — because a directive arrives as a *value* and no template shape predicts it, so the finer
 * per-template gate a ref could use cannot serve both. Measured: with one unrelated ref on the page,
 * a 1 000-row clear walks 1 000 instances and takes 3.98 ms against 4.03 ms with no ref at all. The
 * DOM removal dominates; the walk does not show up.
 *
 * The reason this file exists rather than a note in the README: **every removal path has to call
 * it.** A keyed row is dropped by moving its nodes to a scratch fragment and an index-mode list
 * shrinks by removing them directly — neither goes through `_clear`. A version that hooked only
 * `_clear` told a directive when its *container* was replaced and stayed silent when its own *row*
 * was deleted: told sometimes, which is a worse contract than never.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment'])
  globalThis[key] = dom.window[key];

const { html } = await load('core');
const { render } = await load('renderer');
const { keyed } = await load('renderer/keyed');

const host = () => {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
};

const torn = [];
/** Hoisted, as the protocol requires — a fresh applier per render never earns continuity. */
function applyThing(part) {
  part._$commit$(this.label);
  return { label: this.label };
}
applyThing._$detach$ = (previous) => torn.push(previous?.label);
const thing = (label) => ({ _$child$: applyThing, label });

const swap = (a, b) => {
  const element = host();
  torn.length = 0;
  render(a(), element);
  render(b(), element);
  return element;
};

test('a directive is told when the part holding it is replaced', () => {
  swap(() => html`<p>${thing('a')}</p>`, () => html`<span>gone</span>`);
  assert.deepEqual(torn, ['a']);
});

test('and when it is nested inside the subtree being replaced', () => {
  swap(() => html`<div>${html`<b>${thing('n')}</b>`}</div>`, () => html`<span>gone</span>`);
  assert.deepEqual(torn, ['n'], 'one level down');

  swap(() => html`<div>${html`<b>${html`<i>${thing('deep')}</i>`}</b>`}</div>`, () => html`<span>gone</span>`);
  assert.deepEqual(torn, ['deep'], 'three levels down');
});

/** The path that does not go through `_clear` at all. */
test('and when its keyed row is dropped', () => {
  const draw = (ids) => html`<ul>${ids.map((id) => keyed(id, html`<li>${thing('r' + id)}</li>`))}</ul>`;
  swap(() => draw([1, 2, 3]), () => draw([1]));
  assert.deepEqual(torn.sort(), ['r2', 'r3']);
});

/** Nor does this one — an index-mode list shrinks by removing nodes directly. */
test('and when an unkeyed list shrinks', () => {
  const draw = (n) => html`<ul>${[...Array(n)].map((_, i) => html`<li>${thing('i' + i)}</li>`)}</ul>`;
  swap(() => draw(3), () => draw(1));
  assert.deepEqual(torn.sort(), ['i1', 'i2']);
});

test('and when the whole list is emptied', () => {
  const draw = (n) => html`<ul>${[...Array(n)].map((_, i) => html`<li>${thing('c' + i)}</li>`)}</ul>`;
  swap(() => draw(2), () => draw(0));
  assert.deepEqual(torn.sort(), ['c0', 'c1']);
});

/** The one that matters most: a directive that survives must not be told it died. */
test('a surviving directive is not told anything', () => {
  const element = host();
  torn.length = 0;
  const draw = (n) => html`<p>${thing('keep')}${n}</p>`;
  render(draw(1), element);
  render(draw(2), element);
  render(draw(3), element);
  assert.deepEqual(torn, []);
});

/** A directive with no teardown must not arm anything or break anything. */
test('a directive without _$detach$ is unaffected', () => {
  function plain(part) {
    part._$commit$('x');
  }
  const element = swap(() => html`<p>${{ _$child$: plain }}</p>`, () => html`<span>gone</span>`);
  assert.equal(element.textContent, 'gone');
  assert.deepEqual(torn, []);
});

/** Refs and directives share the walk, so they have to be checked together, not only apart. */
test('a ref and a directive in one subtree are both handled', () => {
  const element = host();
  torn.length = 0;
  const seen = [];
  const draw = (show) =>
    show
      ? html`<p &=${(node) => seen.push(node === null ? null : node.tagName)}>${thing('withref')}</p>`
      : html`<span>gone</span>`;
  render(draw(true), element);
  render(draw(false), element);
  assert.deepEqual(seen, ['P', null], 'the ref was attached and released');
  assert.deepEqual(torn, ['withref'], 'and the directive was told');
});
