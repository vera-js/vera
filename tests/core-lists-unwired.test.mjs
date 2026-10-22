/**
 * **Development names a store array's `.map` of TEMPLATES in a render when no list module is wired** (2026-10-22,
 * `lists-unwired`): rows are then matched by position. Once per page, and only when the first result is a template — the
 * decision automatic lists make — so it fires exactly when wiring `lists` would change the behavior. This page never
 * wires `lists`; the rows run IN ORDER (the warning is once per page): the silent cases first, then the one that warns,
 * then more that must not warn again. The wired control (zero) is in renderer-automap, which wires it. Production carries
 * neither the check nor the words, and renders the same.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { define, html, wire, createStore, flush } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);
const settle = async () => { flush(); await new Promise((r) => setTimeout(r, 0)); flush(); };
const warnings = [];
const warn = console.warn;
console.warn = (...args) => { const line = args.join(' '); if (line.includes('lists-unwired')) warnings.push(line); else warn(...args); };
test.after(() => { console.warn = warn; });
let seq = 0;
const show = async (render) => {
  const tag = `x-lu-${++seq}`;
  define(tag, () => render);
  const el = document.createElement(tag);
  document.body.append(el);
  await settle();
  return el;
};

test('silent: a store array mapped to STRINGS (a .join), an EMPTY store array, a PLAIN array, and a plain COPY of a store array (position on purpose)', async () => {
  const s = createStore({ tags: [{ name: 'a' }, { name: 'b' }], none: [], rows: [{ id: 7 }] });
  const plain = [1, 2];
  const el = await show(() => html`<p>${s.tags.map((t) => t.name).join(', ')}</p>${s.none.map((x) => html`<i>${x}</i>`)}${plain.map((n) => html`<b>${n}</b>`)}${[...s.rows].map((r) => html`<u>${r.id}</u>`)}`);
  assert.equal(el.querySelector('p').textContent, 'a, b', 'CONTROL: it rendered');
  assert.equal(el.querySelectorAll('b').length, 2, 'CONTROL: the plain array rendered');
  assert.equal(el.querySelector('u').textContent, '7', 'CONTROL: the copy rendered');
  assert.equal(warnings.length, 0);
  el.remove();
});

test('a store array mapped to TEMPLATES in a render warns once — across two maps and three renders', { skip: isProduction && 'development only' }, async () => {
  const s = createStore({ rows: [{ id: 1 }, { id: 2 }], other: [{ id: 3 }], tick: 0 });
  const el = await show(() => html`<ul>${s.rows.map((r) => html`<li>${r.id}</li>`)}</ul><ol>${s.other.map((r) => html`<li>${r.id}</li>`)}</ol><i>${s.tick}</i>`);
  s.tick++;
  await settle();
  s.tick++;
  await settle();
  assert.equal(el.querySelectorAll('li').length, 3, 'CONTROL: the rows rendered');
  assert.equal(warnings.length, 1, 'once per page');
  assert.match(warnings[0], /^\[vera\]/);
  assert.match(warnings[0], /wire\(\[renderer, lists\]\)/, 'it names the fix');
  el.remove();
});

test('production: the same page renders, and says nothing', { skip: !isProduction && 'production only' }, async () => {
  const s = createStore({ rows: [{ id: 1 }, { id: 2 }] });
  const el = await show(() => html`<ul>${s.rows.map((r) => html`<li>${r.id}</li>`)}</ul>`);
  assert.equal(el.querySelectorAll('li').length, 2);
  assert.equal(warnings.length, 0);
  el.remove();
});
