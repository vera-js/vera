/**
 * `@verajs/spread` — `<div ${spread(props)}>`, bindings whose names are not known at parse time.
 *
 * Tests the BUILT artifacts, development and production (see `./dist.mjs`).
 *
 * Two behaviours carry most of the weight here, because they are the two that a naive
 * implementation gets wrong and that nothing else in the suite would catch:
 *
 *   - **Ownership.** State is keyed by the renderer's element-position *part*, not by the element.
 *     Keyed by element, `<div ${spread(a)} ${spread(b)}>` shares one map and whichever applies
 *     second releases the other's keys. That was measured, not hypothesised — the first spread's
 *     attributes silently vanished.
 *   - **Release.** A key that disappears restores what the element held *before* the binding, rather
 *     than guessing at a value that means "absent". For a property there is no such value:
 *     `undefined` runs through coercing setters and `delete` cannot remove a prototype accessor.
 *     This is the question Lit's spread PR has been stuck on since 2021.
 */
import { load } from './dist.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'Event',
                 'requestAnimationFrame', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[k] = dom.window[k];

const { render } = await load('renderer');
const { spread } = await load('spread');

/** The shape core's built-in `html` tag produces, as the other renderer suites do it. */
const html = (strings, ...values) => ({ _$litType$: 1, strings, values });

let host;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
const click = (el) => el.dispatchEvent(new dom.window.Event('click'));

/* ── the four binding kinds ──────────────────────────────────────────────────────────────────── */

test('plain keys become attributes', () => {
  render(html`<input ${spread({ id: 'a', placeholder: 'type' })} />`, host);
  const el = host.querySelector('input');
  assert.equal(el.getAttribute('id'), 'a');
  assert.equal(el.getAttribute('placeholder'), 'type');
});

test('`.name` sets a property, not an attribute', () => {
  render(html`<input ${spread({ '.value': 'typed' })} />`, host);
  const el = host.querySelector('input');
  assert.equal(el.value, 'typed');
  assert.equal(el.getAttribute('value'), null, 'a property binding writes no attribute');
});

test('`?name` toggles a boolean attribute', () => {
  render(html`<input ${spread({ '?disabled': true, '?readonly': false })} />`, host);
  const el = host.querySelector('input');
  assert.equal(el.hasAttribute('disabled'), true);
  assert.equal(el.hasAttribute('readonly'), false, 'a false boolean is absent, not empty');
});

test('`@name` and `onName` both bind events', () => {
  let sigil = 0;
  let react = 0;
  render(html`<button ${spread({ '@click': () => sigil++ })}></button>
              <a ${spread({ onClick: () => react++ })}></a>`, host);
  click(host.querySelector('button'));
  click(host.querySelector('a'));
  assert.equal(sigil, 1);
  assert.equal(react, 1, 'onClick is accepted as @click, matching written bindings');
});

test('all-lowercase `onclick` stays a plain attribute', () => {
  /** Legal inline-handler HTML; the same rule the renderer applies to written names. */
  render(html`<button ${spread({ onclick: 'noop()' })}></button>`, host);
  assert.equal(host.querySelector('button').getAttribute('onclick'), 'noop()');
});

test('a null attribute value removes the attribute', () => {
  const draw = (v) => render(html`<input ${spread({ id: v })} />`, host);
  draw('a');
  const el = host.querySelector('input');
  assert.equal(el.getAttribute('id'), 'a');
  draw(null);
  assert.equal(el.getAttribute('id'), null);
});

/* ── living alongside written bindings ───────────────────────────────────────────────────────── */

test('written attributes on the same element survive', () => {
  render(html`<input class="base" ${spread({ id: 'a' })} />`, host);
  const el = host.querySelector('input');
  assert.equal(el.getAttribute('class'), 'base');
  assert.equal(el.getAttribute('id'), 'a');
});

test('a spread key overrides a written attribute of the same name', () => {
  render(html`<input type="text" ${spread({ type: 'number' })} />`, host);
  assert.equal(host.querySelector('input').getAttribute('type'), 'number');
});

test('element refs at the same position still work', () => {
  const seen = { value: null };
  render(html`<span ${seen}></span>`, host);
  assert.equal(seen.value?.tagName, 'SPAN', 'a plain object is still a ref, not a props bag');
});

/* ── updates ─────────────────────────────────────────────────────────────────────────────────── */

test('values update in place across renders', () => {
  const draw = (id) => render(html`<input ${spread({ id })} />`, host);
  draw('a');
  const el = host.querySelector('input');
  draw('b');
  assert.equal(el.getAttribute('id'), 'b');
  assert.equal(host.querySelector('input'), el, 'the element was updated, not replaced');
});

test('a handler swaps without re-registering the listener', () => {
  let a = 0;
  let b = 0;
  const draw = (fn) => render(html`<button ${spread({ onClick: fn })}></button>`, host);
  draw(() => a++);
  const el = host.querySelector('button');
  draw(() => b++);
  click(el);
  assert.equal(a, 0, 'the old handler no longer fires');
  assert.equal(b, 1);
});

/* ── ownership: several spreads on one element ───────────────────────────────────────────────── */

test('two spreads on one element do not release each other', () => {
  const draw = () => render(html`<input ${spread({ id: 'a' })} ${spread({ title: 'b' })} />`, host);
  draw();
  draw(); // the second render is where element-keyed state would have collided
  const el = host.querySelector('input');
  assert.equal(el.getAttribute('id'), 'a');
  assert.equal(el.getAttribute('title'), 'b');
});

/* ── release: restore what was there ─────────────────────────────────────────────────────────── */

test('a dropped attribute key restores the written value, not nothing', () => {
  const draw = (p) => render(html`<input type="text" ${spread(p)} />`, host);
  draw({ type: 'number' });
  const el = host.querySelector('input');
  assert.equal(el.getAttribute('type'), 'number');
  draw({});
  assert.equal(el.getAttribute('type'), 'text', 'released to the initial state, not removed');
});

test('a dropped attribute with no initial value is removed', () => {
  const draw = (p) => render(html`<input ${spread(p)} />`, host);
  draw({ id: 'a' });
  const el = host.querySelector('input');
  draw({});
  assert.equal(el.getAttribute('id'), null);
});

test('a dropped boolean restores its written state', () => {
  const draw = (p) => render(html`<input disabled ${spread(p)} />`, host);
  draw({ '?disabled': false });
  const el = host.querySelector('input');
  assert.equal(el.hasAttribute('disabled'), false);
  draw({});
  assert.equal(el.hasAttribute('disabled'), true);
});

test('a dropped property on a custom element restores to undefined, not ""', () => {
  /**
   * The case that makes "restore what was there" the right question. Assigning `undefined` would
   * be indistinguishable here, but for `input.value` it coerces to `""` — one rule covers both.
   */
  customElements.define('x-spread-bag', class extends HTMLElement {});
  const draw = (p) => render(html`<x-spread-bag ${spread(p)}></x-spread-bag>`, host);
  draw({ '.items': [1, 2] });
  const el = host.querySelector('x-spread-bag');
  assert.deepEqual(el.items, [1, 2]);
  draw({});
  assert.equal(el.items, undefined);
});

test('a dropped event key stops the handler firing', () => {
  let n = 0;
  const draw = (p) => render(html`<button ${spread(p)}></button>`, host);
  draw({ onClick: () => n++ });
  const el = host.querySelector('button');
  click(el);
  draw({});
  click(el);
  assert.equal(n, 1, 'fired once while bound, never after release');
});

test('a key removed and re-added binds again', () => {
  const draw = (p) => render(html`<input ${spread(p)} />`, host);
  draw({ id: 'a' });
  const el = host.querySelector('input');
  draw({});
  draw({ id: 'c' });
  assert.equal(el.getAttribute('id'), 'c');
});

/* ── shape churn ─────────────────────────────────────────────────────────────────────────────── */

test('adding and removing keys in the same render is handled', () => {
  /** Equal sizes with different members — the case a naive size check alone would miss. */
  const draw = (p) => render(html`<input ${spread(p)} />`, host);
  draw({ id: 'a', title: 't' });
  const el = host.querySelector('input');
  draw({ id: 'a', lang: 'en' });
  assert.equal(el.getAttribute('lang'), 'en');
  assert.equal(el.getAttribute('title'), null, 'the departed key was released despite equal counts');
  assert.equal(el.getAttribute('id'), 'a');
});

test('an empty props object is valid and releases everything', () => {
  const draw = (p) => render(html`<input ${spread(p)} />`, host);
  draw({ id: 'a', title: 't' });
  const el = host.querySelector('input');
  draw({});
  assert.equal(el.getAttribute('id'), null);
  assert.equal(el.getAttribute('title'), null);
});
