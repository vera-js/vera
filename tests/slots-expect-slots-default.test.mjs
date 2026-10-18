/**
 * **`slots({ expectSlots: true })`** — the app's default (2026-10-17): every light component expects slots unless its own
 * `expectSlots` says otherwise, and `slots` stays usable bare. `wire` hands a connector itself, so the called form wires
 * slots' parts from its connector — nothing is inferred from a return value. In its own process: wire is global.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'MutationObserver', 'ShadowRoot', 'CSSStyleSheet', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { init, html, wire, flush } = await load('core');
const { renderer } = await load('renderer');
const { slots } = await load('renderer/slots');

const warnings = [];
const saved = console.warn;
console.warn = (...a) => warnings.push(a.join(' '));
try {
  wire([renderer, slots({ expectSlots: true, nope: 1 })]);
} finally {
  console.warn = saved;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

customElements.define('ed-default', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<main></main>`); }
});
customElements.define('ed-own-off', class extends HTMLElement {
  connectedCallback() { init({ host: this, expectSlots: false }, () => () => html`<main></main>`); }
});

const appendAfterRender = async (tag) => {
  const el = document.createElement(tag);
  document.body.append(el);
  flush();
  await settle();
  const child = document.createElement('b');
  el.append(child);
  flush();
  await settle();
  const hidden = child.parentNode !== el;
  el.remove();
  return hidden;
};

test('the app default applies: a component with no option expects slots (a hand-appended child is hidden)', async () => {
  assert.equal(await appendAfterRender('ed-default'), true);
});

test("a component's own expectSlots: false wins over the app default (the child shows until a slot renders)", async () => {
  assert.equal(await appendAfterRender('ed-own-off'), false);
});

test('an option slots() does not have is reported, in development', { skip: isProduction }, () => {
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.ok(warnings[0].startsWith('[vera]') && /`nope` is not an option/.test(warnings[0]), warnings[0]);
});
