/**
 * **A render tracks what IT reads — not the code it runs on someone else's behalf.**
 *
 * Committing a parent's template runs code the parent does not own: the refs the pass hands elements to, and a
 * component's GETTER when the framework reads it for the parent — `!value` comparing against a component's live
 * value, and `spread` recording a key's initial value so it can restore it. When that code read reactive state,
 * the read subscribed the PARENT, whose render hook was the one tracking: a ref reading state re-rendered its parent,
 * and a component whose getter reads its own store tied the parent to it.
 *
 * Core hands the renderer its `untracked` primitive (off the insert chains, on the registry `connect` receives), and
 * every such read goes through it — no behavior removed: `!value` still compares against the live value (the
 * controlled-input contract), and a key leaving a spread still restores the component's own initial value. What the
 * renderer reads ITSELF stays tracked: a store array handed straight to a template is walked during commit, and
 * that walk is what subscribes the parent to its length and items; a store object handed to `spread()` likewise.
 *
 * (A component SETTER that reads its own store still subscribes the parent — the class cure is per-run subscription
 * cleanup, scheduled with the core subscription redesign; core's README carries the `untrack()` workaround.)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'customElements', 'DocumentFragment', 'CustomEvent', 'Event'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const core = await load('core');
const { renderer } = await load('renderer');
const { spread } = await load('renderer/spread');
core.wire([renderer]);
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => setTimeout(r, 0)));
const frames = async (n) => { for (let i = 0; i < n; i++) await frame(); };

let defined = 0;
/** Defines a component whose render calls `draw` and counts its passes. */
const parent = (draw) => {
  const tag = `x-parent-${defined++}`;
  const counter = { renders: 0 };
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.render(() => { counter.renders++; return draw(); });
    }
  });
  const el = document.body.appendChild(document.createElement(tag));
  return { el, counter };
};

/** A component whose GETTER reads its own store — as a third-party or a vera component may. */
customElements.define('x-getter', class extends HTMLElement {
  state = core.createStore({ value: 'initial', size: 'medium' });
  get value() { return this.state.value; }
  set value(v) { this.state.value = v; }
  get size() { return this.state.size; }
  set size(v) { this.state.size = v ?? 'medium'; }
});

test('a ref that reads state does not subscribe the render that handed it the element', async () => {
  const state = core.createStore({ q: 0 });
  const { counter } = parent(() => core.html`<b ${(el) => el && state.q}></b>`);
  await frames(2);
  const settled = counter.renders;
  state.q = 1;
  await frames(2);
  assert.equal(counter.renders - settled, 0);
});

test("spread reading a component's initial value does not subscribe the parent to the component's store", async () => {
  const { el, counter } = parent(() => core.html`<x-getter ${spread({ '.value': 'bound' })}></x-getter>`);
  await frames(2);
  const settled = counter.renders;
  el.querySelector('x-getter').state.value = 'changed inside';
  await frames(2);
  assert.equal(counter.renders - settled, 0);
});

test("!value on a component is still controlled — forced back on the parent's next render — without subscribing the parent", async () => {
  const outer = core.createStore({ tick: 0 });
  const { el, counter } = parent(() => { outer.tick; return core.html`<x-getter !value=${'bound'}></x-getter>`; });
  await frames(2);
  const child = el.querySelector('x-getter');
  assert.equal(child.value, 'bound');
  const settled = counter.renders;
  child.state.value = 'typed'; // the component's own value changes, as a user typing would
  await frames(2);
  assert.equal(counter.renders - settled, 0, 'the parent was not subscribed to the component');
  outer.tick = 1; // the parent renders for its own reason…
  await frames(2);
  assert.equal(child.value, 'bound', '…and the live value is compared and forced back');
});

test("a key leaving a spread restores the component's own initial value — read untracked", async () => {
  const bag = core.createStore({ props: { '.size': 'large' } });
  const { el, counter } = parent(() => core.html`<x-getter ${spread({ ...bag.props })}></x-getter>`);
  await frames(2);
  const child = el.querySelector('x-getter');
  assert.equal(child.size, 'large');
  bag.props = {};
  await frames(2);
  assert.equal(child.size, 'medium', 'its own initial value came back');
  const settled = counter.renders;
  child.state.size = 'small';
  await frames(2);
  assert.equal(counter.renders - settled, 0, 'reading that initial value did not subscribe the parent');
});

test('what the renderer reads ITSELF stays tracked — a store array handed straight to a template', async () => {
  const state = core.createStore({ items: ['a'] });
  const { el } = parent(() => core.html`<ul>${state.items}</ul>`);
  await frames(2);
  state.items.push('b');
  await frames(2);
  assert.equal(el.textContent, 'ab');
});

test('…and a store object handed to spread()', async () => {
  const state = core.createStore({ attrs: { title: 'one' } });
  const { el } = parent(() => core.html`<p ${spread(state.attrs)}></p>`);
  await frames(2);
  state.attrs.title = 'two';
  await frames(2);
  assert.equal(el.querySelector('p').getAttribute('title'), 'two');
});

/**
 * Applies NEST — a spread key's write runs a component setter that renders, and applies, another spread — and on a
 * page with two cores the inner one is handed a DIFFERENT `untracked`. The outer's remaining keys must keep their
 * own. Checked at the protocol, with two distinguishable stand-ins, because one core cannot tell them apart.
 */
test("a nested spread apply does not change the untracked the outer's remaining keys use", () => {
  const used = [];
  const as = (label) => (fn, a, b, c) => { used.push([label, b]); return fn(a, b, c); };
  const inner = document.createElement('div');
  customElements.define('x-nests', class extends HTMLElement {
    set first(v) { spread({ '.innerKey': v })._$apply$(inner.appendChild(document.createElement('x-leaf')), {}, as('B')); }
    get first() { return undefined; }
  });
  const el = document.createElement('x-nests');
  spread({ '.first': 1, '.second': 2 })._$apply$(el, {}, as('A'));
  const second = used.find(([, key]) => key === 'second');
  assert.ok(second, 'the second key was read through an untracked stand-in');
  assert.equal(second[0], 'A', `the outer's second key used ${second[0]}'s untracked`);
});

/**
 * Whether a key's getter is read through `untracked` rests on the element's NAME (a dash), decided when the binding is
 * created — so a binding made BEFORE the element's class is defined still reads the upgraded component's getter
 * untracked afterwards.
 */
test('a spread binding made before its element was defined reads the upgraded getter untracked', async () => {
  const outer = core.createStore({ tick: 0 });
  const { el, counter } = parent(() => { outer.tick; return core.html`<x-lazy-getter ${spread({ '!value': 'bound' })}></x-lazy-getter>`; });
  await frames(2);
  customElements.define('x-lazy-getter', class extends HTMLElement {
    state = core.createStore({ value: 'initial' });
    get value() { return this.state.value; }
    set value(v) { this.state.value = v; }
  });
  outer.tick = 1; // a render after the upgrade: the `!value` compare now runs the component's getter
  await frames(2);
  const child = el.querySelector('x-lazy-getter');
  assert.equal(child.value, 'bound');
  const settled = counter.renders;
  child.state.value = 'typed';
  await frames(2);
  assert.equal(counter.renders - settled, 0, 'the parent was not subscribed through the upgraded getter');
});
