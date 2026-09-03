/**
 * THE MONEY TEST — one <vera-select>, both modes. In light mode, with @verajs/renderer/slots
 * wired, a user's slotted trigger is captured, distributed, and wired with the SAME handlers and
 * ARIA as the built-in one — with ZERO changes to the component beyond its assignedElements()
 * reads becoming slotted() (which answers in either mode). This is the whole point of the light-
 * slots project: one component version, four corners.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window','document','HTMLElement','customElements','CSSStyleSheet','Node','Element','DocumentFragment','requestAnimationFrame','cancelAnimationFrame','Event','CustomEvent','KeyboardEvent','MouseEvent','FormData','MutationObserver','Comment','Text'])
  globalThis[key] = dom.window[key];

const { wire } = await load('core');
const { renderer } = await load('renderer');
const { styles } = await load('styles');
const { slots } = await load('renderer/slots');
wire([renderer, styles, slots]); // the app opts into light-DOM slots

await load('ui');
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(r));
const OPTS = [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }];

test('light + user-slotted trigger: captured, distributed, wired — zero component change', async () => {
  const el = dom.window.document.createElement('vera-select');
  el.setAttribute('light', '');
  el.setAttribute('aria-label', 'Flavor');
  const trigger = dom.window.document.createElement('button');
  trigger.setAttribute('slot', 'trigger');
  trigger.className = 'my-page-trigger';
  const value = dom.window.document.createElement('span');
  value.setAttribute('slot', 'value');
  value.textContent = 'Pick…';
  trigger.append(value);
  el.append(trigger);
  dom.window.document.body.append(el);
  el.options = OPTS;
  await frame();

  // no shadow root (light mode), no literal <slot> in the light DOM
  assert.equal(el.shadowRoot, null, 'light mode');
  assert.equal(el.querySelector('slot'), null, 'slots were distributed, no <slot> element left');

  // the user's own button was distributed into the trigger position AND wired by the component
  const wired = el.querySelector('.my-page-trigger');
  assert.ok(wired, 'the page trigger is in the rendered tree');
  assert.equal(wired, trigger, 'and it is the SAME node the user supplied (identity kept)');
  assert.equal(wired.getAttribute('role'), 'combobox', 'wired with combobox ARIA, like the built-in trigger');
  assert.equal(wired.getAttribute('aria-haspopup'), 'listbox');

  // it drives the same behavior: clicking opens the menu
  wired.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await frame();
  assert.equal(el.querySelector('[part="menu"]').getAttribute('data-state'), 'open', 'the slotted trigger opens the menu');

  // pick commits and the slotted value node is stamped (nested [slot=value] inside the trigger)
  el.querySelector('[part="option"]').click();
  await frame();
  assert.equal(el.value, 'a', 'a pick through the slotted trigger commits');
  assert.equal(value.getAttribute('data-label'), 'Alpha', 'the nested slotted value node is stamped, its children untouched');
  assert.equal(value.textContent, 'Pick…', 'you slot it, you own it');
  el.remove();
});

test('the SAME markup in SHADOW mode also works (native slots) — one component, both corners', async () => {
  const el = dom.window.document.createElement('vera-select'); // no light attr = shadow
  el.setAttribute('aria-label', 'Flavor');
  const trigger = dom.window.document.createElement('button');
  trigger.setAttribute('slot', 'trigger');
  trigger.className = 'shadow-trigger';
  el.append(trigger);
  dom.window.document.body.append(el);
  el.options = OPTS;
  await frame();
  assert.ok(el.shadowRoot, 'shadow mode');
  assert.equal(trigger.getAttribute('role'), 'combobox', 'the slotted trigger wired via native assignment + slotted()');
  trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await frame();
  assert.equal(el.shadowRoot.querySelector('[part="menu"]').getAttribute('data-state'), 'open');
  el.remove();
});
