/**
 * **<vera-kbd> as a page meets it, in jsdom**: nested `<kbd>` per platform, `+` only between word keys, a symbol key's
 * symbol `aria-hidden` with its word on `data-vera-word`, the reader's platform from the window's navigator, a change
 * re-spelling it, hostile keys as text, and development's two warnings. jsdom has no `adoptedStyleSheets`, so the words
 * rule itself is the browser suite's. Runs against both builds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://app.example/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver'])
  globalThis[key] = dom.window[key];
/** The reader's platform, as the window reports it: set per row through the navigator's own property. */
let reported = 'Linux x86_64';
Object.defineProperty(dom.window.navigator, 'platform', { configurable: true, get: () => reported });
const said = [];
console.warn = (...args) => said.push(String(args[0]));
const { flush, wire } = await load('core');
wire([(await load('renderer')).renderer]);
await load('vera-components/kbd');

const mount = async (markup) => {
  said.length = 0;
  document.body.innerHTML = markup;
  flush();
  await Promise.resolve();
  flush();
  return document.querySelector('vera-kbd');
};
const settle = async () => {
  flush();
  await Promise.resolve();
  flush();
};
/** Each key's visible text, in order, and the combo's whole text (what a selection holds). */
const keys = (element) => [...element.querySelectorAll('[data-vera-part="key"]')].map((key) => key.textContent);
const combo = (element) => element.querySelector('[data-vera-part="combo"]');
const codes = () => said.map((line) => /\(([a-z-]+)\)\s*$/.exec(line)?.[1] ?? line);

test('other: word keys joined by +, nested in one combo <kbd>', async () => {
  const element = await mount('<vera-kbd keys="Mod+Shift+K" platform="other"></vera-kbd>');
  assert.equal(combo(element).localName, 'kbd');
  assert.deepEqual(keys(element), ['Ctrl', 'Shift', 'K']);
  assert.equal(combo(element).textContent, 'Ctrl+Shift+K');
  assert.equal(element.querySelector('[data-vera-word]'), null, 'words need no spoken word');
  assert.ok([...combo(element).children].every((child) => child.localName === 'kbd'), 'only <kbd> keys inside the combo');
  assert.deepEqual(said, []);
});

test('apple: symbols in Apple\'s order with no separator; each symbol aria-hidden, its word on data-vera-word', async () => {
  const element = await mount('<vera-kbd keys="Shift+Mod+K" platform="apple"></vera-kbd>');
  assert.deepEqual(keys(element), ['⇧', '⌘', 'K']);
  assert.equal(combo(element).textContent, '⇧⌘K', 'what is shown is what a selection holds');
  const symbols = [...element.querySelectorAll('[data-vera-word]')];
  assert.deepEqual(symbols.map((key) => key.getAttribute('data-vera-word')), ['Shift', 'Command']);
  for (const key of symbols) {
    assert.equal(key.children.length, 1);
    assert.equal(key.firstElementChild.getAttribute('aria-hidden'), 'true');
  }
  assert.equal(element.querySelectorAll('[data-vera-part="key"]')[2].hasAttribute('data-vera-word'), false, 'K is a word');
});

test('windows: Meta is Win', async () => {
  const element = await mount('<vera-kbd keys="Meta+L" platform="windows"></vera-kbd>');
  assert.equal(combo(element).textContent, 'Win+L');
});

test('no platform attribute: the reader\'s, from the window\'s navigator, read at each render', async () => {
  reported = 'MacIntel';
  const element = await mount('<vera-kbd keys="Mod+K"></vera-kbd>');
  assert.equal(combo(element).textContent, '⌘K');
  reported = 'Win32';
  const other = await mount('<vera-kbd keys="Mod+K"></vera-kbd>');
  assert.equal(combo(other).textContent, 'Ctrl+K');
  reported = 'Linux x86_64';
  assert.equal(combo(await mount('<vera-kbd keys="Meta+K"></vera-kbd>')).textContent, 'Meta+K');
});

test('changing keys or platform re-spells it, leaving nothing of the old spelling', async () => {
  const element = await mount('<vera-kbd keys="Mod+K" platform="other"></vera-kbd>');
  element.setAttribute('platform', 'apple');
  await settle();
  assert.equal(combo(element).textContent, '⌘K');
  element.setAttribute('keys', 'Alt+Enter');
  await settle();
  assert.equal(combo(element).textContent, '⌥↩');
  assert.deepEqual([...element.querySelectorAll('[data-vera-word]')].map((key) => key.getAttribute('data-vera-word')), ['Option', 'Return']);
  element.setAttribute('platform', 'other');
  await settle();
  assert.equal(combo(element).textContent, 'Alt+Enter');
  assert.equal(element.querySelector('[data-vera-word]'), null);
});

test('hostile keys become text, never markup', async () => {
  const element = await mount('<vera-kbd platform="other"></vera-kbd>');
  element.setAttribute('keys', 'Mod+<img src=x onerror=alert(1)>');
  await settle();
  assert.equal(element.querySelector('img'), null);
  assert.deepEqual(keys(element), ['Ctrl', '<img src=x onerror=alert(1)>']);
  assert.deepEqual([...element.querySelectorAll('*')].map((node) => node.localName).sort(), ['kbd', 'kbd', 'kbd']);
});

test('development warns for no keys and for an unknown platform (quoted); production says nothing', async () => {
  await mount('<vera-kbd platform="other"></vera-kbd>');
  assert.deepEqual(codes(), isProduction ? [] : ['kbd-no-keys']);
  const element = await mount('<vera-kbd keys="Mod+K" platform="mac"></vera-kbd>');
  assert.deepEqual(codes(), isProduction ? [] : ['kbd-unknown-platform']);
  if (!isProduction) {
    assert.match(said[0], /^\[vera\] /);
    assert.ok(said[0].includes('"mac"'), said[0]);
  }
  reported = 'Linux x86_64';
  assert.equal(combo(element).textContent, 'Ctrl+K', 'an unknown platform follows the reader');
  await mount('<vera-kbd keys="Mod+K" platform="other"></vera-kbd>');
  assert.deepEqual(said, [], 'CONTROL: a valid kbd says nothing');
});
