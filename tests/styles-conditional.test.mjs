/**
 * `static styles = [base, isDark && darkSheet]` — the way conditional styles are written.
 *
 * That produces `[sheet, false]`, and it broke both of `applyStyles`' paths, differently, and
 * neither of them legibly:
 *
 * - **shadow DOM**: `escapeStyleText(false)` threw `value.replace is not a function` out of
 *   `connectedCallback`, from a file the author has never opened, taking the component with it;
 * - **light DOM**: nothing threw at all. `false.cssText` is `undefined`, so the literal text
 *   `undefined` was joined into the stylesheet and hoisted to the document;
 * - and `[base, cond ? dark : null]` threw a third message, one step earlier.
 *
 * The top of `applyStyles` already reads a falsy `styles` argument as "no styles". These are the
 * same rule applied to the members of an array.
 */
import { load, isProduction } from './dist.mjs';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import test from 'node:test';

const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { init, render, html, css, wire } = core;
const { styles, applyStyles } = await load('styles');
const { renderer } = await load('renderer');
wire([renderer, styles]);

const host = document.getElementById('host');
const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const base = css`:host { color: red; }`;
const dark = css`:host { color: black; }`;
/** Read from a variable so the `&&` below is the real idiom rather than a constant ESLint folds. */
const conditions = { on: true, off: false };

let seq = 0;
/** Mounts a component whose `static styles` is `value`, in the shadow DOM or the light DOM. */
const mountWith = async (value, { shadow = true } = {}) => {
  const tag = `x-cond-${seq++}`;
  const Component = class extends HTMLElement {
    connectedCallback() {
      init(this, shadow ? { mode: 'open' } : undefined);
      render(() => html`<i>x</i>`);
    }
  };
  Component.styles = value;
  customElements.define(tag, Component);
  const element = document.createElement(tag);
  host.appendChild(element);
  await settle();
  return element;
};

const cssTextOf = (element) =>
  [...(element.shadowRoot?.querySelectorAll('style') ?? [])]
    .map((tag) => tag.textContent)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

test('a falsy entry in static styles means no styles, not a crash', async () => {
  for (const [label, value, expected] of [
    ['a truthy condition', [base, conditions.on && dark], ':host { color: red; } :host { color: black; }'],
    ['a false condition', [base, conditions.off && dark], ':host { color: red; }'],
    ['a ternary yielding null', [base, null], ':host { color: red; }'],
    ['undefined', [base, undefined], ':host { color: red; }'],
    ['an empty string', [base, ''], ':host { color: red; }'],
    ['every entry falsy', [false, null, undefined], ''],
  ]) {
    const element = await mountWith(value);
    assert.equal(cssTextOf(element), expected, `${label} did not produce the expected CSS`);
  }
});

test('and the light-DOM path does not hoist the word "undefined"', async () => {
  const element = await mountWith([base, conditions.off && dark], { shadow: false });
  const hoisted = [...document.head.querySelectorAll('style')].map((tag) => tag.textContent).join(' ');
  assert.ok(!/undefined/.test(hoisted), `the document stylesheet contains "undefined": ${hoisted.slice(0, 120)}`);
  assert.equal(element.shadowRoot, null, 'this case is the light-DOM one');
});

test('applyStyles takes the same shapes directly', async () => {
  const element = await mountWith(undefined);
  for (const value of [[base, false], [base, null], [base, undefined], base, ':host{color:blue}', []])
    assert.doesNotThrow(() => applyStyles(value, element), `applyStyles rejected ${JSON.stringify(String(value))}`);
});

test('but CSS that is not CSS is refused by name', { skip: isProduction && 'development-only diagnostics' }, async () => {
  const element = await mountWith(undefined);
  for (const [label, value] of [
    ['a number', 42],
    ['an object with neither cssText nor styleSheet', { a: 1 }],
    ['an array holding one', [base, 42]],
  ]) {
    assert.throws(
      () => applyStyles(value, element),
      (error) => error instanceof TypeError && /^applyStyles: expected CSS/.test(error.message),
      `${label} was accepted, or refused without naming the API`
    );
  }
});
