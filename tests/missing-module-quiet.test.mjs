/**
 * **THE CONTROL for `missing-module-warnings.test.mjs`: silence when the module IS wired.**
 *
 * Its own file because it cannot share one. The warning is once-per-page and its flag is
 * module-scoped, so running this after the test that fires would assert silence against a budget
 * already spent — passing identically whether the check is right, inverted, or deleted. A separate
 * file is a separate process and a fresh registry, which is the only arrangement where this
 * assertion means anything.
 *
 * And it is the half that matters most in the long run. A diagnostic that fires when the page is
 * fine is worse than no diagnostic: it teaches people to ignore the channel, and nothing else in
 * the suite would notice it had started to.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver',
  'CSSStyleSheet']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wire, init, render, html } = await load('core');
const { renderer } = await load('renderer');
const { directives, wireDirectives, expressions, interaction } = await load('directives');
wire([renderer, directives]);
wireDirectives([expressions, ...interaction]);

test('a wired engine is never told its markup does nothing', async (t) => {
  if (isProduction) return t.skip('the whole check is a __DEV__ branch — production has neither it nor its message');

  const seen = [];
  const original = console.warn;
  console.warn = (...args) => seen.push(args.join(' '));
  try {
    dom.window.customElements.define('wired-thing', class extends dom.window.HTMLElement {
      connectedCallback() {
        init(this, { mode: 'open' });
        render(() => html`${dom.window.document.createRange().createContextualFragment(
          '<div data-vd-state="{ open: false }"><button data-vd-on-click="{ open: !open }">menu</button></div>'
        )}`);
      }
    });
    dom.window.document.body.appendChild(dom.window.document.createElement('wired-thing'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    console.warn = original;
  }

  assert.deepEqual(seen.filter((w) => w.includes('no directives engine is wired')), [],
    'a page that works must never be told it is broken');
});
