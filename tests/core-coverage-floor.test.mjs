/**
 * **Every branch of core's production bundle is run by some test** (2026-11-11, the coverage floor). A coverage pass of
 * the production suite left ten short branches unrun; each row here runs one and asserts what it is for, so the
 * floor holds behavior, not bytes. (The no-owner throw in `coalesce` is unreachable: its one caller passes its element
 * and a constant priority; it is reported, not tested.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];
const core = await load('core');
const { createStore, effect, html, init, wire, flush, inserts } = core;
const { renderer } = await load('renderer');
const { lists } = await load('renderer/keyed');
wire([renderer, lists]);
const watch = (read) => {
  let runs = 0;
  effect(() => { read(); runs++; }, { owner: {}, timing: 'sync' }).run();
  return () => runs - 1;
};
/** The walk gives the items a slot (`promote`), the state the slotted branches below need. */
const walked = (list) => {
  const items = [];
  inserts.$w(list, (raw, item) => items.push(item));
  return items;
};

test('a slotted array item and a slotted null-prototype item are data records: a write through each notifies', () => {
  const nested = [1];
  const bare = Object.assign(Object.create(null), { n: 1 });
  const s = createStore({ list: [nested, bare] });
  const [a, b] = walked(s.list);
  const wokeA = watch(() => a[0]);
  const wokeB = watch(() => b.n);
  a[0] = 2;
  b.n = 2;
  assert.equal(wokeA(), 1);
  assert.equal(wokeB(), 1);
});

test('a slotted item whose prototype changes through the store is asked again (unclassify), and its keys hide the slot', () => {
  const s = createStore({ list: [{ n: 1 }] });
  const [item] = walked(s.list);
  item.n = 2;
  Object.setPrototypeOf(item, { inherited: true });
  assert.equal(item.inherited, true);
  item.n = 3;
  assert.equal(item.n, 3);
  assert.deepEqual(Reflect.ownKeys(item), ['n'], 'the slot is never an own key through the store');
});

test('a hook made through the module seam with no owner throws no-owner', () => {
  const createHookSeam = inserts.$s[2];
  assert.throws(() => createHookSeam({ callback: () => {}, priority: 50 }), /no-owner/);
});

test('a store array\'s map called with a thisArg in a component\'s render runs as the language does', async () => {
  const s = createStore({ list: [1, 2] });
  const ctx = { k: 10 };
  class M extends HTMLElement {
    connectedCallback() { init(this, () => () => html`<p>${s.list.map(function (n) { return n + this.k; }, ctx).join(',')}</p>`); }
  }
  customElements.define('x-floor-map', M);
  const el = document.createElement('x-floor-map');
  document.body.append(el);
  await flush();
  assert.equal(el.textContent, '11,12');
  el.remove();
});

test('a store module whose handler has no `has` still answers `in` (the fallback)', () => {
  wire([{ on: 'store', priority: 70, fn: (type, handler) => (type === 'date' ? { get: (t, p) => { const v = Reflect.get(t, p, t); return typeof v === 'function' ? v.bind(t) : v; } } : handler) }]);
  const d = createStore(new Date(0));
  assert.equal('getTime' in d, true);
  assert.equal(d.getTime(), 0);
});

test('redefining an accessor with the same getter through the store notifies nothing', () => {
  const get = () => 1;
  const s = createStore({ o: {} });
  Object.defineProperty(s.o, 'k', { get, configurable: true });
  const woke = watch(() => s.o.k);
  Object.defineProperty(s.o, 'k', { get, configurable: true });
  assert.equal(woke(), 0);
});

test('a persisting component paused and resumed in a document with no window uses the global timers', async () => {
  class P extends HTMLElement {
    connectedCallback() { init({ host: this, persist: 1 }, () => () => html`<p>kept</p>`); }
  }
  customElements.define('x-floor-persist', P);
  const el = document.createElement('x-floor-persist');
  document.body.append(el);
  await flush();
  const bare = document.implementation.createHTMLDocument('no window');
  assert.equal(bare.defaultView, null, 'CONTROL: the document has no window');
  bare.body.append(bare.adoptNode(el));
  el.remove();
  bare.body.append(el);
  await flush();
  assert.equal(el.textContent, 'kept', 'the component kept its state through the pause');
  el.remove();
});
