/**
 * **A light component's `@scope` names its tag as a selector, escaped.** A custom element name may hold `.`, which CSS
 * reads as a class: `@scope (x-a.b)` scoped nothing of `<x-a.b>` and styled a stray `<x-a class="b">` in Chromium,
 * Firefox and WebKit (2026-11-23). jsdom has no `@scope` and does not cascade it, so this reads the emitted text, with
 * `CSSScopeRule` present on the window so the scoped branch runs; the browser suite reads the computed style.
 * Both builds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><head></head><body></body>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
/** The scoped branch runs only where the element's window has `@scope`. */
dom.window.CSSScopeRule = globalThis.CSSScopeRule = function CSSScopeRule() {};

const { init, wire } = await load('core');
const { adoptStyles } = await load('styles');
wire([{ on: 'init', fn: adoptStyles, priority: 50, name: '@verajs/styles' }]);

/** Every block the document holds, as text: a `<style>` element where there is no `adoptedStyleSheets`, else the sheets. */
const blocks = () => [...document.querySelectorAll('style')].map((style) => style.textContent).join('\n');

const light = (tag) => {
  customElements.define(
    tag,
    class extends HTMLElement {
      static styles = 'p { color: red }';
      connectedCallback() {
        init(this);
      }
    }
  );
  document.body.appendChild(document.createElement(tag));
};

test('CONTROL: a plain name is scoped as written, and the block is readable here', () => {
  light('x-ab');
  assert.match(blocks(), /@scope \(x-ab\) \{/);
});

test('a name holding `.` is scoped by the escaped selector, never as a class', () => {
  light('x-a.b');
  const text = blocks();
  assert.ok(text.includes('@scope (x-a\\.b) {'), text);
  assert.ok(!text.includes('@scope (x-a.b)'), 'the unescaped form reads `.b` as a class');
});

/**
 * The class, not just `.`: a name no engine defines today (`:` is outside the name rule), given to a defined element
 * as its own `localName`, which is all the scoping reads. Pins the escape to every ASCII non-identifier character.
 */
test('a character the name rule does not allow today is escaped the same way', () => {
  customElements.define(
    'x-colon',
    class extends HTMLElement {
      static styles = 'p { color: red }';
      connectedCallback() {
        init(this);
      }
    }
  );
  const element = document.createElement('x-colon');
  Object.defineProperty(element, 'localName', { value: 'x-a:b' });
  document.body.appendChild(element);
  assert.ok(blocks().includes('@scope (x-a\\:b) {'), blocks());
});
