/** Keep-alive prototype pins (vera-5a): a move keeps a component alive; everything else tears down as before. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';
const dom = new JSDOM('<!doctype html><body><iframe></iframe></body>', { pretendToBeVisual: true });
for (const k of ['window','document','HTMLElement','customElements','Node','Element','DocumentFragment','Text','Comment','Event','CustomEvent','requestAnimationFrame','cancelAnimationFrame','MutationObserver']) globalThis[k] = dom.window[k];
const { html, wire, init, render, useEffect } = await load('core');
const { renderer, renderInto } = await load('renderer');
const { slots } = await load('renderer/slots');
wire([renderer, slots]);
const doc = dom.window.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => setTimeout(r, 0)));
const log = [];
customElements.define('ka-kid', class extends dom.window.HTMLElement {
  connectedCallback() { log.push(`setup ${this.id}`); init(this); useEffect(() => () => log.push(`cleanup ${this.id}`)); render(() => html`<i>${this.id}</i>`); }
  disconnectedCallback() { log.push(`dc ${this.id}`); }
});
customElements.define('ka-host', class extends dom.window.HTMLElement {
  connectedCallback() { init(this); renderInto(html`<header><slot name="a"></slot></header><main><slot></slot></main>`, this); }
});

test('a slotted component sets up ONCE on its first distribution (it is moved, not removed)', async () => {
  log.length = 0;
  const page = doc.createElement('div'); doc.body.append(page);
  renderInto(html`<ka-host><ka-kid id="k1" slot="a"></ka-kid><ka-kid id="k2"></ka-kid></ka-host>`, page);
  await frame(); await tick();
  assert.deepEqual(log.filter((l) => l.startsWith('setup')), ['setup k1', 'setup k2'], 'each kid set up exactly once');
  assert.deepEqual(log.filter((l) => !l.startsWith('setup')), [], 'and nothing was torn down');
  assert.equal(page.querySelector('header ka-kid')?.id, 'k1', 'CONTROL: k1 really was moved into the named slot');
  page.remove(); await tick();
});

test('a same-tick remove + re-add keeps the component; a real removal tears it down a microtask later', async () => {
  log.length = 0;
  const kid = doc.createElement('ka-kid'); kid.id = 'm'; doc.body.append(kid); await frame();
  doc.body.prepend(kid);                      // a move: out and back in, same task
  await tick();
  assert.deepEqual(log, ['setup m'], 'moved: no dc, no cleanup, no second setup');
  kid.remove();
  assert.deepEqual(log, ['setup m'], 'removed: nothing yet, in this task');
  await tick();
  assert.deepEqual(log, ['setup m', 'dc m', 'cleanup m'], 'and the full teardown, once, at the microtask');
});

test('a move into ANOTHER document is a real teardown and setup (vera-5a pin 1)', async () => {
  log.length = 0;
  const other = doc.querySelector('iframe').contentDocument;
  const kid = doc.createElement('ka-kid'); kid.id = 'x'; doc.body.append(kid); await frame();
  other.body.append(kid);                     // same task, another document
  await tick();
  assert.equal(log.filter((l) => l === 'cleanup x').length, 1, 'cleanup ran once');
  assert.ok(log.filter((l) => l === 'setup x').length >= 1, 'set up at least once — the other document has no definition here');
});

test('a cleanup registered between the disconnect and the flush runs in the flush, exactly once (pin 3)', async () => {
  log.length = 0;
  let late = 0;
  const kid = doc.createElement('ka-kid'); kid.id = 'r'; doc.body.append(kid); await frame();
  kid.remove();
  kid._cleanups.add(() => late++);            // registered while parted, before the microtask
  await tick();
  assert.equal(late, 1, 'ran in the flush');
  await tick();
  assert.equal(late, 1, 'and only once');
});

test('a subtree removal tears down in disconnect order, parent before child (pin 5)', async () => {
  /** ka-kid is a dash-named element, so with slots wired a child appended to it is light content it has no slot for;
   *  a host with a <slot> for it keeps the subtree connected, which is the case this pin is about. */
  log.length = 0;
  const outer = doc.createElement('ka-host');
  const inner = doc.createElement('ka-kid'); inner.id = 'c';
  const mid = doc.createElement('ka-kid'); mid.id = 'p';
  outer.append(mid, inner); doc.body.append(outer); await frame(); await tick();
  log.length = 0;
  outer.remove(); await tick();
  assert.deepEqual(log.filter((l) => l.startsWith('dc')), ['dc p', 'dc c'], 'the platform order: tree order');
});
