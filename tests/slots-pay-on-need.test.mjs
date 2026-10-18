/**
 * **Only a host that needs slotting pays for it** (2026-10-17). Once an app wires slots, a light-DOM component with no
 * light content and no `<slot>` gets no light, no holding element and no observer. Slots starts at its first slot (the
 * template renders one: `mount`) or its first light child (captured at `init`, hidden as native hides it). A host with
 * light children but no slot is captured and hidden, and is OBSERVED only from its first slot. Counted through
 * `MutationObserver.prototype.observe`, exactly: a count of 0 that never counted anything would pass, so each row first
 * shows the counter counting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'MutationObserver', 'ShadowRoot', 'CSSStyleSheet', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

let observes = 0;
const observe = dom.window.MutationObserver.prototype.observe;
dom.window.MutationObserver.prototype.observe = function (...args) {
  observes++;
  return observe.apply(this, args);
};

/** Holding elements made (slots' hidden `<ins>`, one per light it creates). */
let holdings = 0;
const createElement = dom.window.Document.prototype.createElement;
dom.window.Document.prototype.createElement = function (name, ...rest) {
  if (name === 'ins') holdings++;
  return createElement.call(this, name, ...rest);
};

/** WeakRefs made to a component a TEMPLATE created (slots' `FED` records one per element it feeds). */
let rowRefs = 0;
const NativeWeakRef = globalThis.WeakRef;
globalThis.WeakRef = class extends NativeWeakRef {
  constructor(target) {
    super(target);
    if (target?.localName === 'pon-row') rowRefs++;
  }
};

const { init, html, wire, ref, flush } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { slots } = await load('renderer/slots');
wire([renderer, slots]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const open = ref(false);
customElements.define('pon-row', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<p>row</p>`); }
});
customElements.define('pon-plain', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<p>plain</p>`); }
});
customElements.define('pon-late', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<main>${open.value ? html`<em><slot>fallback</slot></em>` : null}</main>`); }
});
customElements.define('pon-slotted', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<em><slot></slot></em>`); }
});

test('CONTROL: a host with a slot is observed and gets a holding element — the counters count', async () => {
  const before = observes;
  const made = holdings;
  const el = document.createElement('pon-slotted');
  el.append(document.createElement('b'));
  document.body.append(el);
  flush();
  await settle();
  assert.ok(observes > before, `observe() calls: ${observes - before}`);
  assert.ok(holdings > made, `holding elements: ${holdings - made}`);
  assert.equal(el.querySelector('em > b') !== null, true, 'and its light child is slotted');
  el.remove();
});

test('an empty host whose template renders no slot makes no light: no holding element, no observer registration', async () => {
  const before = observes;
  const made = holdings;
  const hosts = [];
  for (let i = 0; i < 20; i++) {
    const el = document.createElement('pon-plain');
    document.body.append(el);
    hosts.push(el);
  }
  flush();
  await settle();
  assert.equal(observes - before, 0, 'observe() calls for 20 plain hosts');
  assert.equal(holdings - made, 0, 'holding elements for 20 plain hosts');
  assert.deepEqual(hosts.map((el) => el.querySelector('p')?.textContent), Array(20).fill('plain'), 'they rendered');
  for (const el of hosts) el.remove();
});

test('a host with light children and no slot hides them, and is observed only from its first slot', async () => {
  open.value = false;
  flush();
  const before = observes;
  const el = document.createElement('pon-late');
  const child = document.createElement('b');
  child.textContent = 'LIGHT';
  el.append(child);
  document.body.append(el);
  flush();
  await settle();
  assert.equal(child.parentNode !== el && el.querySelector('main').textContent === '', true, `hidden while there is no slot: ${el.innerHTML}`);
  assert.equal(observes - before, 0, 'observe() calls before its first slot');
  open.value = true;
  flush();
  await settle();
  assert.equal(el.querySelector('em')?.textContent, 'LIGHT', `its first slot shows it: ${el.innerHTML}`);
  assert.ok(observes - before > 0, 'observed from its first slot');
  el.remove();
});

test('KNOWN (native hides it): a child appended BY HAND to an empty slotless host shows until a slot renders, then is slotted', async () => {
  open.value = false;
  flush();
  const el = document.createElement('pon-late');
  document.body.append(el);
  flush();
  await settle();
  const child = document.createElement('b');
  child.textContent = 'LIGHT';
  el.append(child);
  flush();
  await settle();
  assert.equal(child.parentNode === el, true, 'still the host child, beside the render: the divergence this row pins');
  open.value = true;
  flush();
  await settle();
  assert.equal(el.querySelector('em')?.textContent, 'LIGHT', `slotted once a slot renders: ${el.innerHTML}`);
  assert.ok(el.querySelector('main')?.parentNode === el, "the component's own content is not swallowed");
  el.remove();
});

test('a list a TEMPLATE renders, of components it gives no children, makes slots record nothing per row', async () => {
  const list = document.createElement('div');
  document.body.append(list);
  const draw = (rows) => html`${rows.map(() => html`<pon-row></pon-row>`)}`;
  const fed = (rows) => html`${rows.map(() => html`<pon-row><b>light</b></pon-row>`)}`;
  const before = observes;
  const made = holdings;
  const refs = rowRefs;
  renderInto(draw([1, 2, 3, 4, 5]), list);
  flush();
  await settle();
  assert.equal(list.querySelectorAll('pon-row p').length, 5, 'they rendered');
  assert.equal(observes - before, 0, 'observe() calls');
  assert.equal(holdings - made, 0, 'holding elements');
  assert.equal(rowRefs - refs, 0, 'WeakRefs to the rows');
  renderInto(draw([]), list);
  /** CONTROL: rows the template DOES give children are recorded — the counter counts. */
  renderInto(fed([1, 2]), list);
  flush();
  await settle();
  assert.ok(rowRefs - refs > 0, `WeakRefs to rows with template children: ${rowRefs - refs}`);
  list.remove();
});


test('a child PREPENDED by hand to a slotless host is slotted once a re-render brings a slot (the late light captures it)', async () => {
  open.value = false;
  flush();
  const el = document.createElement('pon-late');
  document.body.append(el);
  flush();
  await settle();
  const child = document.createElement('b');
  child.textContent = 'FIRST';
  el.prepend(child);
  open.value = true;
  flush();
  await settle();
  assert.equal(el.querySelector('em')?.textContent, 'FIRST', `slotted: ${el.innerHTML}`);
  assert.ok(el.querySelector('main')?.parentNode === el, "the component's own content is not swallowed");
  el.remove();
});

const tick = ref(0);
let tickRenders = 0;
customElements.define('pon-tick', class extends HTMLElement {
  connectedCallback() { init(this, () => () => { tickRenders++; return html`<main>${tick.value}</main>`; }); }
});
test('a child PREPENDED by hand to a slotless host is hidden by the next re-render, as native hides it (vera-5a: not left visible)', async () => {
  const el = document.createElement('pon-tick');
  document.body.append(el);
  flush();
  await settle();
  const child = document.createElement('b');
  child.textContent = 'EARLY';
  el.prepend(child);
  const before = tickRenders;
  tick.value++;
  flush();
  await settle();
  assert.ok(tickRenders > before, 'CONTROL: it re-rendered');
  assert.equal(child.parentNode !== el, true, `hidden after a re-render with no slot: ${el.innerHTML}`);
  el.remove();
});
