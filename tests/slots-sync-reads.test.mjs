/**
 * **When a light host's assignment is current** (an observer pair per light, 2026-10-07).
 *
 * Slots used to keep ONE observer pair for every light host, which Gecko pays for linearly at each `observe()` — every
 * new host slower in Firefox, without end. Each light now has its own pair, and a flush reads the records of the lights
 * it can name: the one being read or rendered, every light whose element the finished render's root created (`FED`),
 * the work set, and parked branches. So what the FRAMEWORK does stays synchronous, and so does every read through the
 * slots API. What changed, measured against 737c7a4 on the same sequences (`.probe/sync-reads` in vera-hydra): a host
 * changed DIRECTLY by page code, followed in the same task by an UNRELATED host's render, is redistributed at the
 * microtask, where the shared pair used to take its records along with that render's. A direct change with no render
 * after it was already distributed at the microtask before.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver', 'Comment', 'Text'])
  globalThis[key] = dom.window[key];

const { wire, html, init } = await load('core');
const { renderer, renderInto, hold } = await load('renderer');
const { slots, slotted } = await load('renderer/slots');
wire([renderer, slots]);
const doc = dom.window.document;
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
customElements.define('sync-host', class extends HTMLElement {
  connectedCallback() {
    init(this);
  }
});
const card = () => html`<header><slot name="h">FH</slot></header><main><slot>FD</slot></main>`;
const host = () => {
  const element = doc.createElement('sync-host');
  element.innerHTML = '<b slot="h">B</b>';
  doc.body.append(element);
  renderInto(card(), element);
  return element;
};
const directChild = () => {
  const child = doc.createElement('u');
  child.setAttribute('slot', 'h');
  child.textContent = 'U';
  return child;
};

test('a render whose template feeds a light host distributes it by that render\'s end: a plain DOM read in the same task sees it', () => {
  const page = doc.createElement('div');
  doc.body.append(page);
  const draw = (name) => html`<sync-host><b slot=${name}>B</b></sync-host>`;
  renderInto(draw('h'), page);
  const inner = page.querySelector('sync-host');
  renderInto(card(), inner);
  const b = inner.querySelector('b');
  assert.equal(b.parentNode.localName, 'header', 'CONTROL: distributed into the named slot');
  renderInto(draw(''), page);
  assert.equal(b.parentNode.localName, 'main', 'the OUTER render re-slotted it, and the same task already reads it in its new slot');
  renderInto(draw('h'), page);
  assert.equal(b.parentNode.localName, 'header', 'and back');
  page.remove();
});

test('a light host changed directly, then read through the slots API in the same task: current at once', () => {
  const b = host();
  const u = directChild();
  b.append(u);
  assert.deepEqual(slotted(b, 'h').map((node) => node.textContent), ['B', 'U'], 'the read takes its records first');
  assert.equal(u.parentNode.localName, 'header', 'and the DOM is distributed by that read');
  b.remove();
});

test('a light host changed directly, then read through its slot\'s assignedNodes() in the same task: current at once', () => {
  let slot;
  const b = doc.createElement('sync-host');
  b.innerHTML = '<b slot="h">B</b>';
  doc.body.append(b);
  renderInto(html`<header><slot name="h" &ref=${(node) => (slot = node)}>FH</slot></header>`, b);
  const u = directChild();
  b.append(u);
  assert.deepEqual(slot.assignedNodes().map((node) => node.textContent), ['B', 'U'], 'the read takes its light\'s records first');
  b.remove();
});

test('a light host changed directly, with no render after it: distributed by the microtask (as before)', async () => {
  const b = host();
  await settle();
  const u = directChild();
  b.append(u);
  assert.equal(u.parentNode, b, 'the same task still has it where the page put it — unchanged from the shared observer');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(u.parentNode.localName, 'header', 'the microtask distributed it');
  b.remove();
});

test('THE DOCUMENTED DIFFERENCE — changed directly, then an UNRELATED host renders: the changed host catches up at the microtask', async () => {
  const b = host();
  const a = host();
  await settle();
  const u = directChild();
  b.append(u);
  renderInto(card(), a);
  assert.equal(u.parentNode, b, 'the unrelated render did not take its records (the shared observer did, synchronously)');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(u.parentNode.localName, 'header', 'the microtask distributed it');
  b.remove();
  a.remove();
});

test('a node re-slotted inside a hold()-PARKED slot region is re-routed while parked — and the parked slot does not take it back', async () => {
  const h = doc.createElement('sync-host');
  h.innerHTML = '<b slot="a">B</b><i slot="a">I</i>';
  doc.body.append(h);
  const draw = (open) => html`<section>${hold(open ? html`<p><slot name="a">FA</slot></p>` : html`<span>closed</span>`)}</section><footer><slot name="z">FZ</slot></footer>`;
  renderInto(draw(true), h);
  await settle();
  const b = h.querySelector('b');
  assert.equal(b.parentNode.localName, 'p', 'CONTROL: in the slot that will park');
  renderInto(draw(false), h);
  await settle();
  assert.equal(b.isConnected, false, 'CONTROL: parked with its region');
  b.setAttribute('slot', 'z');
  assert.deepEqual(slotted(h, 'z').map((node) => node.textContent), ['B'], 'the same task reads it in its new slot');
  /** `slotted` answers from names while a slot shows its fallback — so the DOM is what proves the flush took the parked record. */
  assert.equal(b.parentNode.localName, 'footer', 'and that read distributed it: the parked branch is watched, synchronously');
  renderInto(draw(true), h);
  await settle();
  assert.equal(b.parentNode.localName, 'footer', 'restoring the branch does not bring it back');
  assert.equal(h.querySelector('p').textContent, 'I', 'the restored slot keeps what is still its own');
  h.remove();
});
