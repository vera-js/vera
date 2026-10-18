/**
 * **`slots({ observeSlots: 'eager' })`** — the app's default (2026-10-17): every light component is observed from its
 * first render unless its own `observeSlots` says otherwise, and `slots` stays usable bare. `wire` hands a connector itself, so the called form wires
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
  wire([renderer, slots({ observeSlots: 'eager', nope: 1 })]);
} finally {
  console.warn = saved;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

customElements.define('ed-default', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<main></main>`); }
});
customElements.define('ed-own-off', class extends HTMLElement {
  connectedCallback() { init({ host: this, observeSlots: 'lazy' }, () => () => html`<main></main>`); }
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

test('the app default applies: a component with no option is observed from its first render (a hand-appended child is hidden)', async () => {
  assert.equal(await appendAfterRender('ed-default'), true);
});

test("a component's own observeSlots: 'lazy' wins over the app default (the child shows until a slot renders)", async () => {
  assert.equal(await appendAfterRender('ed-own-off'), false);
});

test('an option slots() does not have is reported, in development', { skip: isProduction }, () => {
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.ok(warnings[0].startsWith('[vera]') && /`nope` is not an option/.test(warnings[0]), warnings[0]);
});

test('a wire that hands slots only the registry is refused out loud, in both builds — never a silent no-op', () => {
  assert.throws(() => slots(new Map()), /slots-wire-too-old/, 'bare, called the old way');
  assert.throws(() => slots({ observeSlots: 'eager' })(new Map()), /slots-wire-too-old/, 'called, its connector the old way');
});

test("a value observeSlots does not have reads as 'lazy' and says so, in development — the app default and a component's own", { skip: isProduction }, async () => {
  const said = [];
  const keep = console.warn;
  console.warn = (...a) => said.push(a.join(' '));
  try {
    slots({ observeSlots: 'eagre' });
    customElements.define('ed-own-bad', class extends HTMLElement {
      connectedCallback() { init({ host: this, observeSlots: true }, () => () => html`<main></main>`); }
    });
    const el = document.createElement('ed-own-bad');
    document.body.append(el);
    flush();
    await settle();
    el.remove();
  } finally {
    console.warn = keep;
  }
  assert.equal(said.length, 2, said.join('\n'));
  assert.ok(said[0].startsWith('[vera]') && /`observeSlots: 'eagre'` is not a setting/.test(said[0]), said.join('\n'));
  assert.ok(said[1].startsWith('[vera]') && /`observeSlots: true` is not a setting/.test(said[1]), said.join('\n'));
  assert.ok(said.every((w) => w.includes('observe-slots-option')), 'each line carries its code');
});

test("an invalid value of a component's own reads as the BUILT-IN 'lazy', even under an app default of 'eager' (as foreignNodes)", async () => {
  customElements.define('ed-own-invalid', class extends HTMLElement {
    connectedCallback() { init({ host: this, observeSlots: 'sometimes' }, () => () => html`<main></main>`); }
  });
  const keep = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await appendAfterRender('ed-own-invalid'), false, "lazy: the hand-appended child shows, as the default's 'eager' would hide it");
  } finally {
    console.warn = keep;
  }
});

