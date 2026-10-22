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
const { define, html, wire, createStore, flush, useEffect, inserts } = await load('core');
const { renderer } = await load('renderer');
const seen = [];
wire([renderer, { on: 'init', fn: (element, options) => { if (element.localName.startsWith('x-def-')) seen.push([element.localName, options]); }, priority: 0 }]);
/**
 * RETIRES counted at core's one teardown: `retireElement` calls the renderer's `$x` once per retire. An effect cleanup is
 * NOT a teardown count — a second retire finds the hooks already dropped and runs nothing, so a double teardown read 1.
 */
const retires = new Map();
const spyRetires = (registry) => {
  const release = registry.$x;
  registry.$x = (element) => { retires.set(element, (retires.get(element) ?? 0) + 1); release?.(element); };
};
spyRetires(inserts);
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
  assert.deepEqual({ setups, teardowns, retires: retires.get(el) }, { setups: 2, teardowns: 2, retires: 2 }, 'two removals, two retires — not four');
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

test('options reach core (shadow) and every init insert — as init receives them, without the tag or the setup; the string form passes none, the object form at least {}', async () => {
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
  assert.equal(seen.find(([name]) => name === 'x-def-bare')[1], undefined, 'the STRING form passes no options');
  /** The object form with only a tag passes an EMPTY object (the rest of the options): the same behavior, one property miss. */
  define({ tag: 'x-def-tagonly' }, () => () => html`<p>t</p>`);
  const tagOnly = document.createElement('x-def-tagonly');
  document.body.append(tagOnly);
  await settle();
  assert.deepEqual(Object.keys(seen.find(([name]) => name === 'x-def-tagonly')[1]), [], 'the object form with only a tag passes {}');
  el.remove();
  bare.remove();
  tagOnly.remove();
});

test('the shared options copy is frozen in development: a module writing to it throws', { skip: isProduction && 'development-only' }, async () => {
  const errors = [];
  /** Priority 1: a taken priority REPLACES (the registry's rule), and 0 is this file's `seen` spy. */
  wire([{ on: 'init', fn: (element, options) => { if (element.localName === 'x-def-frozen') try { options.leak = 1; } catch (error) { errors.push(error); } }, priority: 1 }]);
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

test('two cores on one page: a define tag from each, each set up once and torn down EXACTLY once (both wrappers chained)', async () => {
  /** A second copy of core (its own module instance): it wraps the `customElements.define` the first copy already wrapped. */
  const second = await load('core', '?copy=2');
  /** In development both copies share `@verajs/inserts` (one registry); in production each inlines its own. */
  /**
   * NO renderer is wired into the second core: its setups render nothing, and the retire spy needs no release behind it.
   * Wiring the SAME renderer module into a second registry rebinds it to that core (its `untracked`, its seams) — in
   * production it then tracked the first core's compares, and polluted every later row of this file (2026-10-21).
   */
  if (second.inserts !== inserts) spyRetires(second.inserts);
  const counts = { s1: 0, t1: 0, s2: 0, t2: 0 };
  define('x-def-core1', () => {
    counts.s1++;
    useEffect(() => () => counts.t1++);
  });
  second.define('x-def-core2', () => {
    counts.s2++;
    second.useEffect(() => () => counts.t2++);
  });
  const one = document.createElement('x-def-core1');
  const two = document.createElement('x-def-core2');
  document.body.append(one, two);
  await settle();
  second.flush();
  assert.deepEqual(counts, { s1: 1, t1: 0, s2: 1, t2: 0 }, 'CONTROL: each set up once by its own core');
  one.remove();
  two.remove();
  await settle();
  second.flush();
  assert.deepEqual({ ...counts, r1: retires.get(one), r2: retires.get(two) }, { s1: 1, t1: 1, s2: 1, t2: 1, r1: 1, r2: 1 }, 'each retired EXACTLY once, by its own core');
});

/** Development warnings said during `fn`, by code. */
const warned = (fn) => {
  const warn = console.warn;
  const said = [];
  console.warn = (message) => said.push(String(message));
  try { fn(); } finally { console.warn = warn; }
  return said;
};

test('methods: callable on the element, `this` is the element, one function shared by every instance, never in the options', async () => {
  define({ tag: 'x-def-methods', shadow: 'open' }, () => () => html`<p>m</p>`);
  const calls = [];
  const a = document.createElement('x-def-methods');
  const b = document.createElement('x-def-methods');
  document.body.append(a, b);
  await settle();
  assert.equal(typeof a.open, 'undefined', 'CONTROL: a define without methods installs none');
  const M = define({ tag: 'x-def-methods2', methods: { open(n) { calls.push([this, n]); return n * 2; } } }, () => () => html`<p>m</p>`);
  const c = document.createElement('x-def-methods2');
  const d = document.createElement('x-def-methods2');
  document.body.append(c, d);
  await settle();
  assert.equal(c.open(21), 42);
  assert.equal(calls[0][0], c, '`this` is the element');
  assert.equal(c.open, d.open, 'one function on the prototype, shared');
  assert.equal(Object.hasOwn(c, 'open'), false, 'nothing per instance');
  assert.equal(M.prototype.open, c.open);
  assert.deepEqual(Object.keys(seen.find(([name]) => name === 'x-def-methods2')[1]), [], 'methods never reach the init options');
  for (const el of [a, b, c, d]) el.remove();
});

test('methods cannot replace the generated connectedCallback or the constructor — in EITHER build; constructor non-enumerable, the generated connectedCallback enumerable (decided)', async () => {
  let setups = 0;
  let said = [];
  let C;
  said = warned(() => {
    C = define({ tag: 'x-def-reserved', methods: { connectedCallback() { throw new Error('the user connectedCallback ran'); }, constructor() {}, open() {} } }, () => { setups++; return () => html`<p>r</p>`; });
  });
  const el = document.createElement('x-def-reserved');
  document.body.append(el);
  await settle();
  assert.equal(setups, 1, 'the component set up: the generated connectedCallback won');
  assert.equal(el.constructor, C, 'el.constructor is the registered class');
  /** jsdom has no `getName`; the browser suite's engines do (and native-elements' customized built-in test reads it). */
  if (customElements.getName) assert.equal(customElements.getName(el.constructor), 'x-def-reserved');
  assert.equal(customElements.get('x-def-reserved'), el.constructor);
  const enumerable = (k) => Object.getOwnPropertyDescriptor(C.prototype, k).enumerable;
  /**
   * DECIDED (vera-5a, 2026-10-21): the one-assign form makes the generated `connectedCallback` ENUMERABLE (a new
   * property, −11 B); `constructor` keeps the class's attributes. A class twin's stays non-enumerable — pinned beside it.
   */
  assert.deepEqual({ constructor: enumerable('constructor'), connectedCallback: enumerable('connectedCallback'), open: enumerable('open') }, { constructor: false, connectedCallback: true, open: true });
  class Twin extends HTMLElement { connectedCallback() {} }
  customElements.define('x-def-reserved-twin', Twin);
  assert.equal(Object.getOwnPropertyDescriptor(Twin.prototype, 'connectedCallback').enumerable, false, 'a class component\'s stays non-enumerable');
  if (!isProduction) assert.equal(said.filter((m) => m.includes('define-method-ignored')).length, 2, `both said, by code (${said.join(' | ')})`);
  el.remove();
});

test('the same behavior in both builds, the words in development: a getter, a platform name, adoptedCallback, an unobserved attributeChangedCallback', async () => {
  let reads = 0;
  const methods = { get value() { reads++; return 7; }, focus() { return 'mine'; }, adoptedCallback() {}, attributeChangedCallback() {} };
  const said = warned(() => define({ tag: 'x-def-warned', methods }, () => () => html`<p>w</p>`));
  const el = document.createElement('x-def-warned');
  document.body.append(el);
  await settle();
  assert.deepEqual({ reads, value: el.value, focus: el.focus() }, { reads: 1, value: 7, focus: 'mine' }, 'installed as Object.assign installs: the getter ran ONCE, the platform name replaced');
  if (!isProduction)
    for (const code of ['define-method-not-function', 'define-shadows', 'define-method-adopted', 'define-method-unobserved'])
      assert.equal(said.filter((m) => m.includes(code)).length, 1, `${code} said once (${said.join(' | ')})`);
  if (isProduction) assert.equal(said.length, 0, 'production says nothing');
  el.remove();
});

test('props: a plain-JS write AFTER connect repaints (an undeclared prop does not — the O1 case), and a default applies when nothing is bound', async () => {
  let renders = 0;
  define({ tag: 'x-def-props', props: { heading: 'default', count: 0 } }, (host) => () => { renders++; return html`<b>${host.heading}</b><i>${host.count}</i>`; });
  const el = document.createElement('x-def-props');
  document.body.append(el);
  await settle();
  assert.equal(el.textContent, 'default0', 'the defaults rendered');
  el.heading = 'after connect';
  await settle();
  assert.equal(el.textContent, 'after connect0', 'the plain-JS write repainted');
  el.count = 3;
  await settle();
  assert.deepEqual({ text: el.textContent, renders }, { text: 'after connect3', renders: 3 });
  el.remove();
});

test('props: an effect follows a prop that arrives late', async () => {
  const seenValues = [];
  define({ tag: 'x-def-late', props: { value: null } }, (host) => {
    useEffect(() => { seenValues.push(host.value); });
    return () => html`<p>l</p>`;
  });
  const el = document.createElement('x-def-late');
  document.body.append(el);
  await settle();
  el.value = 'arrived';
  await settle();
  assert.deepEqual(seenValues, [null, 'arrived']);
  el.remove();
});

test('props: a value set BEFORE the tag was defined wins over the default (handed over through the setter, then reactive)', async () => {
  const el = document.createElement('x-def-preupgrade');
  el.heading = 'early';
  document.body.append(el);
  define({ tag: 'x-def-preupgrade', props: { heading: 'default' } }, (host) => () => html`<b>${host.heading}</b>`);
  await settle();
  assert.equal(Object.hasOwn(el, 'heading'), false, 'the own data property was handed over');
  assert.equal(el.textContent, 'early');
  el.heading = 'later';
  await settle();
  assert.equal(el.textContent, 'later', 'and it is reactive after');
  el.remove();
});

test('props: array and plain-object defaults are per element; a prop named like an Object.prototype member keeps its default (hasOwn, not in)', async () => {
  /** `toString` / `valueOf` are platform names too (development says so; captured here). */
  warned(() => define({ tag: 'x-def-copies', props: { items: [], options: { a: 1 }, toString: 'x', valueOf: 7 } }, () => () => html`<p>c</p>`));
  const a = document.createElement('x-def-copies');
  const b = document.createElement('x-def-copies');
  document.body.append(a, b);
  await settle();
  a.items.push(1);
  assert.deepEqual({ a: a.items.length, b: b.items.length, sameOptions: a.options === b.options }, { a: 1, b: 0, sameOptions: false });
  assert.deepEqual({ toString: a.toString, valueOf: a.valueOf }, { toString: 'x', valueOf: 7 }, 'not Object.prototype\'s functions');
  a.remove();
  b.remove();
});

test('props: a parent binding a declared prop is NOT re-rendered by the child reading it, and binding the default\'s value renders the child once', async () => {
  const parentState = createStore({ heading: 'same' });
  let parentRenders = 0;
  let childRenders = 0;
  let childEffects = 0;
  define({ tag: 'x-def-child', props: { heading: 'same' } }, (host) => {
    useEffect(() => { void host.heading; childEffects++; });
    return () => { childRenders++; return html`<b>${host.heading}</b>`; };
  });
  define('x-def-parent', () => () => { parentRenders++; return html`<x-def-child .heading=${parentState.heading}></x-def-child>`; });
  const parent = document.createElement('x-def-parent');
  document.body.append(parent);
  await settle();
  assert.deepEqual({ parentRenders, childRenders, childEffects }, { parentRenders: 1, childRenders: 1, childEffects: 1 }, "bound to the default's value: one render, one effect");
  const child = parent.querySelector('x-def-child');
  child.heading = 'child wrote it';
  await settle();
  assert.equal(parentRenders, 1, "the parent never re-rendered through the child's read");
  parentState.heading = 'from parent';
  await settle();
  assert.deepEqual({ parentRenders, text: child.textContent }, { parentRenders: 2, text: 'from parent' });
  parent.remove();
});

test('props: development says a method-name collision, a platform name and a shared object default — installed the same in both builds', async () => {
  const shared = new Set();
  const said = warned(() => define({ tag: 'x-def-propwarn', methods: { open() { return 'method'; } }, props: { open: 'prop', title: 't', selected: shared } }, () => () => html`<p>w</p>`));
  const a = document.createElement('x-def-propwarn');
  const b = document.createElement('x-def-propwarn');
  document.body.append(a, b);
  await settle();
  /** Reading the Set through the store also says a Set in a store is handed back as it is (collections unwired): captured. */
  let read;
  warned(() => { read = { open: a.open, title: a.title, sharedA: a.selected === shared, sharedB: b.selected === shared }; });
  assert.deepEqual(read, { open: 'prop', title: 't', sharedA: true, sharedB: true }, 'the prop won; the Set is shared, as installed');
  if (!isProduction)
    for (const code of ['define-prop-method', 'define-shadows', 'define-prop-shared-default'])
      assert.equal(said.filter((m) => m.includes(code)).length, 1, `${code} said once (${said.join(' | ')})`);
  else assert.equal(said.length, 0);
  a.remove();
  b.remove();
});

test('props: a parent binding `!name` compares against the RAW record — the child writing it never re-renders the parent', async () => {
  const parentState = createStore({ open: false });
  let parentRenders = 0;
  define({ tag: 'x-def-livechild', props: { open: false } }, (host) => () => html`<b>${String(host.open)}</b>`);
  define('x-def-liveparent', () => () => { parentRenders++; return html`<x-def-livechild !open=${parentState.open}></x-def-livechild>`; });
  const parent = document.createElement('x-def-liveparent');
  document.body.append(parent);
  await settle();
  const child = parent.querySelector('x-def-livechild');
  assert.equal(parentRenders, 1, 'CONTROL: the parent rendered');
  child.open = true;
  await settle();
  assert.deepEqual({ parentRenders, text: child.textContent }, { parentRenders: 1, text: 'true' }, 'the child wrote its own prop; the parent was not subscribed to it');
  parentState.open = false;
  parentState.open = true;
  parentState.open = false;
  await settle();
  assert.equal(child.textContent, 'false', 'the parent’s next commit re-asserts its value (a difference is delivered)');
  parent.remove();
});

test('attributes: each arrives as a string|null prop under its camel name — set, changed, removed (null, not the default) — and repaints', async () => {
  let renders = 0;
  const C = define({ tag: 'x-def-attrs', attributes: ['label', 'data-count'] }, (host) => () => { renders++; return html`<b>${String(host.label)}</b><i>${String(host.dataCount)}</i>`; });
  assert.deepEqual(C.observedAttributes, ['label', 'data-count']);
  const el = document.createElement('x-def-attrs');
  document.body.append(el);
  await settle();
  assert.equal(el.textContent, 'nullnull', 'no attribute: null');
  el.setAttribute('label', 'hi');
  el.setAttribute('data-count', '3');
  await settle();
  assert.equal(el.textContent, 'hi3');
  el.removeAttribute('label');
  await settle();
  assert.equal(el.textContent, 'null3', 'removal writes null');
  assert.equal(renders, 3, 'one render per batch: the first, the two attributes set together, the removal');
  el.remove();
});

test('attributes: present before upgrade arrive before the setup; a PROPERTY set before upgrade beats the attribute; no reflection back', async () => {
  const a = document.createElement('x-def-preattr');
  a.setAttribute('label', 'from markup');
  const b = document.createElement('x-def-preattr');
  b.setAttribute('label', 'from markup');
  b.label = 'from property';
  document.body.append(a, b);
  define({ tag: 'x-def-preattr', attributes: ['label'] }, (host) => () => html`<b>${host.label}</b>`);
  await settle();
  assert.equal(a.textContent, 'from markup', 'the attribute was there at upgrade');
  assert.equal(b.textContent, 'from property', 'the property set before upgrade won (the hand-over runs at connect, after the attribute callback)');
  a.label = 'written';
  await settle();
  assert.deepEqual({ text: a.textContent, attribute: a.getAttribute('label') }, { text: 'written', attribute: 'from markup' }, 'one way: a prop write never touches the attribute');
  a.remove();
  b.remove();
});

test('attributes: one that SHARES a declared prop keeps its default until the attribute appears; removal writes null', async () => {
  define({ tag: 'x-def-sharedattr', props: { label: 'default' }, attributes: ['label'] }, (host) => () => html`<b>${String(host.label)}</b>`);
  const el = document.createElement('x-def-sharedattr');
  document.body.append(el);
  await settle();
  assert.equal(el.textContent, 'default');
  el.setAttribute('label', 'attr');
  await settle();
  assert.equal(el.textContent, 'attr');
  el.removeAttribute('label');
  await settle();
  assert.equal(el.textContent, 'null');
  el.remove();
});

test('attributes: a tag that declares none carries no observedAttributes and no attributeChangedCallback', () => {
  const C = define('x-def-noattrs', () => () => html`<p>n</p>`);
  assert.deepEqual({ observed: C.observedAttributes, callback: 'attributeChangedCallback' in C.prototype }, { observed: undefined, callback: false });
});

test('attributes: development says a type flip, a reflected platform name and an ignored method; refuses a non-array — the same installs in both builds', async () => {
  let said = warned(() => define({ tag: 'x-def-attrwarn', props: { count: 0 }, attributes: ['count', 'hidden'], methods: { attributeChangedCallback() { throw new Error('the method ran'); } } }, (host) => () => html`<b>${String(host.count)}</b>`));
  const el = document.createElement('x-def-attrwarn');
  el.setAttribute('count', '5');
  document.body.append(el);
  await settle();
  assert.equal(el.textContent, '5', 'the generated attributeChangedCallback won over the method, in both builds');
  if (!isProduction) {
    for (const code of ['define-attribute-type', 'define-attribute-reflected', 'define-method-ignored'])
      assert.equal(said.filter((m) => m.includes(code)).length, 1, `${code} said once (${said.join(' | ')})`);
    assert.throws(() => define({ tag: 'x-def-attrbad', attributes: 'label' }, () => {}), /define-attributes/);
  } else assert.equal(said.length, 0);
  el.remove();
});

test('release at removal: a define component removed then re-added keeps its prop values and stays reactive', async () => {
  define({ tag: 'x-def-release', props: { label: 'default', items: [] } }, (host) => () => html`<b>${host.label}</b><i>${host.items.length}</i>`);
  const el = document.createElement('x-def-release');
  document.body.append(el);
  await settle();
  el.label = 'kept';
  el.items.push(1);
  await settle();
  assert.equal(el.textContent, 'kept1', 'CONTROL: the writes landed');
  el.remove();
  await settle();
  document.body.append(el);
  await settle();
  assert.equal(el.textContent, 'kept1', 'the values survived the release');
  el.label = 'after';
  el.items.push(2);
  await settle();
  assert.equal(el.textContent, 'after2', 'and the re-added element is reactive — a scalar write and a deep push');
  el.remove();
});

test('release at removal: a component MIXING declared and adopted props — both reactive after a remove and re-add', async () => {
  const parentState = createStore({ extra: 'one' });
  define({ tag: 'x-def-mixchild', props: { label: 'L' } }, (host) => () => html`<b>${host.label}</b><i>${host.extra}</i>`);
  const parent = document.createElement('div');
  document.body.append(parent);
  const { renderInto } = await load('renderer');
  const draw = () => html`<x-def-mixchild .extra=${parentState.extra}></x-def-mixchild>`;
  renderInto(draw(), parent);
  await settle();
  const child = parent.querySelector('x-def-mixchild');
  assert.equal(child.textContent, 'Lone', 'CONTROL: the adopted (undeclared) prop arrived');
  child.remove();
  await settle();
  parent.append(child);
  await settle();
  parentState.extra = 'two';
  renderInto(draw(), parent);
  child.label = 'M';
  await settle();
  assert.equal(child.textContent, 'Mtwo', 'declared and adopted both follow the new record');
  parent.remove();
});

test('release at removal: a CLASS component with adopted props, removed then re-added, still hears its parent', async () => {
  const parentState = createStore({ name: 'a' });
  const { init } = await load('core');
  customElements.define('x-def-classadopt', class extends HTMLElement { connectedCallback() { init(this, (host) => () => html`<b>${host.name}</b>`); } });
  const parent = document.createElement('div');
  document.body.append(parent);
  const { renderInto } = await load('renderer');
  const draw = () => html`<x-def-classadopt .name=${parentState.name}></x-def-classadopt>`;
  renderInto(draw(), parent);
  await settle();
  const child = parent.querySelector('x-def-classadopt');
  assert.equal(child.textContent, 'a');
  child.remove();
  await settle();
  parent.append(child);
  await settle();
  parentState.name = 'b';
  renderInto(draw(), parent);
  await settle();
  assert.equal(child.textContent, 'b');
  child.name = 'c';
  await settle();
  assert.equal(child.textContent, 'c', 'a plain write after the re-add repaints too');
  parent.remove();
});

/**
 * `!name`, not `.name`: a `.name` binding skips an unchanged value before any compare, so only a LIVE binding — compared
 * against the child's CURRENT value every render — can show a stale record (vera-5a). Red with a captured old store.
 */
test('release at removal: after a re-add, a parent’s live `!name` compare reads the NEW record (a captured old store would read a stale copy)', async () => {
  const parentState = createStore({ name: 'a', tick: 0 });
  const { init } = await load('core');
  customElements.define('x-def-livecopy', class extends HTMLElement { connectedCallback() { init(this, (host) => () => html`<b>${host.name}</b>`); } });
  const parent = document.createElement('div');
  document.body.append(parent);
  const { renderInto } = await load('renderer');
  const draw = () => html`<x-def-livecopy !name=${parentState.name} data-tick=${parentState.tick}></x-def-livecopy>`;
  renderInto(draw(), parent);
  await settle();
  const child = parent.querySelector('x-def-livecopy');
  child.remove();
  await settle();
  parent.append(child);
  await settle();
  child.name = 'c';                // the child's own write, after the re-add
  await settle();
  assert.equal(child.textContent, 'c', 'CONTROL: the write landed');
  parentState.tick++;              // the parent re-renders; its bound value is unchanged ('a')
  renderInto(draw(), parent);
  await settle();
  assert.equal(child.textContent, 'a', 'the live compare saw the child’s current value (c) differ, and re-asserted a');
  parent.remove();
});

test('release at removal: a MIXED component (an adopted key arrives FIRST) has its declared defaults before and after a remove/re-add', async () => {
  const parentState = createStore({ extra: 'x' });
  define({ tag: 'x-def-mixfirst', props: { label: 'default', items: [] } }, (host) => () => html`<b>${host.label}</b><i>${host.items.length}</i><u>${host.extra}</u>`);
  const parent = document.createElement('div');
  document.body.append(parent);
  const { renderInto } = await load('renderer');
  const draw = () => html`<x-def-mixfirst .extra=${parentState.extra}></x-def-mixfirst>`;
  renderInto(draw(), parent);
  await settle();
  const child = parent.querySelector('x-def-mixfirst');
  assert.equal(child.textContent, 'default0x', 'the adopted key arrived first and the declared defaults are there');
  child.remove();
  await settle();
  parent.append(child);
  await settle();
  assert.equal(child.textContent, 'default0x', 'the defaults survived the release');
  child.items.push(1);
  await settle();
  assert.equal(child.textContent, 'default1x', 'and the declared array is reactive after the re-add');
  parent.remove();
});
