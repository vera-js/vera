/**
 * **A ref is told when its element stops being its own — on every path that takes the element away.**
 *
 * The rule stands from before the rebuild: a ref is released (`null`) when its subtree is rendered away, and not
 * when its component is merely disconnected (`tests/renderer-ref-lifetime.test.mjs`). Three paths did not honor
 * it: a list row that changed SHAPE was removed without a word; the instances `hold()` parked were never torn
 * down when their section was destroyed; and replacing one ref with another (or with nothing) never told the old
 * one. Each is pinned here, with `hold()`'s own promise beside it: parking is not destruction — a parked ref
 * keeps its element, which comes back.
 *
 * And one `hold()` defect found on the way, which predates the rebuild: an instance brought back from parking
 * stayed in the parked map while shown, so clearing the section stranded it there with its nodes removed, and a
 * fragment-rooted template brought back afterwards rendered NOTHING.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'customElements', 'DocumentFragment'])
  globalThis[key] = dom.window[key];
const { renderInto, hold } = await load('renderer');
const { keyed } = await load('renderer/keyed');
const html = (strings, ...values) => ({ _$litType$: 1, strings, values });
const tag = (el) => (el === null ? null : el.localName);

test('replacing a ref tells the old one first; removing it tells it too', () => {
  const host = document.body.appendChild(document.createElement('div'));
  const log = [];
  const A = (el) => log.push(['A', tag(el)]);
  const B = (el) => log.push(['B', tag(el)]);
  const draw = (r) => renderInto(html`<i ${r}></i>`, host);
  draw(A);
  draw(B);
  draw(null);
  assert.deepEqual(log, [['A', 'i'], ['A', null], ['B', 'i'], ['B', null]]);
});

test('an object ref swapped for another is emptied, and the new one holds the element', () => {
  const host = document.body.appendChild(document.createElement('div'));
  const x = { value: null };
  const y = { value: null };
  const draw = (r) => renderInto(html`<i ${r}></i>`, host);
  draw(x);
  const el = host.querySelector('i');
  assert.equal(x.value, el);
  draw(y);
  assert.equal(x.value, null);
  assert.equal(y.value, el);
});

test("a list row whose SHAPE changes releases the ref its old shape held", () => {
  const host = document.body.appendChild(document.createElement('div'));
  const box = { value: null };
  const draw = (rows) => renderInto(html`<ul>${rows}</ul>`, host);
  const withRef = () => keyed(1, html`<li ${box}>row</li>`);
  const plain = () => keyed(1, html`<li>row, reshaped</li>`);
  draw([withRef()]);
  assert.equal(box.value?.localName, 'li');
  draw([plain()]);
  assert.equal(box.value, null);
});

test('hold(): a parked ref keeps its element, gets it back on return, and is released when its section is destroyed', () => {
  const host = document.body.appendChild(document.createElement('div'));
  const box = { value: null };
  const editor = () => html`<input ${box}>`;
  const viewer = () => html`<p>view</p>`;
  const draw = (editing) => renderInto(html`<section>${hold(editing ? editor() : viewer())}</section>`, host);
  draw(true);
  const input = box.value;
  assert.equal(input?.localName, 'input');
  draw(false);
  assert.equal(box.value, input, 'parking is not destruction');
  draw(true);
  assert.equal(box.value, input, 'the same element came back');
  draw(false);
  renderInto(null, host);
  assert.equal(box.value, null, 'the section went away, and what it had parked went with it');
});

test('hold(): clearing a section does not destroy what it parked — only destroying the section does', () => {
  const host = document.body.appendChild(document.createElement('div'));
  const box = { value: null };
  const editor = () => html`<input ${box}>`;
  const viewer = () => html`<p>view</p>`;
  const draw = (v) => renderInto(html`<section>${v}</section>`, host);
  draw(hold(editor()));
  const input = box.value;
  draw(hold(viewer())); // the editor is parked
  draw(null); // the section is cleared, and lives on
  assert.equal(box.value, input, 'a cleared section keeps what it parked');
  draw(hold(editor()));
  assert.equal(box.value, input, 'and it comes back');
});

test('hold(): a LIST ITEM that parked something releases it when the list lets the item go', () => {
  const host = document.body.appendChild(document.createElement('div'));
  const box = { value: null };
  const editor = () => html`<input ${box}>`;
  const viewer = () => html`<p>view</p>`;
  const draw = (items) => renderInto(html`<div>${items}</div>`, host);
  draw([hold(editor())]);
  const input = box.value;
  draw([hold(viewer())]); // the item's own part parks the editor
  assert.equal(box.value, input, 'parked, not destroyed');
  draw([]);
  assert.equal(box.value, null, 'the item went away, and what it had parked went with it');
});

/** A value with `_$apply$` owns its own lifecycle (spread's result, a directive's value): release never writes to it. */
test('replacing a value that applies itself never writes .value onto it', () => {
  const host = document.body.appendChild(document.createElement('div'));
  const applier = { value: 'its own', _$apply$() {} };
  const draw = (r) => renderInto(html`<i ${r}></i>`, host);
  draw(applier);
  draw(null);
  assert.equal(applier.value, 'its own');
});

test('hold(): a template brought back, cleared, and brought back again renders — fragment-rooted too', () => {
  for (const [shape, A] of [
    ['element-rooted', (t) => html`<p>${t}</p>`],
    ['fragment-rooted', (t) => html`<p>${t}</p><i>two</i>`],
  ]) {
    const host = document.body.appendChild(document.createElement('div'));
    const B = () => html`<b>viewer</b>`;
    const draw = (v) => renderInto(html`<section>${v}</section>`, host);
    draw(hold(A('one')));
    draw(hold(B()));
    draw(hold(A('two')));
    draw(null);
    draw(hold(A('three')));
    assert.equal(host.querySelector('p')?.textContent, 'three', shape);
  }
});

/**
 * **Every way the renderer takes DOM away is on this list, with the reason it is safe.** The shape-change leak
 * was one unrouted `element.remove()`, so a new removal site must be looked at on purpose: it fails here until it
 * is added — and a removal can be spelled four ways (`.remove()`, `removeChild(`, `textContent = ''`, a move into
 * `SCRATCH`), so all four are scanned. The floor keeps a rename from emptying the scan.
 */
test('every removal site in renderer.ts is accounted for', () => {
  const source = readFileSync(new URL('../packages/renderer/src/renderer.ts', import.meta.url), 'utf8');
  const ALLOWED = {
    "el.textContent = '';": 'template construction: rebuilding a raw-text element in the inert template, before any instance exists',
    'parent.removeChild(at!);': "template construction: a sole child position's placeholder, in the inert template",
    "parent.textContent = '';": "_clear's fast path — after _detach() told the content (when anything asked to be told)",
    "if (owner !== null) owner.textContent = '';": "_clear for a SOLE part that owns its plain element's whole content — after _detach(), as above",
    'parent.removeChild(node);': "_clear's walk — after _detach(), as above",
    '} else (root as ChildNode).remove();': 'hold() parking an element-rooted instance: a move, not a destruction',
    'element.remove();': "$u, a row's shape changed — after teardown(item)",
    'this.$m(item, null, SCRATCH);': '$d — after detachItem(item)',
    'for (let i = count; i < items.length; i++) this.$m(items[i], null, SCRATCH);': 'list shrink — after detachItem on each',
    "SCRATCH.textContent = '';": 'emptying the scratch fragment the lines above moved removed items into',
  };
  const found = source
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .map((line) => line.trim())
    .filter((line) => /\.remove\(\)|removeChild\(|textContent = ''|, SCRATCH\)/.test(line));
  assert.ok(found.length >= 9, `only ${found.length} removal sites found — has the scan stopped matching?`);
  const unlisted = found.filter((line) => !(line in ALLOWED));
  assert.deepEqual(unlisted, [], 'a removal site nobody has accounted for — route it through detach/teardown, then list it');
  const gone = Object.keys(ALLOWED).filter((line) => !found.includes(line));
  assert.deepEqual(gone, [], 'a listed site no longer exists — update the list');
});

/**
 * A ref ON a `<select>` has a kind of its own (a spread there waits for the select's options), and teardown must know
 * it as a ref: every path above releases it the same way.
 */
test('a ref on a <select> is released like any other when its row is rendered away', () => {
  const host = document.body.appendChild(document.createElement('div'));
  const box = { value: null };
  const log = [];
  const fn = (el) => log.push(tag(el));
  const draw = (rows) => renderInto(html`<ul>${rows}</ul>`, host);
  const withRefs = () => keyed(1, html`<li><select ${box}></select><select ${fn}></select></li>`);
  const plain = () => keyed(1, html`<li>row, reshaped</li>`);
  draw([withRefs()]);
  assert.equal(box.value?.localName, 'select', 'CONTROL: the object ref was handed its select');
  draw([plain()]);
  assert.equal(box.value, null, 'the object ref was emptied');
  assert.deepEqual(log, ['select', null], 'the function ref was told');
});
