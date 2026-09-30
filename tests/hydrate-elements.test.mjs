/**
 * **A claim on an element hydration adopted is told so** — `mount(element, { adopted: true })`, with the SERVER's
 * element, so a behavior can skip what the server already did (an animation in, a focus the page already has).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer, renderInto } = await load('renderer/hydrate');
const { elements } = await load('renderer/elements');
const log = [];
const track = { mount: (element, { adopted }) => log.push([element, adopted]) };
core.wire([renderer, elements, { on: 'element', fn: (el) => (el.hasAttribute('data-track') ? track : undefined), priority: 50 }]);
const { html } = core;

test('an adopted element mounts with adopted: true — the server node itself; a client render says false', () => {
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = '<p data-track id="s">x</p>';
  const server = host.querySelector('p');
  const draw = (id) => html`<p data-track id=${id}>x</p>`;
  renderInto(draw('s'), host);
  assert.equal(host.querySelector('p'), server, 'CONTROL: adopted');
  assert.deepEqual(log, [[server, true]]);
  const fresh = document.body.appendChild(document.createElement('div'));
  renderInto(draw('f'), fresh);
  assert.deepEqual(log.slice(1).map(([el, adopted]) => [el.id, adopted]), [['f', false]]);
});

/**
 * Claims are asked about a template's CANONICAL content as it is built — so a template whose first instance is one
 * hydration adopted (the server's element, bound values in it) is still asked about static attributes only.
 */
test("a claim is asked about the template, not its first instance — a hydrated one's bound values are invisible", () => {
  const seen = [];
  core.wire({ on: 'element', fn: (el) => { if (el.localName === 'em') seen.push(el.getAttribute('data-x')); }, priority: 60 });
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = '<em data-x="bound-value">x</em>';
  const quiet = console.warn;
  console.warn = () => {};
  try {
    renderInto(html`<em data-x=${'bound-value'}>x</em>`, host);
  } finally {
    console.warn = quiet;
  }
  assert.deepEqual(seen, [null], 'asked once, with no bound value');
});
