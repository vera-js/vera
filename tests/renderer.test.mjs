/**
 * Correctness suite for @verajs/renderer.
 *
 * Tests the BUILT artifacts — development AND production (see `./dist.mjs`) — so a build defect
 * fails here too. Run with `npm test` (node --test + jsdom).
 */
import { load } from './dist.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;

const { render, hold } = await load('renderer');
const { keyed } = await load('renderer/keyed');

/** The shape core's built-in `html` tag produces. */
const html = (strings, ...values) => ({ _$litType$: 1, strings, values });
const svg = (strings, ...values) => ({ _$litType$: 2, strings, values });

let el;
beforeEach(() => {
  el = document.createElement('div');
  document.body.appendChild(el);
});

/** innerHTML with marker comments stripped, for readable assertions. */
const read = (n = el) => n.innerHTML.replace(/<!--[^>]*-->/g, '');

// ── text ────────────────────────────────────────────────────────────────────

test('renders and updates text', () => {
  render(html`<p>${'a'}</p>`, el);
  assert.equal(read(), '<p>a</p>');
  render(html`<p>${'b'}</p>`, el);
  assert.equal(read(), '<p>b</p>');
});

test('numbers and zero render as text', () => {
  render(html`<p>${0}</p>`, el);
  assert.equal(read(), '<p>0</p>');
  render(html`<p>${42}</p>`, el);
  assert.equal(read(), '<p>42</p>');
});

test('null and undefined clear a child', () => {
  render(html`<p>${'x'}</p>`, el);
  render(html`<p>${null}</p>`, el);
  assert.equal(read(), '<p></p>');
  render(html`<p>${'y'}</p>`, el);
  assert.equal(read(), '<p>y</p>');
  render(html`<p>${undefined}</p>`, el);
  assert.equal(read(), '<p></p>');
});

test('unchanged text does not touch the node', () => {
  /** One template FUNCTION: identity is per call site, so re-render must reuse the instance. */
  const t = (v) => html`<p>${v}</p>`;
  render(t('same'), el);
  const node = el.querySelector('p').firstChild.nextSibling; // after the marker comment
  render(t('same'), el);
  assert.ok(el.querySelector('p').firstChild.nextSibling === node);
});

test('multiple text parts in one element', () => {
  render(html`<p>${'a'}-${'b'}</p>`, el);
  assert.equal(read(), '<p>a-b</p>');
  render(html`<p>${'c'}-${'d'}</p>`, el);
  assert.equal(read(), '<p>c-d</p>');
});

// ── attributes ──────────────────────────────────────────────────────────────

test('full-value attribute; null removes it', () => {
  render(html`<p class="${'x'}"></p>`, el);
  assert.equal(el.querySelector('p').getAttribute('class'), 'x');
  render(html`<p class="${null}"></p>`, el);
  assert.equal(el.querySelector('p').hasAttribute('class'), false);
  render(html`<p class="${'y'}"></p>`, el);
  assert.equal(el.querySelector('p').getAttribute('class'), 'y');
});

test('attribute with statics around one expression', () => {
  render(html`<p class="a ${'m'} z"></p>`, el);
  assert.equal(el.querySelector('p').getAttribute('class'), 'a m z');
});

test('attribute with multiple expressions', () => {
  render(html`<p class="a ${1} b ${2} c"></p>`, el);
  assert.equal(el.querySelector('p').getAttribute('class'), 'a 1 b 2 c');
  render(html`<p class="a ${3} b ${4} c"></p>`, el);
  assert.equal(el.querySelector('p').getAttribute('class'), 'a 3 b 4 c');
});

test('unquoted attribute binding', () => {
  render(html`<p title=${'t'}></p>`, el);
  assert.equal(el.querySelector('p').getAttribute('title'), 't');
});

test('entities in attribute statics are decoded', () => {
  render(html`<p title="a&amp;b ${'c'}"></p>`, el);
  assert.equal(el.querySelector('p').getAttribute('title'), 'a&b c');
});

test('quoted static attributes with > inside do not break parsing', () => {
  render(html`<p title="a>b">${'x'}</p>`, el);
  assert.equal(el.querySelector('p').getAttribute('title'), 'a>b');
  assert.equal(el.querySelector('p').textContent, 'x'); // the > did not truncate the tag
});

test('property binding sets and preserves case', () => {
  const t = (v) => html`<p .somePropName=${v}></p>`;
  render(t('v'), el);
  assert.equal(el.querySelector('p').somePropName, 'v');
  render(t(42), el);
  assert.equal(el.querySelector('p').somePropName, 42);
});

test('boolean attribute toggles', () => {
  render(html`<input ?disabled=${true} />`, el);
  assert.equal(el.querySelector('input').hasAttribute('disabled'), true);
  render(html`<input ?disabled=${false} />`, el);
  assert.equal(el.querySelector('input').hasAttribute('disabled'), false);
});

test('event binding fires, swaps, and removes', () => {
  const t = (fn) => html`<button @click=${fn}></button>`;
  let a = 0;
  let b = 0;
  render(t(() => a++), el);
  const btn = el.querySelector('button');
  btn.dispatchEvent(new dom.window.Event('click'));
  assert.equal(a, 1);
  render(t(() => b++), el);
  assert.ok(el.querySelector('button') === btn); // same element, handler swapped in place
  btn.dispatchEvent(new dom.window.Event('click'));
  assert.equal(a, 1);
  assert.equal(b, 1);
  render(t(null), el);
  btn.dispatchEvent(new dom.window.Event('click'));
  assert.equal(a, 1);
  assert.equal(b, 1);
});

// ── structure ───────────────────────────────────────────────────────────────

test('nested templates and branch switching', () => {
  const t = (on) => html`<div>${on ? html`<b>${'yes'}</b>` : html`<i>${'no'}</i>`}</div>`;
  render(t(true), el);
  assert.equal(read(), '<div><b>yes</b></div>');
  render(t(false), el);
  assert.equal(read(), '<div><i>no</i></div>');
  render(t(true), el);
  assert.equal(read(), '<div><b>yes</b></div>');
});

test('root template switch', () => {
  render(html`<p>${'a'}</p>`, el);
  render(html`<section>${'b'}</section>`, el);
  assert.equal(read(), '<section>b</section>');
});

test('table rows parse correctly', () => {
  render(html`<table><tbody>${html`<tr><td>${'c'}</td></tr>`}</tbody></table>`, el);
  assert.equal(read(), '<table><tbody><tr><td>c</td></tr></tbody></table>');
});

test('textarea (raw text) binding', () => {
  render(html`<textarea>${'a'}</textarea>`, el);
  assert.equal(el.querySelector('textarea').textContent, 'a');
  render(html`<textarea>${'b'}</textarea>`, el);
  assert.equal(el.querySelector('textarea').textContent, 'b');
});

test('svg renders in the SVG namespace', () => {
  render(svg`<circle r=${5}></circle>`, el);
  const c = el.querySelector('circle');
  assert.equal(c.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(c.getAttribute('r'), '5');
});

test('binding inside a comment is ignored but keeps later values aligned', () => {
  render(html`<!--${'gone'}--><p>${'kept'}</p>`, el);
  assert.equal(el.querySelector('p').textContent, 'kept');
});

test('element-position: refs fire, junk is ignored, alignment holds', () => {
  let seen = null;
  const box = { value: null };
  render(html`<div ${(n) => (seen = n)} class="${'c'}"><input ${box} />${'t'}</div>`, el);
  const d = el.querySelector('div');
  assert.ok(seen === d); // callback ref got the element
  assert.ok(box.value === el.querySelector('input')); // object ref got .value assigned
  assert.equal(d.getAttribute('class'), 'c'); // later bindings still aligned
  assert.equal(d.textContent, 't');
  render(html`<div ${'junk'} class="${'c2'}">${'t2'}</div>`, el); // non-ref value: ignored, no throw
  assert.equal(el.querySelector('div').getAttribute('class'), 'c2');
});

test('a ref runs once per distinct value, not once per render', () => {
  let calls = 0;
  const r = (n) => n && calls++;
  const t = (v) => html`<p ${r}>${v}</p>`;
  render(t('a'), el);
  render(t('b'), el);
  assert.equal(calls, 1);
});

test('two containers are independent', () => {
  const el2 = document.createElement('div');
  document.body.appendChild(el2);
  render(html`<p>${'one'}</p>`, el);
  render(html`<p>${'two'}</p>`, el2);
  assert.equal(read(), '<p>one</p>');
  assert.equal(read(el2), '<p>two</p>');
});

// ── lists ───────────────────────────────────────────────────────────────────

const row = (r) => keyed(r.id, html`<li>${r.id}:${r.label}</li>`);
const data = (...ids) => ids.map((id) => ({ id, label: 'L' + id }));
/** One call site for the list wrapper too — identity is per call site. */
const ul = (rows) => html`<ul>${rows}</ul>`;
const items = () => [...el.querySelectorAll('li')];
const texts = () => items().map((n) => n.textContent);
const sameNodes = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(actual[i] === expected[i], `node ${i} identity`);
};

test('unkeyed list grows and shrinks', () => {
  const li = (n) => html`<li>${n}</li>`;
  render(ul([1, 2].map(li)), el);
  assert.deepEqual(texts(), ['1', '2']);
  render(ul([1, 2, 3, 4].map(li)), el);
  assert.deepEqual(texts(), ['1', '2', '3', '4']);
  render(ul([9].map(li)), el);
  assert.deepEqual(texts(), ['9']);
});

test('keyed swap moves nodes instead of rewriting them', () => {
  render(ul(data(1, 2, 3, 4).map(row)), el);
  const [a, b, c, d] = items();
  render(ul(data(1, 3, 2, 4).map(row)), el);
  assert.deepEqual(texts(), ['1:L1', '3:L3', '2:L2', '4:L4']);
  sameNodes(items(), [a, c, b, d]); // the SAME nodes, reordered
});

test('keyed reverse preserves node identity', () => {
  render(ul(data(1, 2, 3, 4, 5).map(row)), el);
  const before = items();
  render(ul(data(5, 4, 3, 2, 1).map(row)), el);
  sameNodes(items(), before.slice().reverse());
});

test('keyed remove from the middle', () => {
  render(ul(data(1, 2, 3, 4, 5).map(row)), el);
  render(ul(data(1, 2, 4, 5).map(row)), el);
  assert.deepEqual(texts(), ['1:L1', '2:L2', '4:L4', '5:L5']);
});

test('keyed insert into the middle', () => {
  render(ul(data(1, 2, 4, 5).map(row)), el);
  const before = items();
  render(ul(data(1, 2, 3, 4, 5).map(row)), el);
  assert.deepEqual(texts(), ['1:L1', '2:L2', '3:L3', '4:L4', '5:L5']);
  assert.ok(items()[0] === before[0]);
  assert.ok(items()[4] === before[3]);
});

test('keyed update in place', () => {
  render(ul(data(1, 2, 3).map(row)), el);
  const before = items();
  render(ul([{ id: 1, label: 'L1' }, { id: 2, label: 'CHANGED' }, { id: 3, label: 'L3' }].map(row)), el);
  assert.deepEqual(texts(), ['1:L1', '2:CHANGED', '3:L3']);
  sameNodes(items(), before);
});

test('keyed clear and refill', () => {
  render(ul(data(1, 2, 3).map(row)), el);
  render(ul([]), el);
  assert.deepEqual(texts(), []);
  render(ul(data(7, 8).map(row)), el);
  assert.deepEqual(texts(), ['7:L7', '8:L8']);
});

test('keyed arbitrary shuffle', () => {
  render(ul(data(1, 2, 3, 4, 5, 6).map(row)), el);
  const before = items();
  render(ul(data(4, 6, 1, 5, 3).map(row)), el);
  assert.deepEqual(texts(), ['4:L4', '6:L6', '1:L1', '5:L5', '3:L3']);
  sameNodes(items(), [before[3], before[5], before[0], before[4], before[2]]);
  render(ul(data(3, 1, 2).map(row)), el);
  assert.deepEqual(texts(), ['3:L3', '1:L1', '2:L2']);
});

test('list of primitives', () => {
  const t = (v) => html`<p>${v}</p>`;
  render(t(['a', 'b', 'c']), el);
  assert.equal(el.querySelector('p').textContent, 'abc');
  render(t(['x', 'y']), el);
  assert.equal(el.querySelector('p').textContent, 'xy');
});

test('list next to static siblings stays inside its range', () => {
  const t = (rows) => html`<ul><li>first</li>${rows}<li>last</li></ul>`;
  render(t(data(1, 2).map(row)), el);
  assert.deepEqual(texts(), ['first', '1:L1', '2:L2', 'last']);
  render(t([]), el);
  assert.deepEqual(texts(), ['first', 'last']);
  render(t(data(9).map(row)), el);
  assert.deepEqual(texts(), ['first', '9:L9', 'last']);
});

test('list switching to a template and back', () => {
  const t = (v) => html`<div>${v}</div>`;
  render(t(data(1, 2).map(row)), el);
  assert.equal(el.querySelectorAll('li').length, 2);
  render(t(html`<b>solo</b>`), el);
  assert.equal(read(), '<div><b>solo</b></div>');
  render(t(data(3).map(row)), el);
  assert.deepEqual(texts(), ['3:L3']);
});

// ── the paths the optimizations made riskiest ───────────────────────────────

test('keyed item that changes template shape under the same key (element-mode demote)', () => {
  const rowA = (r) => keyed(r.id, html`<li>A:${r.label}</li>`);
  const rowB = (r) => keyed(r.id, html`<li class="b">B:${r.label}</li>`);
  render(ul(data(1, 2, 3).map(rowA)), el);
  assert.deepEqual(texts(), ['A:L1', 'A:L2', 'A:L3']);
  // same keys, two items switch to a different template shape
  render(ul([rowB({ id: 1, label: 'L1' }), rowA({ id: 2, label: 'L2' }), rowB({ id: 3, label: 'L3' })]), el);
  assert.deepEqual(texts(), ['B:L1', 'A:L2', 'B:L3']);
  assert.equal(items()[0].getAttribute('class'), 'b');
  // and back again, plus a reorder in the same pass
  render(ul([rowA({ id: 3, label: 'L3' }), rowA({ id: 1, label: 'L1' })]), el);
  assert.deepEqual(texts(), ['A:L3', 'A:L1']);
});

test('multi-root keyed items reconcile and move correctly (markered path)', () => {
  const pair = (r) => keyed(r.id, html`<li>${r.id}a</li><li>${r.id}b</li>`);
  render(ul(data(1, 2, 3).map(pair)), el);
  assert.deepEqual(texts(), ['1a', '1b', '2a', '2b', '3a', '3b']);
  render(ul(data(3, 1).map(pair)), el);
  assert.deepEqual(texts(), ['3a', '3b', '1a', '1b']);
  render(ul(data(2, 3, 1).map(pair)), el);
  assert.deepEqual(texts(), ['2a', '2b', '3a', '3b', '1a', '1b']);
});

test('mixed single-root and multi-root keyed items', () => {
  const one = (r) => keyed(r.id, html`<li>${r.id}solo</li>`);
  const two = (r) => keyed(r.id, html`<li>${r.id}a</li><li>${r.id}b</li>`);
  render(ul([one({ id: 1 }), two({ id: 2 }), one({ id: 3 })]), el);
  assert.deepEqual(texts(), ['1solo', '2a', '2b', '3solo']);
  render(ul([one({ id: 3 }), two({ id: 2 }), one({ id: 1 })]), el);
  assert.deepEqual(texts(), ['3solo', '2a', '2b', '1solo']);
});

// ── hold(): cache-style DOM preservation ────────────────────────────────────

test('hold() preserves DOM and element state across a toggle', () => {
  const editor = () => html`<input class="ed" />`;
  const viewer = (v) => html`<p>view:${v}</p>`;
  const t = (mode, v) => html`<div>${hold(mode ? editor() : viewer(v))}</div>`;

  render(t(true), el);
  const input = el.querySelector('input');
  input.value = 'typed by the user'; // element state, not framework state

  render(t(false, 1), el);
  assert.equal(el.querySelector('input'), null);
  assert.equal(el.querySelector('p').textContent, 'view:1');

  render(t(true), el);
  assert.ok(el.querySelector('input') === input); // the SAME element came back
  assert.equal(el.querySelector('input').value, 'typed by the user');

  render(t(false, 2), el); // and the held branch still takes fresh values
  assert.equal(el.querySelector('p').textContent, 'view:2');
});

test('hold() updates values in place when the template does not change', () => {
  const t = (v) => html`<div>${hold(html`<b>${v}</b>`)}</div>`;
  render(t('x'), el);
  const b = el.querySelector('b');
  render(t('y'), el);
  assert.ok(el.querySelector('b') === b);
  assert.equal(b.textContent, 'y');
});

// ── React-shaped event bindings: onClick ≡ @click, buildless ───────────────────────────────────
test('onClick-style bindings attach listeners; onclick stays an attribute', () => {
  let clicks = 0;
  render(html`<button onClick=${() => clicks++} onDblClick=${() => clicks++}>go</button>`, el);
  const button = el.querySelector('button');
  button.dispatchEvent(new dom.window.Event('click'));
  button.dispatchEvent(new dom.window.Event('dblclick'));
  assert.equal(clicks, 2, 'onClick and onDblClick both fire');
  assert.equal(button.hasAttribute('onClick'), false, 'no attribute residue');

  const el2 = document.createElement('div');
  render(html`<i onclick=${'alert(1)'}></i>`, el2);
  assert.equal(el2.querySelector('i').getAttribute('onclick'), 'alert(1)',
    'all-lowercase onclick remains a plain attribute (inline-handler HTML)');
});

// ── value injection ─────────────────────────────────────────────────────────
//
// Interpolated values are DATA, never markup. The renderer writes them with `.data` and
// `setAttribute` rather than parsing HTML, so this is structural rather than a sanitiser — which
// is exactly why it deserves assertions. These moved here from `inserts-registry.test.mjs` when
// core's default renderer (and its escaping) was removed in 0.2.0.

test('a text value containing markup renders as text, not elements', () => {
  render(html`<div>${'<img src=x onerror=alert(1)>'}</div>`, el);
  assert.equal(el.querySelector('img'), null, 'no element is created from a value');
  assert.equal(el.querySelector('div').textContent, '<img src=x onerror=alert(1)>');
});

test('a value cannot break out of an attribute', () => {
  render(html`<div title="${'" onmouseover="steal()'}">x</div>`, el);
  const div = el.querySelector('div');
  assert.equal(div.getAttribute('onmouseover'), null, 'no attribute is injected');
  assert.equal(div.getAttribute('title'), '" onmouseover="steal()', 'the quote is data, kept verbatim');
});

test('a value cannot introduce a script element', () => {
  render(html`<div>${'</div><script>alert(1)</script>'}</div>`, el);
  assert.equal(el.querySelector('script'), null);
});

test('markup in a keyed list item is text too', () => {
  const rows = (xs) => html`<ul>${xs.map((x) => keyed(x, html`<li>${x}</li>`))}</ul>`;
  render(rows(['<b>a</b>', '<i>b</i>']), el);
  assert.equal(el.querySelector('b'), null);
  assert.equal(el.querySelector('i'), null);
  assert.equal(el.querySelectorAll('li').length, 2);
});

// ── clear: the whole-parent fast path ───────────────────────────────────────
//
// `ChildPart._clear()` replaces per-node removal with one `parent.textContent = ''` when the part
// owns the parent's entire contents. Since 0.1.2 a nested part always owns an end marker, so the
// original `_end === null` condition only ever matched a ROOT part and never the common
// `<tbody>${rows}</tbody>` shape. The condition now also accepts "end is the last child".
//
// That makes the destructive path fire in more places, so these pin the boundary: it must never
// run when anything else shares the parent.

test('clearing a whole-parent list leaves the parent empty and reusable', () => {
  const view = (xs) => html`<table><tbody>${xs.map((x) => keyed(x, html`<tr><td>${x}</td></tr>`))}</tbody></table>`;
  render(view([1, 2, 3]), el);
  assert.equal(el.querySelectorAll('tr').length, 3);
  render(view([]), el);
  assert.equal(el.querySelectorAll('tr').length, 0);
  /** The part must still work after the destructive clear — its anchors were re-appended. */
  render(view([7, 8]), el);
  assert.equal(read(), '<table><tbody><tr><td>7</td></tr><tr><td>8</td></tr></tbody></table>');
});

test('clearing one part never destroys a sibling sharing the parent', () => {
  const view = (a, b) => html`<div>${a.map((x) => keyed(x, html`<i>${x}</i>`))}${b.map((x) => keyed(x, html`<b>${x}</b>`))}</div>`;
  render(view([1, 2], [8, 9]), el);
  assert.equal(read(), '<div><i>1</i><i>2</i><b>8</b><b>9</b></div>');

  /** Clearing the FIRST list must leave the second intact — nothing follows it, so a naive
      whole-parent clear would take both. */
  render(view([], [8, 9]), el);
  assert.equal(read(), '<div><b>8</b><b>9</b></div>', 'second list survived');

  /** And the reverse: clearing the second must leave the first. */
  render(view([1, 2], []), el);
  assert.equal(read(), '<div><i>1</i><i>2</i></div>', 'first list survived');

  /** Both still update afterwards. */
  render(view([4], [5]), el);
  assert.equal(read(), '<div><i>4</i><b>5</b></div>');
});

test('a list with static siblings in the parent clears only itself', () => {
  const view = (xs) => html`<ul><li>head</li>${xs.map((x) => keyed(x, html`<li>${x}</li>`))}<li>tail</li></ul>`;
  render(view([1, 2]), el);
  assert.equal(read(), '<ul><li>head</li><li>1</li><li>2</li><li>tail</li></ul>');
  render(view([]), el);
  assert.equal(read(), '<ul><li>head</li><li>tail</li></ul>', 'static siblings survive');
});

// ── DOM nodes at a child position ───────────────────────────────────────────

/**
 * A node renders as itself rather than being coerced to `[object HTMLElement]`. This is what makes
 * a template able to hold something another library owns — a charting canvas, a map container, an
 * editor instance — without an element ref and a manual `append`.
 */
test('a DOM node renders as itself', () => {
  const span = document.createElement('span');
  span.textContent = 'mine';
  render(html`<div>${span}</div>`, el);
  assert.equal(el.querySelector('span'), span, 'the very same node, not a copy');
  assert.equal(read(), '<div><span>mine</span></div>');
});

test('a document fragment renders its children', () => {
  const template = document.createElement('template');
  template.innerHTML = '<b>x</b><i>y</i>';
  render(html`<div>${template.content.cloneNode(true)}</div>`, el);
  assert.equal(read(), '<div><b>x</b><i>y</i></div>');
});

test('one node replaces another', () => {
  const a = document.createElement('a');
  const b = document.createElement('b');
  render(html`<div>${a}</div>`, el);
  render(html`<div>${b}</div>`, el);
  assert.equal(read(), '<div><b></b></div>');
  assert.equal(el.querySelector('a'), null, 'the previous node left');
});

test('re-rendering the same node does not duplicate it', () => {
  const a = document.createElement('a');
  render(html`<div>${a}</div>`, el);
  render(html`<div>${a}</div>`, el);
  render(html`<div>${a}</div>`, el);
  assert.equal(el.querySelectorAll('a').length, 1);
});

test('a node position moves to text and back', () => {
  const a = document.createElement('a');
  a.textContent = 'A';
  render(html`<div>${a}</div>`, el);
  render(html`<div>${'text'}</div>`, el);
  assert.equal(read(), '<div>text</div>');
  render(html`<div>${a}</div>`, el);
  assert.equal(el.querySelector('a'), a, 'the node came back');
  render(html`<div>${null}</div>`, el);
  assert.equal(read(), '<div></div>');
});

test('nodes render inside arrays and keyed lists', () => {
  const nodes = [1, 2, 3].map((n) => {
    const li = document.createElement('li');
    li.textContent = n;
    return li;
  });
  render(html`<ul>${nodes}</ul>`, el);
  assert.equal(read(), '<ul><li>1</li><li>2</li><li>3</li></ul>');
  render(html`<ul>${nodes.map((node, i) => keyed(i, node))}</ul>`, el);
  assert.equal(el.querySelectorAll('li')[0], nodes[0], 'keyed items hold the node itself');
});

/* ── `!name`: a live property ────────────────────────────────────────────────────────────────── */
/**
 * Every other binding skips a write when the value matches what it last wrote. That is what keeps
 * a field someone typed into, and it is exactly wrong for a control whose DOM state changes as a
 * **side effect of interacting with a sibling**.
 *
 * A radio group is the case. Clicking B unchecks A in the DOM with no event on A, so A's binding
 * still says `true`, still matches what it committed, and never writes again — the model and the
 * page diverge and no amount of re-rendering reconciles them. Measured before this existed: state
 * said `a`, the DOM showed `b`, and a re-render left it that way.
 */
test('a live property reasserts after a sibling changed the DOM', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const draw = (picked) => render(html`
    <input id="a" type="radio" name="g" !checked=${picked === 'a'} />
    <input id="b" type="radio" name="g" !checked=${picked === 'b'} />`, el);

  draw('a');
  const a = el.querySelector('#a');
  const b = el.querySelector('#b');
  assert.equal(a.checked, true);

  /** What a click does: B on, A off, and nothing tells A's binding. */
  b.checked = true;
  assert.equal(a.checked, false);

  draw('a');
  assert.equal(a.checked, true, 'the model won the disagreement');
  assert.equal(b.checked, false);
  assert.equal(a.getAttribute('!checked'), null, 'the sigil leaves no residue');
});

test('a live selected option reasserts the same way', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const draw = (picked) => render(
    html`<select><option id="x" !selected=${picked === 'x'}>x</option><option id="y" !selected=${picked === 'y'}>y</option></select>`,
    el
  );
  draw('x');
  const x = el.querySelector('#x');
  el.querySelector('#y').selected = true;
  assert.equal(x.selected, false);
  draw('x');
  assert.equal(x.selected, true, 'the model won');
});

/**
 * A plain `.value` is deliberately *not* live: a person's typing stands. That is the documented
 * reason there is no `live()` by default, and the pair of tests is what keeps the two apart.
 */
test('a plain property still leaves what a person typed', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const draw = (v) => render(html`<input .value=${v} />`, el);
  draw('Ada');
  const input = el.querySelector('input');
  input.value = 'Grace';
  draw('Ada');
  assert.equal(input.value, 'Grace', 'the dirty check kept the typed text');
});

test('but a live value property does not', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const draw = (v) => render(html`<input !value=${v} />`, el);
  draw('Ada');
  const input = el.querySelector('input');
  input.value = 'Grace';
  draw('Ada');
  assert.equal(input.value, 'Ada', 'live is authoritative — which is why it is not the default');
});
