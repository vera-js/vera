/**
 * **`@verajs/renderer/elements` — the contract a claimant relies on**, one rule per test, each from
 * the spec agreed before it was built: claimants are asked once per template element; `mount` runs
 * when the render that created the instance has finished — in place, connected if its container is;
 * `unmount` gets what `mount` returned, at teardown; `hold()` is not teardown; several claimants on one
 * element each get their own. Every test asserts its control first: a claim that never ran would
 * satisfy "nothing unmounted" perfectly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment',
  'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer, renderInto, hold } = await load('renderer');
const { keyed } = await load('renderer/keyed');
const { elements } = await load('renderer/elements');
const { html } = core;

const log = [];
let asked = 0;
/** Claims `[data-track]`, logging every call; `data-keep` elements keep a value for unmount. */
const track = {
  mount(element, context) {
    log.push(`mount ${element.id} connected=${element.isConnected} root=${context.root?.id ?? null} adopted=${context.adopted}`);
    return element.hasAttribute('data-keep') ? `kept-${element.id}` : undefined;
  },
  unmount(kept, element) {
    log.push(`unmount ${element.id} ${kept}`);
  },
};
const second = { mount: (element) => log.push(`second ${element.id}`) };
core.wire([
  renderer,
  elements,
  { on: 'element', fn: (el) => { asked++; return el.hasAttribute('data-track') ? track : undefined; }, priority: 40 },
  { on: 'element', fn: (el) => (el.hasAttribute('data-both') ? second : undefined), priority: 50 },
]);

const host = (id) => {
  const element = document.createElement('div');
  element.id = id;
  document.body.append(element);
  return element;
};

test('claimants are asked once per element of a template, not once per instance', () => {
  const draw = (n) => html`<section><p data-track id=${'p' + n}></p><i></i></section>`;
  const a = host('a');
  const b = host('b');
  const c = host('c');
  asked = 0;
  renderInto(draw(1), a);
  const afterFirst = asked;
  renderInto(draw(2), b);
  renderInto(draw(3), c);
  assert.equal(afterFirst, 3, 'CONTROL: three elements were asked about');
  assert.equal(asked, afterFirst, 'and no one again for the next two instances');
  [a, b, c].forEach((h) => h.remove());
});

test('mount runs when the render has finished — connected, with its root', () => {
  log.length = 0;
  const h = host('root1');
  renderInto(html`<div><span data-track id="x"></span></div>`, h);
  assert.deepEqual(log, ['mount x connected=true root=root1 adopted=false']);
  h.remove();
});

test('an instance nested in another is connected at its mount too', () => {
  log.length = 0;
  const h = host('root2');
  const inner = () => html`<em data-track id="inner"></em>`;
  renderInto(html`<div>${inner()}</div>`, h);
  assert.deepEqual(log, ['mount inner connected=true root=root2 adopted=false'], 'nested instances are inserted only when the outer one is');
  h.remove();
});

test('unmount gets what mount kept, at teardown — and nothing when mount kept nothing', () => {
  const h = host('root3');
  const draw = (on) => html`${on ? html`<b data-track data-keep id="k"></b><b data-track id="n"></b>` : 'off'}`;
  log.length = 0;
  renderInto(draw(true), h);
  assert.deepEqual(log, ['mount k connected=true root=root3 adopted=false', 'mount n connected=true root=root3 adopted=false'], 'CONTROL: both mounted');
  log.length = 0;
  renderInto(draw(false), h);
  assert.deepEqual(log, ['unmount k kept-k'], 'only the one that kept a value is unmounted');
  h.remove();
});

test('several claimants on one element each mount, in wire order', () => {
  log.length = 0;
  const h = host('root4');
  renderInto(html`<p data-track data-both id="both"></p>`, h);
  assert.deepEqual(log, ['mount both connected=true root=root4 adopted=false', 'second both']);
  h.remove();
});

test('a claim sees static attributes, not bound ones', () => {
  log.length = 0;
  const h = host('root5');
  const draw = (flag) => html`<p data-track=${flag} id="bound"></p><p data-track id="static"></p>`;
  renderInto(draw(''), h);
  assert.deepEqual(log, ['mount static connected=true root=root5 adopted=false'],
    'the bound attribute is not there when the template is first asked about');
  h.remove();
});

test('hold() parks an instance without unmounting it, and restores it without mounting again', () => {
  const h = host('root6');
  const editor = () => html`<form data-track data-keep id="editor"></form>`;
  const viewer = () => html`<p>view</p>`;
  const draw = (editing) => html`${hold(editing ? editor() : viewer())}`;
  log.length = 0;
  renderInto(draw(true), h);
  assert.equal(log.length, 1, 'CONTROL: mounted once');
  renderInto(draw(false), h);
  renderInto(draw(true), h);
  assert.deepEqual(log, ['mount editor connected=true root=root6 adopted=false'], 'parked and restored: the same instance, one mount, no unmount');
  h.remove();
});

test('a keyed row dropped from a list unmounts', () => {
  const h = host('root7');
  const row = (id) => keyed(id, html`<li data-track data-keep id=${'row-' + id}></li>`);
  const draw = (ids) => html`<ul>${ids.map(row)}</ul>`;
  log.length = 0;
  renderInto(draw(['a', 'b']), h);
  assert.equal(log.filter((l) => l.startsWith('mount')).length, 2, 'CONTROL: both rows mounted');
  log.length = 0;
  renderInto(draw(['b']), h);
  assert.deepEqual(log, ['unmount row-a kept-row-a']);
  h.remove();
});

test('SVG elements are asked too', () => {
  log.length = 0;
  const h = host('root8');
  renderInto(html`<svg><circle data-track id="c"></circle></svg>`, h);
  assert.deepEqual(log, ['mount c connected=true root=root8 adopted=false']);
  h.remove();
});
