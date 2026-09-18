/**
 * `props()` — a bag of property bindings, one call in both surfaces.
 *
 * The template form and the JSX form are asserted against the SAME call path on purpose:
 * `{...props({…})}` compiles to `spread(props({…}))`, so the idempotence case here is not a
 * convenience test — without it the branded result would be iterated as a bag and the element
 * would grow attributes named `_props`, `_$apply$` and `_$attrs$`, silently, and only where the
 * outer `spread()` came from a different bundle than the inner one.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
                 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent',
                 'requestAnimationFrame', 'cancelAnimationFrame', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];

const { html, wire } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { spread, props } = await load('renderer/spread');
wire([renderer]);

test('props() delivers non-string values as properties, intact and by identity', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const events = [{ id: 1 }, { id: 2 }];
  const date = new Date('2026-09-17');
  renderInto(html`<x-a ${spread(props({ events, date }))}></x-a>`, host);
  const el = host.querySelector('x-a');
  assert.equal(el.events, events, 'the array arrives by identity, not serialized');
  assert.equal(el.date, date, 'the Date arrives by identity');
  assert.equal(el.getAttribute('events'), null, 'and nothing leaked into an attribute');
});

test('the update path re-binds through one draw()', () => {
  const host = document.createElement('div');
  document.body.append(host);
  /** One call site — two template literals would be two templates and a rebuild, not an update. */
  const draw = (items) => renderInto(html`<x-b ${spread(props({ items }))}></x-b>`, host);
  const first = [1];
  const second = [1, 2, 3];
  draw(first);
  const el = host.querySelector('x-b');
  assert.equal(el.items, first);
  draw(second);
  assert.equal(host.querySelector('x-b'), el, 'updated in place — same element');
  assert.equal(el.items, second, 'the property moved with the draw');
});

test('spread() is idempotent on its own brand — the JSX compilation shape', () => {
  const branded = props({ n: 1 });
  assert.equal(spread(branded), branded, 'a branded result passes through by identity');

  /** And the double-wrapped call renders identically to the single call. */
  const host = document.createElement('div');
  document.body.append(host);
  const value = { deep: true };
  renderInto(html`<x-c ${spread(spread(props({ value })))}></x-c>`, host);
  const el = host.querySelector('x-c');
  assert.equal(el.value, value);
  assert.equal(el.getAttribute('_props'), null, 'the brand itself never becomes attributes');
  assert.equal(el.hasAttribute('_$apply$'), false);
});

test('props() coexists with ordinary attributes and other bindings on the same element', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const model = { rows: [] };
  renderInto(html`<x-d class="wide" data-id="7" ${spread(props({ model }))}></x-d>`, host);
  const el = host.querySelector('x-d');
  assert.equal(el.getAttribute('class'), 'wide');
  assert.equal(el.getAttribute('data-id'), '7');
  assert.equal(el.model, model);
});

test('a null-prototype bag is a legal bag', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const bag = Object.create(null);
  bag.count = 42;
  renderInto(html`<x-e ${spread(props(bag))}></x-e>`, host);
  assert.equal(host.querySelector('x-e').count, 42);
});
