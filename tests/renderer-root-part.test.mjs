/**
 * **A root's part lives ON the root, under each renderer copy's own Symbol** (2026-10-17). The part moved off a WeakMap
 * keyed by DOM nodes (it cost both engines' collectors per component). A page can hold two renderer COPIES — a CDN
 * bundle beside an app's, or two versions — and a string-named field would be shared by both: the second copy rendering
 * into a container the first rendered into would take the first's part and draw through it, replacing its content.
 * With a per-copy Symbol each copy sees only its own part, exactly as the WeakMap did: both renders stand side by side.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key] ?? globalThis[key];

const { html } = await load('core');
const one = await load('renderer');
/** A second, independent copy of the renderer module — what a second bundle on the page is. */
const two = await load('renderer', '?second-copy');

test('CONTROL: the second import is a second copy', () => {
  assert.notEqual(one.renderInto, two.renderInto);
});

test('two renderer copies drawing into ONE container each keep their own part — neither takes the other\'s', () => {
  const box = document.createElement('div');
  document.body.append(box);
  const a = (n) => html`<p class="a">${n}</p>`;
  const b = (n) => html`<p class="b">${n}</p>`;
  one.renderInto(a(1), box);
  two.renderInto(b(1), box);
  assert.deepEqual([...box.querySelectorAll('p')].map((p) => p.className + p.textContent), ['a1', 'b1'], box.innerHTML);
  one.renderInto(a(2), box);
  two.renderInto(b(2), box);
  assert.deepEqual([...box.querySelectorAll('p')].map((p) => p.className + p.textContent), ['a2', 'b2'], 'each re-renders only its own');
  box.remove();
});

/**
 * Core and the renderer version independently, so a renderer may run with a core that never calls `$y` (the revive at a
 * re-init). A released OWNED root then reaches `renderInto` still released — its part let go of its root at the release —
 * and must render fresh there. Driven directly: core's own render hook is exactly `renderInto(result, root, true)`.
 */
test("a released owned root rendered without core's revive (an older core) still renders fresh", async () => {
  const { init, wire, flush, inserts } = await load('core');
  wire([one.renderer]);
  customElements.define('rp-old-core', class extends HTMLElement { connectedCallback() { init({ host: this, shadow: 'open' }, () => () => html`<p>v1</p>`); } });
  const el = document.createElement('rp-old-core');
  document.body.append(el);
  flush();
  const root = el.shadowRoot;
  assert.equal(root.textContent, 'v1', 'CONTROL: rendered');
  assert.equal([...root.childNodes].some((n) => n.nodeType === 8), false, 'CONTROL: owned (no markers)');
  const revive = inserts.$y;
  delete inserts.$y;
  try {
    el.remove();
    flush();
    one.renderInto(html`<p>v2</p>`, root, true);
    assert.equal(root.querySelectorAll('p').length, 1, root.innerHTML);
    assert.equal(root.textContent, 'v2');
  } finally {
    inserts.$y = revive;
  }
});
