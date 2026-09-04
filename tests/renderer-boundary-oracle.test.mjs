/**
 * **The boundary oracle — the semantic contract of child-part positioning, stated without ever
 * mentioning how positions are represented.**
 *
 * Written BEFORE the markerless-boundary rewrite, against the markered renderer, and every
 * assertion here is about what a user can observe: content, order, and node identity. Not one
 * mentions a comment. The rewrite must keep this file green untouched — that is the whole point
 * of writing it first — and any future boundary representation inherits the same obligation.
 *
 * The cases are chosen adversarially against the NEW design, not the old one:
 *
 *   - Adjacent parts that BOTH empty and refill, in every order — the case where "append to the
 *     parent" is wrong for one of them and right for the other, and getting it backwards renders
 *     `${a}${b}` as `ba` with nothing else failing.
 *   - A tail part refilling after user code appended its own nodes to the parent — pinning
 *     today's contract (rendered content lands after foreign tail nodes, matching the current
 *     root-part append semantics).
 *   - Keyed items that empty to null IN PLACE and refill — an item is never provably last, so a
 *     representation that assumes tail-ness for items misorders exactly here.
 *   - A template whose instance has NO nodes at all (`html``` in a branch) — a range with no
 *     content and no way to derive a position from it.
 *   - Content identity across a sibling's churn — the neighbour must never be touched, which is
 *     the property the whole boundary system exists to buy.
 *
 * Comment-count assertions live in `tests/renderer-marker-census.test.mjs` (written with the
 * rewrite), deliberately NOT here: this file must be true under every representation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window','document','HTMLElement','customElements','CSSStyleSheet','Node','Element','DocumentFragment','Text','Comment','requestAnimationFrame','cancelAnimationFrame','Event','CustomEvent','MutationObserver','NodeFilter'])
  globalThis[key] = dom.window[key];

const { html } = await load('core');
const { renderInto, hold } = await load('renderer');
const { keyed } = await load('renderer/keyed');

const D = dom.window.document;
const fresh = () => {
  const container = D.createElement('div');
  D.body.append(container);
  return container;
};
/** What a user sees: elements and text, in order. Never the representation. */
const visible = (node) =>
  [...node.childNodes]
    .map((child) =>
      child.nodeType === 1
        ? `<${child.localName}>${visible(child)}</${child.localName}>`
        : child.nodeType === 3
          ? child.data
          : ''
    )
    .join('');

test('adjacent parts: every empty/refill order keeps a before b', () => {
  const host = fresh();
  const anA = (v) => (v === null ? null : html`<i>${v}</i>`);
  const aB = (v) => (v === null ? null : html`<u>${v}</u>`);
  const draw = (a, b) => html`<div>${anA(a)}${aB(b)}</div>`;
  /**
   * Every path through {full, empty} × {full, empty} and back. The script revisits states so a
   * position derived correctly ONCE but recorded stale is still caught later.
   */
  const script = [
    ['A', 'B'], [null, 'B'], ['A2', 'B'], ['A2', null], ['A2', 'B2'],
    [null, null], ['A3', null], [null, 'B3'], ['A4', 'B4'], [null, null], [null, 'B5'], ['A5', 'B5'],
  ];
  for (const [a, b] of script) {
    renderInto(draw(a, b), host);
    const want = `${a === null ? '' : `<i>${a}</i>`}${b === null ? '' : `<u>${b}</u>`}`;
    assert.equal(visible(host.querySelector('div')), want, `state a=${a} b=${b}`);
  }
});

test('three adjacent parts: the middle one empties and returns to the middle', () => {
  const host = fresh();
  const piece = (tag, v) => (v === null ? null : tag === 'i' ? html`<i>${v}</i>` : tag === 'u' ? html`<u>${v}</u>` : html`<s>${v}</s>`);
  const draw = (a, b, c) => html`<p>${piece('i', a)}${piece('u', b)}${piece('s', c)}</p>`;
  renderInto(draw('a', 'b', 'c'), host);
  renderInto(draw('a', null, 'c'), host);
  assert.equal(visible(host.querySelector('p')), '<i>a</i><s>c</s>');
  renderInto(draw('a', 'B', 'c'), host);
  assert.equal(visible(host.querySelector('p')), '<i>a</i><u>B</u><s>c</s>', 'the middle came back in the middle');
  /** And with its neighbours gone, so no live sibling content can be its reference. */
  renderInto(draw(null, null, null), host);
  renderInto(draw(null, 'B2', null), host);
  assert.equal(visible(host.querySelector('p')), '<u>B2</u>');
  renderInto(draw('A2', 'B2', 'C2'), host);
  assert.equal(visible(host.querySelector('p')), '<i>A2</i><u>B2</u><s>C2</s>');
});

test('a part between static text refills between the same static text', () => {
  const host = fresh();
  const draw = (v) => html`<p>lead ${v === null ? null : html`<b>${v}</b>`} tail</p>`;
  renderInto(draw('x'), host);
  renderInto(draw(null), host);
  assert.equal(visible(host.querySelector('p')), 'lead  tail');
  renderInto(draw('y'), host);
  assert.equal(visible(host.querySelector('p')), 'lead <b>y</b> tail');
});

test('a tail part refills after foreign nodes a user appended to its parent', () => {
  const host = fresh();
  const draw = (v) => html`<div><span>static</span>${v === null ? null : html`<b>${v}</b>`}</div>`;
  renderInto(draw('x'), host);
  renderInto(draw(null), host);
  const parent = host.querySelector('div');
  /**
   * User code appends into the same parent while the part is empty. **Exact-position refill is a
   * CONTRACT here, not an accident of the representation** (decided 2026-09-05): the part's
   * content returns exactly where it was — BEFORE the foreign node — the way lit's markers answer
   * it, and not by appending to the parent the way React's `getHostSibling` does. Any future
   * boundary representation must preserve this, which is exactly the assertion that retired the
   * "elide the end marker for provably-last parts" optimisation: it saved one comment by trading
   * this line away.
   *
   * The ROOT part is the one deliberate exception and is pinned in the pre-existing-content test
   * below: rendering into a container appends, the standard mount contract shared with React and
   * Vue since 0.1.
   */
  const foreign = D.createElement('em');
  foreign.textContent = 'foreign';
  parent.append(foreign);
  renderInto(draw('y'), host);
  assert.ok(parent.contains(foreign), 'the foreign node was not destroyed');
  assert.equal(visible(parent), '<span>static</span><b>y</b><em>foreign</em>',
    'the part refilled at its exact old position, before the foreign node — never appended after it');
});

test('keyed items emptying to a contentless template keep list order', () => {
  const host = fresh();
  /** One call site per shape — two literals are two templates (CLAUDE.md). `keyed` requires a
   *  template, so an item's "hole" state is an EMPTY one: an instance with no nodes at all,
   *  which is the hardest thing for an item to hold a position with. */
  const full = (r) => html`<b data-id=${r.id}>${r.id}</b>`;
  const hole = () => html``;
  const rows = (list) => html`<ul>${list.map((r) => keyed(r.id, r.hole ? hole() : full(r)))}</ul>`;
  const read = () => [...host.querySelectorAll('b')].map((n) => n.dataset.id).join('');
  renderInto(rows([{ id: 'a' }, { id: 'b' }, { id: 'c' }]), host);
  assert.equal(read(), 'abc');
  /** The middle item becomes null — its DOM leaves, its position must not. */
  renderInto(rows([{ id: 'a' }, { id: 'b', hole: true }, { id: 'c' }]), host);
  assert.equal(read(), 'ac');
  renderInto(rows([{ id: 'a' }, { id: 'b' }, { id: 'c' }]), host);
  assert.equal(read(), 'abc', 'the refilled item is back in the MIDDLE, not appended');
  /** The LAST item empties, a new item is added after it, then it refills — never provably last. */
  renderInto(rows([{ id: 'a' }, { id: 'b' }, { id: 'c', hole: true }]), host);
  renderInto(rows([{ id: 'a' }, { id: 'b' }, { id: 'c', hole: true }, { id: 'd' }]), host);
  assert.equal(read(), 'abd');
  renderInto(rows([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]), host);
  assert.equal(read(), 'abcd', 'an item that was once last refilled before the row added after it');
});

test('a template instance with no nodes at all still holds its position', () => {
  const host = fresh();
  const nothing = () => html``;
  const something = (v) => html`<b>${v}</b>`;
  const draw = (mode, v) => html`<p>${mode === 'gone' ? nothing() : something(v)}${html`<u>anchor</u>`}</p>`;
  renderInto(draw('there', 'x'), host);
  renderInto(draw('gone', ''), host);
  assert.equal(visible(host.querySelector('p')), '<u>anchor</u>');
  renderInto(draw('there', 'y'), host);
  assert.equal(visible(host.querySelector('p')), '<b>y</b><u>anchor</u>', 'content returned BEFORE the sibling');
});

test('a neighbour is never touched by a sibling churning through every mode', () => {
  const host = fresh();
  const stable = () => html`<u>KEEP</u>`;
  const churnT = (v) => html`<i>${v}</i>`;
  const draw = (v) => html`<div>${v}${stable()}</div>`;
  renderInto(draw('text'), host);
  const keep = host.querySelector('u');
  const states = [churnT('t'), null, 'plain', [html`<s>1</s>`, html`<s>2</s>`], null, D.createElement('hr'), 'end'];
  for (const state of states) {
    renderInto(draw(state), host);
    assert.equal(host.querySelector('u'), keep, 'same node object through the sibling churn');
  }
  assert.equal(visible(host.querySelector('div')), 'end<u>KEEP</u>');
});

test('hold() parks and restores through an empty interlude, and text identity survives updates', () => {
  const host = fresh();
  const editor = (v) => html`<input value=${v} />`;
  const viewer = () => html`<p>view</p>`;
  const draw = (which) => html`<div>${which === null ? null : hold(which === 'edit' ? editor('seed') : viewer())}</div>`;
  renderInto(draw('edit'), host);
  const input = host.querySelector('input');
  input.value = 'USER TYPED';
  renderInto(draw('view'), host);
  renderInto(draw(null), host);
  assert.equal(visible(host.querySelector('div')), '');
  renderInto(draw('edit'), host);
  assert.equal(host.querySelector('input'), input, 'the held instance came back as the same node');
  assert.equal(host.querySelector('input').value, 'USER TYPED', 'with its live state intact');
});

test('pre-existing container content survives, before the rendered range', () => {
  const host = fresh();
  host.innerHTML = '<article id="pre">was here first</article>';
  const draw = (v) => html`<section>${v}</section>`;
  renderInto(draw('one'), host);
  renderInto(draw(null), host);
  renderInto(draw('two'), host);
  assert.ok(host.querySelector('#pre'), 'pre-existing content survived the round trip');
  assert.equal(visible(host), '<article>was here first</article><section>two</section>');
});
