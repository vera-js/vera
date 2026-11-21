/**
 * **<vera-spinner> as a page meets it, in jsdom**: what it renders, what a screen reader is told and when, and
 * development's one warning. Each row is a line of the sign-off sheet or one of its pre-registered rows (one
 * announcement for twenty, for a move, for keyed churn; none for a short load or inside a busy owner). The window's
 * timers run on a clock the row advances, so "said" and "said nothing" are read after exactly the timers that would
 * have said it, never after a sleep. jsdom has no `adoptedStyleSheets` and no layout, so the arc's look and whether a
 * screen reader SPEAKS the write are the browser suite's. Runs against both builds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://app.example/', pretendToBeVisual: true });
const win = dom.window;
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver'])
  globalThis[key] = win[key];

/** The window's timers on a clock: `advance(ms)` runs every timer due within `ms`, in due order, including ones they queue. */
const queue = new Map();
let now = 0;
let next = 0;
win.setTimeout = (fn, ms = 0) => (queue.set(++next, { fn, at: now + ms }), next);
win.clearTimeout = (id) => void queue.delete(id);
const advance = (ms) => {
  const until = now + ms;
  for (;;) {
    let first = null;
    for (const [id, timer] of queue) if (timer.at <= until && (first === null || timer.at < first[1].at)) first = [id, timer];
    if (first === null) break;
    queue.delete(first[0]);
    now = first[1].at;
    first[1].fn();
  }
  now = until;
};

const warned = [];
console.warn = (...args) => warned.push(String(args[0]));
const { flush, wire } = await load('core');
wire([(await load('renderer')).renderer]);
await load('vera-components/spinner');

/** Past every settle window, grace and write, and short of a message's removal (7 s). */
const LATER = 1000;
const settle = async () => {
  flush();
  await Promise.resolve();
  flush();
};
/** A fresh page: no region, no record, no timers, no warnings. Every row starts here. */
const fresh = async (markup = '') => {
  document.body.innerHTML = '';
  await settle();
  advance(60_000);
  queue.clear();
  delete document[Symbol.for('vera.announce')];
  warned.length = 0;
  document.body.innerHTML = markup;
  await settle();
};
/** What the document's polite region holds, in order: what a screen reader has been given. */
const said = () => [...document.querySelectorAll('[data-vera-announce="polite"] > *')].map((message) => message.textContent);
const codes = () => warned.map((line) => /\(([a-z-]+)\)\s*$/.exec(line)?.[1] ?? line);

test('it renders a decorative arc and takes no role: the hook speaks, the host never does', async () => {
  await fresh('<vera-spinner label="Loading"></vera-spinner>');
  const host = document.querySelector('vera-spinner');
  const arc = host.querySelector('[data-vera-part="arc"]');
  assert.ok(arc !== null, 'the arc part');
  assert.equal(arc.getAttribute('aria-hidden'), 'true');
  assert.equal(host.getAttribute('role'), null);
  assert.equal(host.getAttribute('aria-live'), null);
  assert.equal(host.querySelector('[data-vera-part="label"]'), null, 'no shown label without show-label');
  assert.equal(host.textContent, '', 'nothing a screen reader reads in place');
});

test('its label is said once, after the settle window, and not before', async () => {
  await fresh('<vera-spinner label="Loading results"></vera-spinner>');
  advance(100);
  assert.deepEqual(said(), [], 'nothing inside the window');
  advance(LATER);
  assert.deepEqual(said(), ['Loading results']);
  advance(LATER);
  assert.deepEqual(said(), ['Loading results'], 'and never again while it spins');
  assert.deepEqual(warned, []);
});

test('a spinner removed after 50 ms says nothing (a fast load is silent)', async () => {
  await fresh('<vera-spinner label="Loading" done-label="Loaded"></vera-spinner><p>x</p>');
  advance(50);
  document.querySelector('vera-spinner').remove();
  await settle();
  /** CONTROL: a spinner connected now is said, so the clock and the hook do run. */
  document.querySelector('p').innerHTML = '<vera-spinner label="Saving"></vera-spinner>';
  await settle();
  advance(LATER);
  assert.deepEqual(said(), ['Saving']);
});

test('twenty spinners connected in one task say their label once', async () => {
  await fresh(Array.from({ length: 20 }, () => '<vera-spinner label="Loading"></vera-spinner>').join(''));
  assert.equal(document.querySelectorAll('[data-vera-part="arc"]').length, 20, 'CONTROL: all twenty rendered');
  advance(LATER);
  assert.deepEqual(said(), ['Loading']);
});

test('a spinner moved between parents, in one step or two, says nothing beyond its first', async () => {
  await fresh('<div id="a"><vera-spinner label="Loading"></vera-spinner></div><div id="b"></div>');
  const host = document.querySelector('vera-spinner');
  advance(50);
  document.querySelector('#b').append(host);
  await settle();
  advance(LATER);
  host.remove();
  document.querySelector('#a').append(host);
  await settle();
  advance(LATER);
  assert.deepEqual(said(), ['Loading']);
});

test('a framework replacing its spinner with a new element every 100 ms for 1 s says it once, and its done label once', async () => {
  await fresh('<div id="list"></div>');
  const list = document.querySelector('#list');
  for (let i = 0; i < 10; i++) {
    list.innerHTML = '<vera-spinner label="Loading" done-label="Loaded"></vera-spinner>';
    await settle();
    advance(100);
  }
  assert.deepEqual(said(), ['Loading'], 'one load while it lasts');
  list.innerHTML = '';
  await settle();
  advance(LATER);
  assert.deepEqual(said(), ['Loading', 'Loaded']);
});

test('done-label is said once when the spinner leaves, after its grace', async () => {
  await fresh('<vera-spinner label="Saving" done-label="Saved"></vera-spinner>');
  advance(LATER);
  document.querySelector('vera-spinner').remove();
  await settle();
  advance(LATER);
  assert.deepEqual(said(), ['Saving', 'Saved']);
});

test('a label changed while it spins is a new load: the old one ends, the new one is said', async () => {
  await fresh('<vera-spinner label="Loading" done-label="Done"></vera-spinner>');
  advance(LATER);
  document.querySelector('vera-spinner').setAttribute('label', 'Saving');
  await settle();
  advance(LATER);
  assert.deepEqual(said(), ['Loading', 'Done', 'Saving']);
});

test('an owner that sets aria-busy one task after the spinner connects keeps it silent (the owner speaks)', async () => {
  await fresh('<div id="owner"><vera-spinner label="Loading"></vera-spinner></div><vera-spinner label="Saving"></vera-spinner>');
  advance(0);
  document.querySelector('#owner').setAttribute('aria-busy', 'true');
  advance(LATER);
  assert.deepEqual(said(), ['Saving'], 'CONTROL: the free spinner in the same window is said');
  assert.deepEqual(warned, []);
});

test('development warns spinner-silent once for a spinner with no label and no busy owner, after the window', async () => {
  await fresh('<vera-spinner></vera-spinner><div aria-busy="true"><vera-spinner></vera-spinner></div>');
  advance(100);
  assert.deepEqual(warned, [], 'not inside the window: an owner may still come');
  advance(LATER);
  assert.deepEqual(codes(), isProduction ? [] : ['spinner-silent'], 'one, for the spinner outside the busy owner');
  if (!isProduction) assert.match(warned[0], /^\[vera\] /);
  assert.deepEqual(said(), []);
});

test('a hostile label is text: no element is made from it, shown or said', async () => {
  const hostile = '<img src=x onerror="globalThis.pwned=1">';
  await fresh('<vera-spinner show-label></vera-spinner>');
  const host = document.querySelector('vera-spinner');
  host.setAttribute('label', hostile);
  await settle();
  advance(LATER);
  assert.equal(document.querySelector('img'), null);
  assert.equal(host.querySelector('[data-vera-part="label"]').textContent, hostile);
  assert.deepEqual(said(), [hostile]);
});

test('show-label shows the label as plain text after the arc, and follows it', async () => {
  await fresh('<vera-spinner label="Loading" show-label></vera-spinner>');
  const host = document.querySelector('vera-spinner');
  const parts = () => [...host.children].map((child) => child.getAttribute('data-vera-part'));
  assert.deepEqual(parts(), ['arc', 'label']);
  assert.equal(host.querySelector('[data-vera-part="label"]').textContent, 'Loading');
  host.setAttribute('label', 'Saving');
  await settle();
  assert.equal(host.querySelector('[data-vera-part="label"]').textContent, 'Saving');
  host.removeAttribute('show-label');
  await settle();
  assert.deepEqual(parts(), ['arc']);
});
