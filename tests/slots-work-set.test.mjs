/**
 * **Slots visits only the lights that need work — and holds nothing it no longer needs** (the work set, 2026-10-07).
 *
 * `flush` used to walk a set of EVERY light host ever captured, and nothing but a shadow host's release ever left it:
 * each removed host stayed reachable for good (`.probe/leak` in vera-hydra: 30/30 removed hosts alive with slots wired,
 * 0/30 without), and every flush walked them all — hydrating 2000 light hosts slowed 72 → 365 ms over ten renders that
 * replaced them. Now a light is in the work set only while it is dirty, or fresh until its first render ends, and never
 * while it waits for its own slots.
 *
 * Retention is pinned STRUCTURALLY, with no gc: development exposes the work set's size (`_$slotsWork$`), which must
 * return to 0 once every rendered host is distributed — removed or not. The leaving rule drops a clean light whose host
 * is disconnected even while still fresh (a first render that threw), so every way BACK in is pinned here too (vera-5a's
 * conditions): a host removed before its first render ends and re-inserted (its own render's end re-adds it), a host
 * inside a `hold()`-parked subtree (restored with no render of its own), and a parked host changed while parked.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver', 'Comment', 'Text'])
  globalThis[key] = dom.window[key];

const { wire, html, init } = await load('core');
const { renderer, renderInto, hold } = await load('renderer');
const { slots, slotted } = await load('renderer/slots');
let registry;
wire([renderer, slots, (given) => (registry = given)]);
const doc = dom.window.document;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
customElements.define('work-host', class extends HTMLElement {
  connectedCallback() {
    init(this);
  }
});
const host = (innerHTML = '') => {
  const element = doc.createElement('work-host');
  element.innerHTML = innerHTML;
  doc.body.append(element);
  return element;
};
const card = () => html`<header><slot name="h">FH</slot></header><main><slot>FD</slot></main>`;
const shows = (h) => [slotted(h, 'h').map((n) => n.textContent).join(''), slotted(h).map((n) => n.textContent).join('')];
const pending = () => registry._$slotsWork$();
const dev = { skip: isProduction && 'the work-set count is development-only' };

test('production carries no trace of the work-set count', { skip: !isProduction && 'production only' }, () => {
  assert.equal(registry._$slotsWork$, undefined);
});

test('N hosts captured, rendered, then removed: the work set returns to 0 at every stage', dev, async () => {
  const hosts = Array.from({ length: 50 }, (_, i) => host(`<b slot="h">H${i}</b>body${i}`));
  assert.equal(pending(), 50, 'CONTROL: each captured host waits for work — the count measures something');
  for (const h of hosts) renderInto(card(), h);
  await settle();
  assert.equal(pending(), 0, 'every host distributed: none held');
  assert.deepEqual(shows(hosts[7]), ['H7', 'body7'], 'CONTROL: distributed for real');
  for (const h of hosts) h.remove();
  await settle();
  renderInto(card(), host('<b slot="h">X</b>'));
  await settle();
  assert.equal(pending(), 0, 'removed hosts hold nothing, and a later render visits none of them');
  doc.body.replaceChildren();
});

test('a host whose first render THROWS is dropped once removed — and distributes when re-added and rendered', dev, async () => {
  const h = host('<b slot="h">H</b>body');
  assert.equal(pending(), 1, 'CONTROL: captured, waiting');
  const boom = { toString() { throw new Error('boom'); } };
  assert.throws(() => renderInto(html`<main><slot>FD</slot></main><p>${boom}</p>`, h), /boom/);
  h.remove();
  renderInto(card(), host('<i slot="h">other</i>'));
  await settle();
  assert.equal(pending(), 0, 'the thrown host, removed, is not held');
  doc.body.append(h);
  renderInto(card(), h);
  await settle();
  assert.deepEqual(shows(h), ['H', 'body'], 'back through its own render\'s end: distributed as any host');
  assert.equal(pending(), 0);
  doc.body.replaceChildren();
});

test('a host removed before its first render ends, flushed while detached, then re-inserted: distributed as an always-connected one', async () => {
  /** `<s slot="nowhere">`: no slot takes it, so its render's END parks it in holding — which needs `fresh` cleared there. */
  const control = host('<b slot="h">H</b>body<s slot="nowhere">S</s>');
  const h = host('<b slot="h">H</b>body<s slot="nowhere">S</s>');
  h.remove();
  /**
   * A flush that is NOT a render's end (a read of the assignment) while `h` is detached and fresh: it is distributed as
   * captured, stays fresh, and — disconnected and clean — leaves the work set. (A render's end would instead distribute
   * every fresh light and clear it, as it always has: that path drops nothing.)
   */
  slotted(control);
  if (!isProduction) assert.equal(pending(), 1, 'only the connected, never-rendered control still waits');
  doc.body.append(h);
  renderInto(card(), h);
  renderInto(card(), control);
  await settle();
  assert.deepEqual(shows(h), shows(control), 'the same as a host that never left');
  assert.deepEqual(shows(h), ['H', 'body'], 'CONTROL: and that is the content');
  assert.equal(h.innerHTML, control.innerHTML, 'the same DOM: what no slot takes is parked, as on the control');
  assert.equal(control.querySelector('s').parentNode.hasAttribute('data-vm-unassigned'), true, 'CONTROL: parked there');
  doc.body.replaceChildren();
});

test('a light host inside a hold()-parked subtree: restored with its content, no render of its own', async () => {
  const outer = doc.createElement('div');
  doc.body.append(outer);
  const draw = (open) => html`<section>${hold(open ? html`<work-host><b slot="h">H</b>body</work-host>` : html`<span>closed</span>`)}</section>`;
  renderInto(draw(true), outer);
  const inner = outer.querySelector('work-host');
  renderInto(card(), inner);
  await settle();
  assert.deepEqual(shows(inner), ['H', 'body'], 'CONTROL: distributed before parking');
  renderInto(draw(false), outer);
  await settle();
  assert.equal(inner.isConnected, false, 'CONTROL: parked out of the document');
  renderInto(draw(true), outer);
  await settle();
  assert.equal(outer.querySelector('work-host'), inner, 'the same host returned');
  assert.deepEqual(shows(inner), ['H', 'body'], 'its slots show its content again');
  assert.equal(inner.querySelector('header').textContent, 'H', 'and the DOM shows it');
  if (!isProduction) assert.equal(pending(), 0);
  outer.remove();
});

test('a parked host CHANGED while parked: the change is distributed, and shows on restore', async () => {
  const outer = doc.createElement('div');
  doc.body.append(outer);
  const draw = (open) => html`<section>${hold(open ? html`<work-host><b slot="h">H</b>body</work-host>` : html`<span>closed</span>`)}</section>`;
  renderInto(draw(true), outer);
  const inner = outer.querySelector('work-host');
  renderInto(card(), inner);
  await settle();
  renderInto(draw(false), outer);
  await settle();
  const late = doc.createElement('u');
  late.setAttribute('slot', 'h');
  late.textContent = 'U';
  inner.append(late);
  await settle();
  renderInto(draw(true), outer);
  await settle();
  assert.deepEqual(shows(inner), ['HU', 'body'], 'the child appended while parked is slotted');
  if (!isProduction) assert.equal(pending(), 0, 'and nothing is held afterwards');
  outer.remove();
});
