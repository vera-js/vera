/**
 * Two copies of `@verajs/styles` on one page must not hoist the same component's light-DOM styles
 * twice.
 *
 * A production `.min.js` inlines its dependencies, so a page loading two copies gives each its own
 * module state. Keeping "already hoisted" in a module-scope `WeakSet` meant neither copy saw the
 * other's: the same rules reached the document twice, and the browser parsed and applied them twice
 * for as long as the page lived. The mark lives on the component class instead, under a name exempt
 * from property mangling — the one object both copies are looking at.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { distUrl } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element'])
  globalThis[key] = dom.window[key];

/** `?copy=` forces a second module instance, which is what two bundles on a page amount to. */
const first = await import(distUrl('styles'));
const second = await import(distUrl('styles', '?copy=b'));

test('two copies of the package hoist a class exactly once', () => {
  assert.notEqual(first.applyStyles, second.applyStyles, 'the two copies must really be separate');

  class Widget extends HTMLElement {}
  customElements.define('x-two-copies', Widget);
  const element = new Widget();
  document.body.append(element);

  const before = document.head.querySelectorAll('style').length;
  first.applyStyles(['.a{color:red}'], element);
  second.applyStyles(['.a{color:red}'], element);
  first.applyStyles(['.a{color:red}'], element);

  assert.equal(
    document.head.querySelectorAll('style').length - before,
    1,
    'one sheet for one class, however many copies of the package are loaded'
  );
});

/** A different class still gets its own, or the guard would be too broad. */
test('a second component class still hoists', () => {
  class Other extends HTMLElement {}
  customElements.define('x-two-copies-other', Other);
  const element = new Other();
  document.body.append(element);
  const before = document.head.querySelectorAll('style').length;
  second.applyStyles(['.b{color:blue}'], element);
  assert.equal(document.head.querySelectorAll('style').length - before, 1);
});
