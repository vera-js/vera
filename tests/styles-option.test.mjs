/**
 * **`define`'s and `init`'s `styles` OPTION** (Brian 2026-10-21: both ways, the option wins): `define({ tag, styles })`,
 * `init({ host, styles })` and a class's `static styles`. Rows: option only, static only, both (the option wins), `null`
 * (none — never the static ones), a per-element `init` option, a subclass not inheriting a base's remembered option, a
 * frozen styles array, light DOM hoisted once per document, no unknown-option warning for `styles` (and still one for a
 * typo), and the `'adopted'` insert (the re-style after a move) choosing exactly what setup chose. jsdom has no constructable sheets, so
 * styles land as one `<style data-vm-sheet="styles">` per shadow root; its text is what the rows read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://x.test/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'ShadowRoot', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
const { define, init, html, wire, flush, inserts } = await load('core');
const { renderer } = await load('renderer');
const { styles } = await load('styles');
wire([renderer, styles]);
const settle = async () => { flush(); await new Promise((r) => setTimeout(r, 0)); flush(); };
/** The CSS a shadow root carries (jsdom: the `<style>` fallback). */
const cssOf = (el) => el.shadowRoot?.querySelector('style[data-vm-sheet="styles"]')?.textContent ?? '';
let seq = 0;
const tag = () => `x-sty-${++seq}`;
const mount = async (t) => { const el = document.createElement(t); document.body.append(el); await settle(); return el; };

/** Runs core's `'adopted'` chain on an element, as a move into another document does (CONTROL: styles is on it). */
const adopt = (element) => {
  const chain = inserts.get('adopted');
  assert.ok(chain?.length > 0, "CONTROL: the 'adopted' chain holds styles' re-style");
  for (const fn of chain) fn(element);
};

test('the option alone styles a define component', async () => {
  const t = tag();
  define({ tag: t, shadow: 'open', styles: 'b { color: red; }' }, () => () => html`<b>x</b>`);
  const el = await mount(t);
  assert.match(cssOf(el), /color: red/);
  el.remove();
});

test('static styles alone still work (a class)', async () => {
  const t = tag();
  customElements.define(t, class extends HTMLElement {
    static styles = 'i { color: blue; }';
    connectedCallback() { init({ host: this, shadow: 'open' }, () => () => html`<i>x</i>`); }
  });
  const el = await mount(t);
  assert.match(cssOf(el), /color: blue/);
  el.remove();
});

test('both given: the option wins', async () => {
  const t = tag();
  const Class = define({ tag: t, shadow: 'open', styles: 'b { color: green; }' }, () => () => html`<b>x</b>`);
  Class.styles = 'b { color: purple; }';
  const el = await mount(t);
  assert.match(cssOf(el), /color: green/);
  assert.doesNotMatch(cssOf(el), /purple/, 'the static styles were not applied');
  el.remove();
});

test('styles: null means NONE — the static styles are not used', async () => {
  const t = tag();
  const Class = define({ tag: t, shadow: 'open', styles: null }, () => () => html`<b>x</b>`);
  Class.styles = 'b { color: purple; }';
  const el = await mount(t);
  assert.equal(cssOf(el), '');
  assert.ok(el.shadowRoot.querySelector('b'), 'CONTROL: it rendered');
  el.remove();
});

test('init({ host, styles }) per element: two elements of one class keep their own, and re-style to their own', async () => {
  const t = tag();
  customElements.define(t, class extends HTMLElement {
    connectedCallback() { init({ host: this, shadow: 'open', styles: this.dataset.css }, () => () => html`<b>x</b>`); }
  });
  const a = document.createElement(t); a.dataset.css = 'b { color: red; }';
  const b = document.createElement(t); b.dataset.css = 'b { color: blue; }';
  document.body.append(a, b);
  await settle();
  assert.match(cssOf(a), /red/);
  assert.match(cssOf(b), /blue/);
  /** The `'adopted'` insert (what a move into another document runs) chooses what setup chose, per element. */
  for (const el of [a, b]) el.shadowRoot.querySelector('style[data-vm-sheet="styles"]').remove();
  adopt(a);
  adopt(b);
  assert.match(cssOf(a), /red/, 're-styled with its own');
  assert.match(cssOf(b), /blue/, 're-styled with its own');
  a.remove();
  b.remove();
});

test("a subclass does not inherit its base's remembered option", async () => {
  const base = tag();
  const child = tag();
  class Base extends HTMLElement {
    connectedCallback() { init({ host: this, shadow: 'open', styles: this.localName === base ? 'b { color: red; }' : undefined }, () => () => html`<b>x</b>`); }
  }
  class Child extends Base { static styles = 'b { color: teal; }'; }
  customElements.define(base, Base);
  customElements.define(child, Child);
  const b = await mount(base);
  const c = await mount(child);
  c.shadowRoot.querySelector('style[data-vm-sheet="styles"]')?.remove();
  adopt(c);
  assert.match(cssOf(c), /teal/, "the child's own static styles, not the base's option");
  b.remove();
  c.remove();
});

test('a FROZEN styles array is accepted', async () => {
  const t = tag();
  define({ tag: t, shadow: 'open', styles: Object.freeze(['b { color: red; }']) }, () => () => html`<b>x</b>`);
  const el = await mount(t);
  assert.match(cssOf(el), /color: red/);
  el.remove();
});

test('light DOM: an option-styled define tag is hoisted ONCE per document', async () => {
  const t = tag();
  define({ tag: t, styles: 'b { color: red; }' }, () => () => html`<b>x</b>`);
  const before = document.head.querySelectorAll('style').length + (document.adoptedStyleSheets?.length ?? 0);
  const els = [await mount(t), await mount(t), await mount(t)];
  const after = document.head.querySelectorAll('style').length + (document.adoptedStyleSheets?.length ?? 0);
  assert.equal(after - before, 1, 'three elements, one hoist');
  for (const el of els) el.remove();
});

test('development: `styles` is a known option, and a typo still warns', { skip: isProduction && 'the check is development-only' }, async () => {
  const warns = [];
  const warn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    const ok = tag();
    define({ tag: ok, shadow: 'open', styles: 'b {}' }, () => () => html`<b></b>`);
    (await mount(ok)).remove();
    assert.deepEqual(warns.filter((w) => w.includes('unknown-option')), [], 'styles is claimed');
    const typo = tag();
    define({ tag: typo, shadow: 'open', style: 'b {}' }, () => () => html`<b></b>`);
    (await mount(typo)).remove();
    assert.equal(warns.filter((w) => w.includes('unknown-option') && w.includes('style')).length, 1, 'a typo is still named');
  } finally {
    console.warn = warn;
  }
});
