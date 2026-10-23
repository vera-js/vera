/**
 * **`@verajs/hot` — redefinition in development** (2026-10-22). A redefine swaps the live elements to the new code IN
 * PLACE: the element itself kept (identity, parent bindings), the old setup's cleanups run EXACTLY once, the new setup
 * runs, module stores and props survive, and what an element cannot take (a shadow-mode change, `formAssociated`)
 * becomes a cancelable reload request. Counts are exact, each with a control that the counted thing ran.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { define, html, wire, createStore, flush, effect, inserts } = await load('core');
const { renderer } = await load('renderer');
const { hot } = await load('hot');
/** Defined BEFORE hot is wired: its registration is the real class, so a redefine refuses. */
define('x-hot-early', () => () => html`<i>early</i>`);
wire([renderer, hot]);
const settle = async () => { flush(); await new Promise((resolve) => setTimeout(resolve, 0)); flush(); };
const reloads = [];
window.addEventListener('vera-hot-reload', (event) => { reloads.push(event.detail); event.preventDefault(); });

test('wired twice: the second does nothing, and nothing throws', () => {
  assert.equal(inserts.$hot, true, 'CONTROL: the first wiring set the flag');
  assert.doesNotThrow(() => wire([hot]));
  assert.equal(inserts.$hot, true);
});

test('a redefined setup swaps IN PLACE: old cleanup exactly once, new setup runs, the element kept', async () => {
  const counts = { old: 0, oldCleanup: 0, next: 0 };
  define('x-hot-basic', () => { counts.old++; effect(() => () => counts.oldCleanup++); return () => html`<b>one</b>`; });
  const el = document.createElement('x-hot-basic');
  document.body.append(el);
  await settle();
  assert.deepEqual(counts, { old: 1, oldCleanup: 0, next: 0 }, 'CONTROL: the first version ran once');
  assert.equal(el.textContent, 'one');
  define('x-hot-basic', () => { counts.next++; return () => html`<b>two</b>`; });
  await settle();
  assert.deepEqual(counts, { old: 1, oldCleanup: 1, next: 1 }, 'the old cleanup ran ONCE and the new setup ran ONCE');
  assert.equal(el.textContent, 'two', 'the same element shows the new version');
  assert.equal(document.querySelector('x-hot-basic'), el, 'the element itself was kept');
  el.remove();
});

test('a module store survives the swap and still drives the new version', async () => {
  const state = createStore({ n: 1 });
  define('x-hot-store', () => () => html`<b>a${state.n}</b>`);
  const el = document.createElement('x-hot-store');
  document.body.append(el);
  await settle();
  define('x-hot-store', () => () => html`<b>b${state.n}</b>`);
  await settle();
  assert.equal(el.textContent, 'b1');
  state.n = 2;
  await settle();
  assert.equal(el.textContent, 'b2', 'a write after the swap reaches the new render');
  el.remove();
});

test('props are kept, and code OUTSIDE the component that reads them stays subscribed across the swap', async () => {
  define({ tag: 'x-hot-props', props: { title: 'a' } }, (host) => () => html`<b>${host.title}</b>`);
  const el = document.createElement('x-hot-props');
  document.body.append(el);
  await settle();
  el.title = 'kept';
  let outside = 0;
  define('x-hot-reader', () => () => { outside++; return html`<i>${el.title}</i>`; });
  const reader = document.createElement('x-hot-reader');
  document.body.append(reader);
  await settle();
  const before = outside;
  define({ tag: 'x-hot-props', props: { title: 'a' } }, (host) => () => html`<u>${host.title}</u>`);
  await settle();
  assert.equal(el.textContent, 'kept', 'the value survived the swap');
  el.title = 'later';
  await settle();
  assert.equal(reader.textContent, 'later', 'the outside reader heard a write made after the swap');
  assert.ok(outside > before, 'CONTROL: the outside reader re-rendered');
  el.remove();
  reader.remove();
});

test('a prop the new version DECLARES gets its default on the live element', async () => {
  define({ tag: 'x-hot-newprop', props: { a: 1 } }, (host) => () => html`<b>${host.a}</b>`);
  const el = document.createElement('x-hot-newprop');
  document.body.append(el);
  await settle();
  define({ tag: 'x-hot-newprop', props: { a: 1, b: 2 } }, (host) => () => html`<b>${host.a}${host.b}</b>`);
  await settle();
  assert.equal(el.textContent, '12');
  el.remove();
});

test('the class define returns after a redefine is the registered one: `new` and `instanceof` work', async () => {
  const First = define('x-hot-class', () => () => html`<b>1</b>`);
  const Next = define('x-hot-class', () => () => html`<b>2</b>`);
  assert.equal(Next, First, 'the registered class both times');
  const made = new Next();
  assert.ok(made instanceof Next);
  document.body.append(made);
  await settle();
  assert.equal(made.textContent, '2', 'a new element runs the new version');
  made.remove();
});

test('methods are swapped on the registered prototype', async () => {
  define({ tag: 'x-hot-methods', methods: { hello() { return 'old'; } } }, () => () => html`<b></b>`);
  const el = document.createElement('x-hot-methods');
  document.body.append(el);
  await settle();
  assert.equal(el.hello(), 'old', 'CONTROL');
  define({ tag: 'x-hot-methods', methods: { hello() { return 'new'; }, more() { return 1; } } }, () => () => html`<b></b>`);
  assert.equal(el.hello(), 'new');
  assert.equal(el.more(), 1);
  el.remove();
});

test("a class component's disconnectedCallback is forwarded: a redefine that changes it takes effect", async () => {
  const calls = [];
  customElements.define('x-hot-disc', class extends HTMLElement { disconnectedCallback() { calls.push('old'); } });
  const el = document.createElement('x-hot-disc');
  document.body.append(el);
  customElements.define('x-hot-disc', class extends HTMLElement { disconnectedCallback() { calls.push('new'); } });
  el.remove();
  assert.deepEqual(calls, ['new']);
});

test('a removed element is not touched by a later swap (the live set holds only live elements)', async () => {
  let setups = 0;
  define('x-hot-gone', () => { setups++; return () => html`<b></b>`; });
  const el = document.createElement('x-hot-gone');
  document.body.append(el);
  await settle();
  el.remove();
  assert.equal(setups, 1, 'CONTROL');
  define('x-hot-gone', () => { setups++; return () => html`<b></b>`; });
  await settle();
  assert.equal(setups, 1, 'the removed element was not set up again');
});

test('attributes: a name the new version stops observing is filtered; a name it starts observing is watched and replayed', async () => {
  const seen = [];
  customElements.define('x-hot-attrs', class extends HTMLElement {
    static observedAttributes = ['a'];
    attributeChangedCallback(name, _old, value) { seen.push(`old:${name}=${value}`); }
  });
  const el = document.createElement('x-hot-attrs');
  el.setAttribute('b', 'present');
  document.body.append(el);
  el.setAttribute('a', '1');
  assert.deepEqual(seen, ['old:a=1'], 'CONTROL: the first version observes a');
  customElements.define('x-hot-attrs', class extends HTMLElement {
    static observedAttributes = ['b'];
    attributeChangedCallback(name, _old, value) { seen.push(`new:${name}=${value}`); }
  });
  await settle();
  assert.deepEqual(seen, ['old:a=1', 'new:b=present'], "b's current value was replayed once");
  el.setAttribute('a', '2');
  el.setAttribute('b', 'changed');
  await settle();
  assert.deepEqual(seen, ['old:a=1', 'new:b=present', 'new:b=changed'], 'a filtered out; b delivered (asynchronously)');
  el.remove();
});

test('a shadow-mode change is a reload request, and the live element is not set up with the wrong root', async () => {
  let setups = 0;
  define({ tag: 'x-hot-shadow', shadow: 'open' }, () => { setups++; return () => html`<b></b>`; });
  const el = document.createElement('x-hot-shadow');
  document.body.append(el);
  await settle();
  assert.equal(setups, 1, 'CONTROL');
  reloads.length = 0;
  define({ tag: 'x-hot-shadow', shadow: 'closed' }, () => { setups++; return () => html`<b></b>`; });
  await settle();
  assert.deepEqual(reloads, [{ tag: 'x-hot-shadow', reason: 'its shadow-root mode changed' }]);
  assert.equal(setups, 1, 'its setup was deferred, not run against the old root');
  el.remove();
});

test('a formAssociated change is a reload request', async () => {
  customElements.define('x-hot-form', class extends HTMLElement {});
  const el = document.createElement('x-hot-form');
  document.body.append(el);
  reloads.length = 0;
  customElements.define('x-hot-form', class extends HTMLElement { static formAssociated = true; });
  assert.deepEqual(reloads, [{ tag: 'x-hot-form', reason: 'formAssociated changed' }]);
  el.remove();
});

test('one reload request per swap: two live elements of one tag ask once, and another tag asks for itself', async () => {
  customElements.define('x-hot-form2', class extends HTMLElement {});
  customElements.define('x-hot-form3', class extends HTMLElement {});
  const els = ['x-hot-form2', 'x-hot-form2', 'x-hot-form3'].map((tag) => document.body.appendChild(document.createElement(tag)));
  reloads.length = 0;
  customElements.define('x-hot-form2', class extends HTMLElement { static formAssociated = true; });
  customElements.define('x-hot-form3', class extends HTMLElement { static formAssociated = true; });
  assert.deepEqual(reloads.map((r) => r.tag), ['x-hot-form2', 'x-hot-form3']);
  for (const el of els) el.remove();
});

test('a tag defined BEFORE hot was wired refuses a redefine, by code', () => {
  assert.throws(() => define('x-hot-early', () => () => html`<i></i>`), /hot-defined-first/);
});

test('a component INSIDE another closed root is reached by a swap', async () => {
  define('x-hot-inner', () => () => html`<b>in1</b>`);
  define({ tag: 'x-hot-outer', shadow: 'closed' }, () => () => html`<x-hot-inner></x-hot-inner>`);
  const outer = document.createElement('x-hot-outer');
  document.body.append(outer);
  await settle();
  let inner;
  define('x-hot-inner', (host) => { inner = host; return () => html`<b>in2</b>`; });
  await settle();
  assert.ok(inner !== undefined, 'the inner element (inside a CLOSED root) was set up again');
  assert.equal(inner.textContent, 'in2');
  outer.remove();
});

test('development: define-twice stays silent while hot is wired', { skip: isProduction && 'the warning is development-only' }, async () => {
  const warns = [];
  const warn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    define('x-hot-quiet', () => () => html`<b></b>`);
    define('x-hot-quiet', () => () => html`<b></b>`);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warns.filter((w) => w.includes('define-twice')), []);
});
