/**
 * **A JSX prop named like an `Object.prototype` member compiles to its own name** (2026-11-10). The transform
 * renamed props through a plain-object table, so `__proto__` became an attribute literally named `[object Object]` and
 * `constructor` / `toString` would have become a function's source text. Now only the table's OWN keys rename
 * (`className` → `class`, the CONTROL). And JSX, the fourth entry point of the props `__proto__` guard: a
 * `__proto__` prop compiled and rendered reaches the renderer's refusal, so the element's prototype is kept.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];

const { transformJsx } = await load('jsx');
const { html, wire, flush } = await load('core');
const { renderer, renderInto } = await load('renderer');
wire([renderer]);

test('prototype-named props keep their names; only the table\'s own keys rename', () => {
  const out = transformJsx('export const v = (x) => <x-a __proto__={x} constructor={x} toString={x} className="c" />;', 'p.jsx', { inject: false });
  assert.ok(!out.includes('[object Object]') && !out.includes('function'), 'no built-in leaked in as a name');
  for (const name of ['__proto__', 'constructor', 'toString']) assert.ok(out.includes(`.${name}=`), `${name} is a prop binding of its own name`);
  assert.ok(out.includes('class="c"'), 'CONTROL: className still renames');
});

test('JSX pin: a compiled `__proto__` prop is refused by the renderer; the prototype is kept', async () => {
  const compiled = transformJsx('export const v = (x) => <x-b __proto__={x} />;', 'p.jsx', { inject: false });
  const view = new Function('html', compiled.replace('export const v = ', 'return '))(html);
  const host = document.createElement('div');
  const warn = console.warn;
  console.warn = () => {};
  try {
    renderInto(view({ polluted: 1 }), host);
    await flush();
  } finally {
    console.warn = warn;
  }
  const el = host.querySelector('x-b');
  assert.equal(Object.getPrototypeOf(el), HTMLElement.prototype);
  assert.equal(el.polluted, undefined);
});
