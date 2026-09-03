/**
 * **The two ways to get light-DOM slot wiring wrong, both of which were silent.**
 *
 * A `<slot>` in a LIGHT render needs `@verajs/renderer/slots` wired, and wired BEFORE anything
 * renders. Miss either and the picture is identical and baffling: the slot shows its fallback while
 * the host's own children sit beside the component as stray markup, with nothing said.
 *
 * 1. Never wired at all.
 * 2. Wired AFTER a template first rendered. Templates are interned per call site for the life of the
 *    page and resolve the seam once, at construction — so that template stays slotless forever, and
 *    a component that rendered early keeps failing while an identical one written elsewhere works.
 *
 * This file owns the wiring ORDER, which is why it cannot live beside the other slot suites: they
 * wire at module scope, and the whole subject here is what happens when you do not.
 *
 * Development-only; production carries neither the check nor the message.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
  'MutationObserver', 'Comment', 'Text',
]) {
  globalThis[key] = dom.window[key];
}

const { wire, html } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { slots } = await load('renderer/slots');
const doc = dom.window.document;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Deliberately the renderer ALONE, to begin with. */
wire([renderer]);

/** The tag matters: the diagnostic is deduped per host tag, so each case needs its own. */
const host = (markup, tag = 'div') => {
  const element = doc.createElement(tag);
  element.innerHTML = markup;
  doc.body.append(element);
  return element;
};
const capture = async (fn) => {
  const said = [];
  const original = console.warn;
  console.warn = (message) => said.push(String(message));
  try {
    fn();
    await settle();
  } finally {
    console.warn = original;
  }
  return said.filter((message) => message.includes("no 'slot' insert is wired"));
};

/** ONE draw function, used on both sides of the wiring — two literals would be two templates. */
const draw = () => html`<header><slot name="h">fallback</slot></header>`;

test('a light <slot> with slots unwired is diagnosed, not left silent', { skip: isProduction }, async () => {
  const element = host('<b slot="h">MINE</b>');
  const said = await capture(() => renderInto(draw(), element));

  assert.equal(element.querySelector('header').textContent, 'fallback', 'CONTROL: it really did not distribute');
  assert.equal(said.length, 1, `expected one diagnostic, got ${JSON.stringify(said)}`);
  assert.match(said[0], /^\[vera\] /, 'findable with one filter, like every diagnostic here');
  assert.match(said[0], /wire\(\[renderer, slots\]\)/, 'and it says exactly what to write');
  assert.match(said[0], /BEFORE anything renders/, 'including the ordering, which is the second trap');
  element.remove();
});

test('a SHADOW root is never diagnosed — the platform slots there', { skip: isProduction }, async () => {
  const element = host('<b slot="h">MINE</b>');
  const said = await capture(() => renderInto(html`<p><slot name="h">fb</slot></p>`, element.attachShadow({ mode: 'open' })));
  assert.deepEqual(said, [], 'a shadow root needs no insert and must not be warned about');
  element.remove();
});

test('a template that rendered BEFORE the wiring stays slotless — and says so', { skip: isProduction }, async () => {
  /** The template above already rendered once, unwired. Now wire slots. */
  wire([renderer, slots]);

  const stale = host('<b slot="h">LATE</b>', 'stale-host');
  const said = await capture(() => renderInto(draw(), stale));
  assert.equal(stale.querySelector('header').textContent, 'fallback',
    'the same template is still slotless, which is the documented consequence');
  assert.equal(said.length, 1, 'and it is diagnosed rather than left to be discovered');
  assert.match(said[0], /<stale-host>/, 'naming the host it happened in');

  /** A fresh call site, built after the wiring, works — which is what makes the stale one so odd. */
  const fresh = host('<b slot="h">FRESH</b>', 'fresh-host');
  const quiet = await capture(() => renderInto(html`<section><slot name="h">fb</slot></section>`, fresh));
  assert.equal(fresh.querySelector('section').textContent, 'FRESH', 'CONTROL: wiring did take effect');
  assert.deepEqual(quiet, [], 'and a template built after the wiring says nothing');
  stale.remove();
  fresh.remove();
});
