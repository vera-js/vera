/**
 * **`@verajs/renderer/native-elements` on the engines** (step 2 (b), 2026-10-21): a built-in host's lifecycle heard by a
 * sentinel custom element in a closed shadow root. jsdom pins the lifecycle (`tests/renderer-native-elements.test.mjs`);
 * these rows are what only an engine can answer: the sentinel hears a removal INSIDE another window after a cross-window
 * move (its definition is this window's), the host lays out and styles exactly as one with no sentinel, and a
 * contenteditable host still edits. Cross-realm values are compared as booleans (CLAUDE.md: chai inspecting an iframe's
 * nodes never finishes).
 */
import { expect } from '@esm-bundle/chai';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { nativeElements } from '../../packages/renderer/dist/development/vera-renderer-native-elements.js';
import { html, init, wire, createStore, flush } from '../../packages/core/dist/development/vera.js';

wire([renderer, nativeElements]);
const settle = async () => { flush(); await new Promise((resolve) => setTimeout(resolve, 20)); flush(); };
const frame = async () => {
  const f = document.createElement('iframe');
  document.body.append(f);
  await new Promise((resolve) => (f.contentDocument?.readyState === 'complete' ? resolve() : f.addEventListener('load', resolve, { once: true })));
  return f;
};

it('removed and re-added: set up again, ONE render, live', async () => {
  const state = createStore({ n: 0 });
  let setups = 0;
  const host = document.createElement('div');
  document.body.append(host);
  init(host, () => { setups++; return () => html`<b>${state.n}</b>`; });
  await settle();
  host.remove();
  await settle();
  document.body.append(host);
  state.n = 3;
  await settle();
  expect({ setups, bs: host.querySelectorAll('b').length, text: host.textContent }).to.deep.equal({ setups: 2, bs: 1, text: '3' });
  host.remove();
});

it('moved into another window\'s document and back: kept, live in both — and a removal INSIDE that window tears it down', async () => {
  const state = createStore({ n: 0 });
  let setups = 0;
  const f = await frame();
  const host = document.createElement('div');
  document.body.append(host);
  init(host, () => { setups++; return () => html`<b>${state.n}</b>`; });
  await settle();
  f.contentDocument.body.append(host);
  state.n = 5;
  await settle();
  const inFrame = host.textContent === '5';
  document.body.append(host);
  state.n = 6;
  await settle();
  const back = host.textContent === '6' && setups === 1;
  /** Into the frame again, then REMOVED there: the sentinel (this window's definition) must still hear it. */
  f.contentDocument.body.append(host);
  await settle();
  host.remove();
  await settle();
  document.body.append(host);
  await settle();
  expect({ inFrame, back, setupsAfterRemovalThere: setups }).to.deep.equal({ inFrame: true, back: true, setupsAfterRemovalThere: 2 });
  host.remove();
  f.remove();
});

it('a host lays out and styles exactly as the same markup with no sentinel', async () => {
  const style = document.createElement('style');
  style.textContent = '.ne-t { display: flex; gap: 7px; width: 300px } .ne-t > p { margin: 0; flex: 1; color: rgb(1, 2, 3) } .ne-t:empty { outline: 5px solid red }';
  document.head.append(style);
  const host = document.createElement('div');
  host.className = 'ne-t';
  const control = document.createElement('div');
  control.className = 'ne-t';
  control.innerHTML = '<p>one</p><p>two</p>';
  document.body.append(host, control);
  init(host, () => () => html`<p>one</p><p>two</p>`);
  await settle();
  const box = (el) => [...el.children].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.left - el.getBoundingClientRect().left)]; });
  expect(box(host)).to.deep.equal(box(control));
  expect(getComputedStyle(host.children[0]).color).to.equal('rgb(1, 2, 3)');
  expect(getComputedStyle(host).outlineStyle).to.equal(getComputedStyle(control).outlineStyle);
  host.remove();
  control.remove();
  style.remove();
});

it('a contenteditable host still edits its light content', async () => {
  const host = document.createElement('div');
  host.contentEditable = 'true';
  document.body.append(host);
  init(host, () => () => html`<p>abc</p>`);
  await settle();
  const text = host.querySelector('p').firstChild;
  host.focus();
  const range = document.createRange();
  range.setStart(text, 3);
  range.collapse(true);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand('insertText', false, 'X');
  expect(host.querySelector('p').textContent).to.equal('abcX');
  host.remove();
});
