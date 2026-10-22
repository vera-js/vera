/**
 * **`define(tag, setup)` / `define({ tag, …options }, setup)`** (R3 piece 1, 2026-10-21): a component without a class.
 * These rows pin what the generated class must do through core's `customElements.define` wrapper and NOT itself — ONE
 * setup per connect, ONE teardown per removal (a teardown of the class's own would retire twice), a one-operation move
 * keeps it — plus its options reaching core and the `'init'` inserts, the setup kept off the options object, and the
 * development misuse codes. Counts are exact (`=== n`), each with a control that the thing counted ran.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { define, html, wire, createStore, flush, useEffect } = await load('core');
const { renderer } = await load('renderer');
const seen = [];
wire([renderer, { on: 'init', fn: (element, options) => { if (element.localName.startsWith('x-def-')) seen.push([element.localName, options]); }, priority: 0 }]);
const settle = async () => { flush(); await new Promise((resolve) => setTimeout(resolve, 0)); flush(); };

test('define(tag, setup) renders, and the class it returns is the registered one', async () => {
  const state = createStore({ n: 1 });
  const Class = define('x-def-basic', () => () => html`<b>${state.n}</b>`);
  assert.equal(customElements.get('x-def-basic'), Class);
  const el = document.createElement('x-def-basic');
  document.body.append(el);
  await settle();
  state.n = 2;
  await settle();
  assert.equal(el.textContent, '2');
  el.remove();
});

test('removed then re-added: setup EXACTLY twice, teardown EXACTLY once per removal (the wrapper is the one teardown)', async () => {
  let setups = 0;
  let teardowns = 0;
  define('x-def-cycle', () => {
    setups++;
    useEffect(() => () => teardowns++);
    return () => html`<i>c</i>`;
  });
  const el = document.createElement('x-def-cycle');
  document.body.append(el);
  await settle();
  assert.deepEqual({ setups, teardowns }, { setups: 1, teardowns: 0 }, 'CONTROL: set up once, nothing torn down');
  el.remove();
  await settle();
  assert.equal(teardowns, 1, 'one removal, one teardown');
  document.body.append(el);
  await settle();
  el.remove();
  await settle();
  assert.deepEqual({ setups, teardowns }, { setups: 2, teardowns: 2 });
});

test('a one-operation move keeps it: setup once, no teardown, still live', async () => {
  const state = createStore({ n: 0 });
  let setups = 0;
  let teardowns = 0;
  define('x-def-move', () => {
    setups++;
    useEffect(() => () => teardowns++);
    return () => html`<b>${state.n}</b>`;
  });
  const a = document.createElement('section');
  const b = document.createElement('section');
  document.body.append(a, b);
  const el = document.createElement('x-def-move');
  a.append(el);
  await settle();
  b.append(el);
  await settle();
  state.n = 5;
  await settle();
  assert.deepEqual({ setups, teardowns, text: el.textContent }, { setups: 1, teardowns: 0, text: '5' });
  a.remove();
  b.remove();
});

test('options reach core (shadow) and every init insert — as init receives them, without the tag or the setup', async () => {
  define({ tag: 'x-def-opts', shadow: 'open' }, () => () => html`<p>in shadow</p>`);
  const el = document.createElement('x-def-opts');
  document.body.append(el);
  await settle();
  assert.equal(el.shadowRoot?.textContent, 'in shadow', 'shadow: open gave a root the template rendered into');
  const [, options] = seen.find(([name]) => name === 'x-def-opts');
  assert.deepEqual(Object.keys(options), ['shadow'], 'the insert saw exactly the options, no tag or setup');
  define('x-def-bare', () => () => html`<p>bare</p>`);
  const bare = document.createElement('x-def-bare');
  document.body.append(bare);
  await settle();
  assert.equal(seen.find(([name]) => name === 'x-def-bare')[1], undefined, 'a tag-only define passes no options');
  el.remove();
  bare.remove();
});

test('the shared options copy is frozen in development: a module writing to it throws', { skip: isProduction && 'development-only' }, async () => {
  const errors = [];
  wire([{ on: 'init', fn: (element, options) => { if (element.localName === 'x-def-frozen') try { options.leak = 1; } catch (error) { errors.push(error); } }, priority: 0 }]);
  define({ tag: 'x-def-frozen', shadow: 'open' }, () => () => html`<p>f</p>`);
  const el = document.createElement('x-def-frozen');
  document.body.append(el);
  await settle();
  assert.equal(errors.length, 1, 'the write threw');
  el.remove();
});

test('misuse is coded in development: a bad tag, a non-function setup, a second define', { skip: isProduction && 'development-only' }, () => {
  assert.throws(() => define('nohyphen', () => {}), /define-tag/);
  assert.throws(() => define({ tag: 42 }, () => {}), /define-tag/);
  assert.throws(() => define('x-def-nosetup', 'nope'), /define-setup/);
  define('x-def-twice', () => {});
  const warn = console.warn;
  const said = [];
  console.warn = (message) => said.push(String(message));
  try {
    assert.throws(() => define('x-def-twice', () => {}), 'the platform still refuses');
  } finally {
    console.warn = warn;
  }
  assert.equal(said.filter((m) => m.includes('define-twice')).length, 1, `said first, by its code (${said.join(' | ')})`);
});
