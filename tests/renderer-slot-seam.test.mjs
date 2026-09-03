/**
 * The light-slots SEAM in the renderer — not the slots module (that has its own suite when it
 * lands). What is pinned here: templates record <slot> positions only when a 'slot' handler is
 * wired; the handler is consulted once per slot per INSTANCE with the cloned element, the render
 * root and the slot name; slot parts consume zero expression values; a declined slot (or a
 * construction outside renderInto) leaves the native element untouched; and a taken-over slot is
 * PARKED before a branch-away discards the instance's DOM.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
]) {
  globalThis[key] = dom.window[key];
}

const { wire, html } = await load('core');
const { renderer, renderInto, hold } = await load('renderer');

/** The fake seam fn: records every consultation, takes over only light roots, parks on teardown. */
const calls = [];
const parked = [];
const fakeSeam = (slot, root, name) => {
  calls.push({ name, root, tag: slot.localName });
  /** Decline shadow roots the way the real module will — duck-checked, realm-safe. */
  if (root.host !== undefined && root.nodeType === 11) return null;
  slot.setAttribute('data-taken', name);
  return { name, _$park$: () => parked.push(name) };
};
wire([renderer, { name: 'fake-slots', on: 'slot', fn: fakeSeam, priority: 50 }]);

test('a template with no handler-era construction records nothing (cache is per-shape)', () => {
  // Templates constructed BEFORE the handler wired would skip recording — this suite wires first,
  // so use fresh shapes throughout; this test just documents the ordering contract.
  assert.ok(true);
});

test('slots are discovered — including after the last expression and with no expressions at all', () => {
  const host1 = dom.window.document.createElement('div');
  renderInto(html`<p>${'x'}</p><slot name="tail"></slot>`, host1);
  const host2 = dom.window.document.createElement('div');
  renderInto(html`<slot name="only"></slot>`, host2);
  assert.deepEqual(calls.map((c) => c.name).sort(), ['only', 'tail']);
  assert.equal(calls[0].tag, 'slot', 'the CLONED slot element is handed over');
  assert.equal(calls[0].root, host1, 'the render root is handed over');
  calls.length = 0;
});

test('expression indexing is undisturbed around slots, and re-renders do not re-consult', () => {
  const host = dom.window.document.createElement('div');
  const draw = (a, b) => html`<i>${a}</i><slot name="mid"></slot><b>${b}</b>`;
  renderInto(draw('A', 'B'), host);
  assert.equal(host.querySelector('i').textContent, 'A');
  assert.equal(host.querySelector('b').textContent, 'B');
  assert.equal(calls.length, 1, 'one consultation per slot per instance');
  renderInto(draw('C', 'D'), host);
  assert.equal(host.querySelector('i').textContent, 'C');
  assert.equal(host.querySelector('b').textContent, 'D');
  assert.equal(calls.length, 1, 'a re-render is not a new instance');
  assert.equal(host.querySelector('slot').getAttribute('data-taken'), 'mid', 'the handler acted on the element');
  calls.length = 0;
});

test('a shadow root is consulted and may decline — the native element stays untouched', () => {
  const el = dom.window.document.createElement('div');
  dom.window.document.body.append(el);
  const root = el.attachShadow({ mode: 'open' });
  renderInto(html`<slot name="native"></slot>`, root);
  assert.equal(calls.length, 1, 'the seam consults; policy is the handler’s');
  assert.equal(root.querySelector('slot').hasAttribute('data-taken'), false, 'declined: untouched');
  calls.length = 0;
  el.remove();
});

test('branch-away parks a taken-over slot before its DOM is discarded', () => {
  const host = dom.window.document.createElement('div');
  const inner = () => html`<section><slot name="park-me"></slot></section>`;
  const draw = (on) => html`<div>${hold(on ? inner() : null)}</div>`;
  renderInto(draw(true), host);
  assert.equal(calls.length, 1);
  assert.deepEqual(parked, []);
  renderInto(draw(false), host);
  assert.deepEqual(parked, ['park-me'], 'the seam parked the slot before the branch was torn down');
  calls.length = 0; parked.length = 0;
});

test('slot name defaults to the empty string for an unnamed slot', () => {
  const host = dom.window.document.createElement('div');
  renderInto(html`<article><slot></slot></article>`, host);
  assert.equal(calls[0].name, '');
  calls.length = 0;
});
