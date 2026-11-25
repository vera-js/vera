/**
 * **`@vera-components/input/stepper` across two bundles**, in both builds (`npm test`, `npm run test:prod`): the input's
 * bundle finds the stepper the page wired, though each production bundle is mangled on its own (the development
 * bundles mangle nothing, so only `test:prod` proves the `$inputStepper` name crosses). A browser row cannot show it:
 * the test runner rewrites a bundle's bare `@verajs/core` to the development core, so the page's `wire` and the
 * element would read two registries. Behavior on real engines is `tests/browser/input-stepper.test.js`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://app.example/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver'])
  globalThis[key] = dom.window[key];
const { flush, wire } = await load('core');
wire([(await load('renderer')).renderer]);
await load('vera-components/input');
const { stepper } = await load('vera-components/input/stepper');

const mount = async (markup) => {
  document.body.innerHTML = markup;
  flush();
  await Promise.resolve();
  flush();
  return document.querySelector('vera-input');
};
const parts = (host) => [...host.querySelectorAll('[data-vera-part]')].map((node) => node.getAttribute('data-vera-part'));

test(`the input finds the stepper the page wired (${isProduction ? 'production' : 'development'} bundles)`, async () => {
  const before = await mount('<vera-input><input aria-label="n" type="number"></vera-input>');
  assert.deepEqual(parts(before), [], 'CONTROL: not wired, a number input gets no stepper');
  wire([stepper]);
  const host = await mount('<vera-input><input aria-label="n" type="number"></vera-input>');
  assert.deepEqual(parts(host), ['stepper', 'step-down', 'step-up'], 'wired, a number input gets the stepper');
  assert.equal(host.hasAttribute('data-vera-input-stepper'), true, 'and its box is marked as stepped');
  const text = await mount('<vera-input><input aria-label="t"></vera-input>');
  assert.deepEqual(parts(text), [], 'a text input never gets one');
  host.remove();
  document.body.append(host);
  flush();
  await Promise.resolve();
  flush();
  assert.equal(host.querySelectorAll('[data-vera-part="stepper"]').length, 1, 'reconnected, one stepper, not two');
  host.querySelector('input').remove();
  flush();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  flush();
  assert.deepEqual(parts(host), [], 'its input gone, the stepper goes with it');
  assert.equal(host.hasAttribute('data-vera-input-stepper'), false, 'and the mark');
});
