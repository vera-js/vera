/**
 * **A built-in element given to `init` with `@verajs/renderer/native-elements` NOT wired says so — once, in development**
 * (`built-in-host-unwired`, 2026-10-21): it has no lifecycle core can hear, so it is never released when
 * removed. A custom element (a hyphen in its name) never hears it. Its own file: the warning is said once per page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
const { init, html, wire } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);

test('init on a built-in element with native-elements unwired warns once, by name; a custom element never does', { skip: isProduction && 'development-only' }, () => {
  const warn = console.warn;
  const said = [];
  console.warn = (message) => said.push(String(message));
  try {
    customElements.define('x-unwired-probe', class extends HTMLElement {});
    const custom = document.createElement('x-unwired-probe');
    document.body.append(custom);
    init(custom, () => () => html`<b>c</b>`);
    assert.equal(said.length, 0, `CONTROL: a custom element hears nothing (${said.join(' | ')})`);
    for (let i = 0; i < 2; i++) {
      const plain = document.createElement('div');
      document.body.append(plain);
      init(plain, () => () => html`<b>p</b>`);
    }
  } finally {
    console.warn = warn;
  }
  assert.equal(said.filter((m) => m.includes('built-in-host-unwired')).length, 1, `warned once (${said.join(' | ')})`);
});
