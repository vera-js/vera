/**
 * **The two ways to get light-DOM slot wiring wrong, both of which were silent.**
 *
 * A `<slot>` in a LIGHT render needs `@verajs/renderer/slots` wired, and wired BEFORE anything
 * renders. Miss either and the picture is identical and baffling: the slot shows its fallback while
 * any content the host was given for it sits beside the component as stray markup, with nothing
 * said. The conditional phrasing is load-bearing — a component that consumes its own children and
 * also declares slots (`@verajs/ui`'s select) warns with nothing stray on the page at all, and the
 * message must not send that reader hunting for markup that is not there.
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

const { wire, html, init } = await load('core');
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
  return said.filter((message) => message.includes('renders a `<slot>` into LIGHT DOM') || message.endsWith('(late-template-module)'));
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
  assert.match(said[0], /^\[vera\] renderer: <stale-host> — a 'template' or 'element' module \(namespaces, elements, slots\) was wired after the renderer had already built templates[\s\S]*\(late-template-module\)$/,
    'and naming the late wiring rather than claiming nothing is wired — slots IS wired here; the same code core says at wire time');

  /** A fresh call site, built after the wiring, works — which is what makes the stale one so odd. */
  const fresh = host('<b slot="h">FRESH</b>', 'fresh-host');
  const quiet = await capture(() => renderInto(html`<section><slot name="h">fb</slot></section>`, fresh));
  assert.equal(fresh.querySelector('section').textContent, 'FRESH', 'CONTROL: wiring did take effect');
  assert.deepEqual(quiet, [], 'and a template built after the wiring says nothing');
  stale.remove();
  fresh.remove();
});

/**
 * **`elements` wired on its own AND inside `slots` is one module, not a clash.** The slots bundle
 * carries its own copy of `elements` (it claims each `<slot>` through it), so an app that also wires
 * `elements` for its own claims — autofocus, say — registers two equivalent copies at one priority.
 * `wire` keys that on the module's NAME, so development stays quiet; two DIFFERENT modules at one
 * priority still warn, which the control below pins. And both kinds of claim keep working.
 */
test('elements wired beside slots stays quiet and both kinds of claim work', async () => {
  const { elements } = await load('renderer/elements');
  const said = [];
  const original = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  const mounted = [];
  try {
    wire([renderer, elements, slots, { on: 'element', fn: (el) => (el.hasAttribute('data-claim') ? { mount: (e) => mounted.push(e.localName) } : undefined), priority: 60 }]);
    /** A slot host is a custom element that calls `init` (ruling 4) — where its children are captured. */
    if (!customElements.get('wiring-host')) customElements.define('wiring-host', class extends HTMLElement { connectedCallback() { init(this); } });
    const host = doc.createElement('wiring-host');
    host.innerHTML = '<b>MINE</b>';
    doc.body.append(host);
    renderInto(html`<section><i data-claim></i><slot>fb</slot></section>`, host);
    await settle();
    assert.equal(host.querySelector('section').textContent, 'MINE', 'the slot still distributes');
    assert.deepEqual(mounted, ['i'], 'and the app\'s own claim still mounts');
    host.remove();
    if (!isProduction) {
      assert.deepEqual(said.filter((m) => m.includes('two things were wired')), [], 'no clash reported for the same module twice');
      wire({ name: 'someone-else', on: 'template', fn: () => {}, priority: 10 });
      assert.equal(said.filter((m) => m.includes('two things were wired')).length, 1, 'CONTROL: a different module at that priority still warns');
    }
  } finally {
    console.warn = original;
  }
});
