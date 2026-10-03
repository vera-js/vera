/**
 * **A renderer and a hydration from different releases: the page still works, rendered fresh — with a warning.**
 * (Brian, 2026-10-02: "a mismatch still working but with the full client render".) The hand-off's protocol number is
 * forced apart here; `$V` and `$Y` are the frozen pair hydration may still use, to clear the server's markup so it does
 * not stand beside the client's. Its own process: hydration is wired against a forged protocol.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[key] = dom.window[key];

test('a protocol mismatch renders fresh, warns once, and leaves no server markup standing', async () => {
  const { wire, inserts } = await load('inserts');
  const { renderer, renderInto } = await load('renderer');
  const { hydration } = await load('renderer/hydration');
  const { html } = await load('core');
  wire([renderer]);
  /** Position 0 is the protocol number (`HANDOFF_PROTOCOL`), frozen across protocols. */
  inserts.$H[0] = 999;
  const said = [];
  const real = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    wire([hydration]);
    const container = document.createElement('div');
    container.innerHTML = '<p>server</p>';
    document.body.append(container);
    const serverP = container.querySelector('p');
    renderInto(html`<p>${'client'}</p>`, container);
    assert.equal(said.length, 1, `one warning: ${said}`);
    assert.match(said[0], /^\[vera\] hydration: this @verajs\/renderer speaks hand-off protocol 999/);
    assert.equal(container.querySelectorAll('p').length, 1, 'the server markup does not stand beside the client render');
    assert.notEqual(container.querySelector('p'), serverP, 'rendered fresh, not adopted');
    assert.equal(container.textContent, 'client');
  } finally {
    console.warn = real;
  }
});
