/**
 * **`node.assignedSlot` answers for light slots** (Brian, 2026-10-18: race it). Slots replaces the platform's getter on
 * the prototypes that define it, once per window at its first light host, answering from what distribution already
 * records (`PLACED`) and deferring to the getter it replaced for every other node. So a light child answers its slot,
 * a held one answers null, and code that patched the getter before or after slots keeps its own answers.
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

/** A FOREIGN patcher installed BEFORE slots: it answers for nodes it marks, and defers to the native getter otherwise. */
const FOREIGN = Symbol('foreign');
const proto = dom.window.Element.prototype;
const native = Object.getOwnPropertyDescriptor(proto, 'assignedSlot');
assert.ok(native?.get, 'CONTROL: the platform defines assignedSlot on Element.prototype');
Object.defineProperty(proto, 'assignedSlot', { configurable: true, enumerable: native.enumerable, get() { return this[FOREIGN] ?? native.get.call(this); } });

const { init, html, wire, flush } = await load('core');
const { renderer } = await load('renderer');
const { slots } = await load('renderer/slots');
wire([renderer, slots]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

let refs = {};
const ref = (key) => (el) => { if (el) refs[key] = el; };
customElements.define('as-card', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<header><slot name="h" &ref=${ref('h')}>fh</slot></header><main><slot &ref=${ref('d')}>fd</slot></main>`); }
});

const make = async () => {
  refs = {};
  const el = document.createElement('as-card');
  const b = document.createElement('b');
  b.setAttribute('slot', 'h');
  const i = document.createElement('i');
  const t = document.createTextNode('text');
  el.append(b, i, t);
  document.body.append(el);
  flush();
  await settle();
  return { el, b, i, t };
};

test("a light child answers the slot it is in — an element and a text node — and moves with a re-slot", async () => {
  const { el, b, i, t } = await make();
  assert.equal(b.assignedSlot, refs.h, 'the named slot');
  assert.equal(i.assignedSlot, refs.d, 'the default slot');
  assert.equal(t.assignedSlot, refs.d, 'a text node too (the Slottable mixin is on Text as well)');
  b.setAttribute('slot', 'nowhere');
  flush();
  await settle();
  assert.equal(b.assignedSlot, null, 'no slot of that name: null, as natively');
  el.remove();
});

test('a node slots never placed, and one in a shadow root, answer as before (the replaced getter)', async () => {
  const loose = document.createElement('p');
  assert.equal(loose.assignedSlot, null, 'not slotted: null');
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const slot = document.createElement('slot');
  shadow.append(slot);
  const child = document.createElement('span');
  host.append(child);
  document.body.append(host);
  assert.equal(child.assignedSlot, slot, 'a native shadow assignment, answered natively');
  host.remove();
});

test('a foreign getter installed BEFORE slots keeps its answers; slots answers for its own nodes', async () => {
  const { el, b } = await make();
  const marked = document.createElement('q');
  marked[FOREIGN] = 'foreign-answer';
  assert.equal(marked.assignedSlot, 'foreign-answer', 'the earlier patcher still answers');
  assert.equal(b.assignedSlot, refs.h, 'and slots answers for what it placed');
  el.remove();
});

test('a foreign getter installed AFTER slots, deferring to the previous one, still gets slots\' answers', async () => {
  const { el, b } = await make();
  const ours = Object.getOwnPropertyDescriptor(proto, 'assignedSlot');
  const LATER = Symbol('later');
  Object.defineProperty(proto, 'assignedSlot', { configurable: true, enumerable: ours.enumerable, get() { return this[LATER] ?? ours.get.call(this); } });
  try {
    const marked = document.createElement('s');
    marked[LATER] = 'later-answer';
    assert.equal(marked.assignedSlot, 'later-answer', 'the later patcher answers for its own');
    assert.equal(b.assignedSlot, refs.h, 'and defers to slots for the rest');
  } finally {
    Object.defineProperty(proto, 'assignedSlot', ours);
  }
  el.remove();
});
