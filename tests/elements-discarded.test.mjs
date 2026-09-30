/**
 * **An instance discarded before its render finishes never mounts.** Mounting waits for the end of the render, so an
 * instance created and torn down inside one render — an applier replacing what it just committed — must not have its
 * claims mounted afterwards on elements that are no longer in the page.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[key] = dom.window[key];
const core = await load('core');
const { renderer, renderInto } = await load('renderer');
const { elements } = await load('renderer/elements');
const mounted = [];
const track = { mount: (element) => { mounted.push(element.id); } };
core.wire([renderer, elements, { on: 'element', fn: (el) => (el.hasAttribute('data-track') ? track : undefined), priority: 50 }]);
const { html } = core;

test('an instance created and replaced inside one render is never mounted; its replacement is', () => {
  const first = () => html`<p data-track id="gone"></p>`;
  const second = () => html`<p data-track id="kept"></p><!-- another template -->`;
  const swap = { _$child$(part) { part._$commit$(first()); part._$commit$(second()); } };
  const host = document.body.appendChild(document.createElement('div'));
  renderInto(html`<div>${swap}</div>`, host);
  assert.equal(host.querySelector('#kept') !== null, true, 'CONTROL: the replacement rendered');
  assert.deepEqual(mounted, ['kept']);
});
