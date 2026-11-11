/**
 * **`define`'s author inputs skip an own `__proto__` key** (2026-11-10): `JSON.parse` makes one (an object literal
 * never does), and assigned onto the props record or the class prototype it would replace a prototype instead of adding
 * a prop or a method. Skipped in both builds; development says so once per input (`define-proto-key`). CONTROL: the
 * other keys of the same inputs work.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];

const { define, html, wire, flush } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);

test('an own `__proto__` in props and in methods is skipped; the other keys work; development says it once each', async () => {
  const said = [];
  const error = console.error;
  console.error = (line) => said.push(String(line));
  let Class;
  try {
    const methods = { greet() { return `hi ${this.name}`; } };
    Object.defineProperty(methods, '__proto__', { value: { evil() { return 'pwned'; } }, enumerable: true, configurable: true, writable: true });
    Class = define({ tag: 'proto-define', props: JSON.parse('{"__proto__": {"polluted": 1}, "name": "ana"}'), methods }, (host) => () => html`<p>${host.name}</p>`);
  } finally {
    console.error = error;
  }
  const el = document.createElement('proto-define');
  document.body.append(el);
  await flush();
  assert.equal(Object.getPrototypeOf(Class.prototype), HTMLElement.prototype, 'the class prototype is not re-parented');
  assert.equal(typeof el.evil, 'undefined', 'nothing inherited through methods.__proto__');
  assert.equal(el.polluted, undefined, 'nothing inherited through props.__proto__');
  assert.equal(el.name, 'ana', 'CONTROL: the other prop works');
  assert.equal(el.greet(), 'hi ana', 'CONTROL: the other method works');
  assert.equal(said.filter((line) => line.includes('define-proto-key')).length, isProduction ? 0 : 2, 'development says it for props and for methods');
  el.remove();
});
