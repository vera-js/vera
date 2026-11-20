/**
 * **@vera-hooks/listbox: importing it changes nothing** (written by `scripts/new-package.mjs`): a hook registers no element and
 * says nothing at import. Its behavior suites join it in tests/ as the hook grows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

test('importing @vera-hooks/listbox registers nothing and says nothing', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
  for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver']) globalThis[key] = dom.window[key];
  const said = [];
  const { warn, error } = console;
  console.warn = console.error = (...args) => said.push(String(args[0]));
  const define = customElements.define;
  let defined = 0;
  customElements.define = (...args) => (defined++, define.apply(customElements, args));
  try {
    await load('vera-hooks/listbox');
  } finally {
    Object.assign(console, { warn, error });
    customElements.define = define;
  }
  assert.equal(defined, 0, 'no element is registered');
  assert.deepEqual(said, []);
});
