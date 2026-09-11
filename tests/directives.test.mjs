/**
 * @verajs/directives — the phase-1 vertical slice, end to end: wire, activation, context with
 * per-key owner resolution, delegated events, churn (add/remove/change), rejections, cloak, and
 * settled(). The engine's reactive half is core's createHook, so state writes re-run reflections
 * on core's scheduler — every wait here is settled(), never a sleep-and-hope.
 *
 * **This file is also the STANDALONE certification.** It imports nothing but the directives
 * bundle — no core, no renderer — so the production run (min bundle, every dependency inlined)
 * proves one script tag works on a page with zero other vera code. Do not add a vera import to
 * this file; a case needing one belongs in a separate interop suite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'CSSStyleSheet']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, interactions, settled, rejections, describeDirectives, stateOf } =
  await load('directives');
const doc = dom.window.document;

/** Wire once for the whole file — the registry is module state, like every vera registry. */
wireDirectives(interactions);

const mount = (html) => {
  const host = doc.createElement('div');
  host.innerHTML = html;
  doc.body.appendChild(host);
  return host;
};

test('the vertical slice: state + show + class + on-click, live on a page', async () => {
  const host = mount(`
    <div data-vd-state="{ open: false }">
      <button data-vd-on-click="{ open: !open }">Menu</button>
      <nav data-vd-show="open" data-vd-class="{ is-open: open }">links</nav>
    </div>`);
  await settled();
  const nav = host.querySelector('nav');
  const button = host.querySelector('button');
  assert.equal(nav.hidden, true, 'closed at activation — show reflected the initial state');
  assert.equal(nav.classList.contains('is-open'), false);

  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true }));
  await settled();
  assert.equal(nav.hidden, false, 'the click toggled open, show re-applied');
  assert.equal(nav.classList.contains('is-open'), true, 'and class re-applied from the same write');

  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true }));
  await settled();
  assert.equal(nav.hidden, true, 'and back');
  host.remove();
});

test('per-key owner resolution: shadowing, and a key the inner state does not own', async () => {
  const host = mount(`
    <div data-vd-state="{ theme: 'dark', open: false }">
      <section data-vd-state="{ open: true }">
        <i data-vd-show="open"></i>
        <b data-vd-class="{ dark: theme }"></b>
        <button data-vd-on-click="{ open: false, theme: 'light' }">x</button>
      </section>
    </div>`);
  await settled();
  const i = host.querySelector('i');
  const b = host.querySelector('b');
  assert.equal(i.hidden, false, 'inner open (true) shadows outer open (false)');
  assert.equal(b.classList.contains('dark'), true, 'theme resolves through to the OUTER owner');

  host.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await settled();
  assert.equal(i.hidden, true, 'the write hit the inner owner of open');
  assert.equal(stateOf(host.querySelector('section')).open, false, 'inner store took the open write');
  assert.equal(host.querySelector('div[data-vd-state]') === null ? null : stateOf(host.firstElementChild).theme, 'light',
    'the theme write walked to the OUTER owner');
  host.remove();
});

test('churn: an inserted subtree activates; a removed one tears down; a changed value rebuilds', async () => {
  const host = mount(`<div data-vd-state="{ n: 1 }"></div>`);
  await settled();
  const carrier = host.firstElementChild;

  carrier.innerHTML = `<p data-vd-show="n">text</p>`;
  await settled();
  const p = carrier.querySelector('p');
  assert.equal(p.hidden, false, 'the inserted reflection activated and read the ancestor state');

  p.setAttribute('data-vd-show', '!n');
  await settled();
  assert.equal(p.hidden, true, 'the changed attribute value re-parsed and re-applied');

  p.remove();
  await settled();
  assert.equal(rejections(p).some((r) => r.code === 'directive-threw'), false, 'removal tore down without a throw');
  host.remove();
});

test('delegation: a swapped-in region works, and key guards beat the bare operand', async () => {
  const host = mount(`
    <div data-vd-state="{ hits: 0, esc: false }">
      <span data-vd-class="{ hit: hits }"></span>
      <section></section>
    </div>`);
  await settled();
  /** The swap: fresh HTML, straight in — the delegation listener predates it on the root. */
  host.querySelector('section').innerHTML = `<button data-vd-on-click="{ hits: 1 }">go</button>
    <input data-vd-on-keydown-enter="{ esc: false }" data-vd-on-keydown="{ esc: true }">`;
  host.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await settled();
  assert.equal(host.querySelector('span').classList.contains('hit'), true,
    'the swapped-in button dispatched through the root listener');

  const input = host.querySelector('input');
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'x', bubbles: true }));
  await settled();
  assert.equal(stateOf(input).esc, true, 'the bare keydown ran');
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settled();
  assert.equal(stateOf(input).esc, false, 'the guarded operand won for Enter');
  host.remove();
});

test('rejections: unknown directive, bad parse, unknown key — recorded, queryable, page intact', async () => {
  const host = mount(`
    <div data-vd-state="{ a: 1 }">
      <p data-vd-nope="x"></p>
      <i data-vd-show="{ broken"></i>
      <b data-vd-class="{ x: missing }"></b>
    </div>`);
  await settled();
  const codes = (el) => rejections(el).map((r) => r.code);
  assert.ok(codes(host.querySelector('p')).includes('unknown-directive'), 'unknown name recorded');
  assert.ok(codes(host.querySelector('i')).length > 0, 'the unparseable value recorded');
  /** unknown-key is a __DEV__ diagnostic — production folds it away and answers undefined calmly. */
  if (!isProduction) assert.ok(codes(host.querySelector('b')).includes('unknown-key'), 'the undeclared key recorded');
  assert.equal(host.querySelector('b').classList.contains('x'), false, 'and calm: missing reads undefined');
  host.remove();
});

test('cloak strips at activation; describeDirectives answers the vocabulary', async () => {
  const host = mount(`<p data-vd-cloak data-vd-show="true">x</p>`);
  await settled();
  assert.equal(host.querySelector('p').hasAttribute('data-vd-cloak'), false, 'cloak stripped');
  const names = describeDirectives().map((d) => d.name);
  for (const n of ['state', 'show', 'class']) assert.ok(names.includes(n), `${n} is introspectable`);
  assert.ok(describeDirectives().every((d) => d.summary), 'every shipped directive carries docs');
  host.remove();
});

test('STORM: no-settle churn sequences end in the state the last write implies', async () => {
  const host = mount(`<div data-vd-state="{ on: false }"></div>`);
  await settled();
  const carrier = host.firstElementChild;
  /** Synchronous storm: insert, re-value, remove, re-insert — nothing settles until the end. */
  for (let round = 0; round < 20; round++) {
    carrier.innerHTML = `<p data-vd-show="on">a</p>`;
    const p = carrier.querySelector('p');
    p.setAttribute('data-vd-show', '!on');
    p.remove();
    carrier.innerHTML = `<em data-vd-show="!on" data-vd-class="{ ok: !on }">b</em>`;
  }
  await settled();
  const em = carrier.querySelector('em');
  assert.equal(em.hidden, false, 'the survivor reflects !on with on=false');
  assert.equal(em.classList.contains('ok'), true);
  assert.equal(rejections().filter((r) => r.code === 'directive-threw').length, 0, 'no instance threw across the storm');
  host.remove();
});

test('tier-1 arrays are literals only: a path inside refuses instead of guessing', async () => {
  /** With no expressions tier wired, the base grammar owns `[...]` — and it holds data, never
   *  paths. The expressions tier deliberately allows more; this suite is the one without it. */
  const host = mount(`<div id="arr" data-vd-state="{ tags: [oops] }"></div>`);
  await settled();
  assert.ok(rejections(host.querySelector('#arr')).some((r) => r.code === 'array-not-literal'),
    'refused with its own code');
  const ok = mount(`<div data-vd-state="{ tags: ['a', 'b'] }"><b data-vd-show="tags">x</b></div>`);
  await settled();
  assert.equal(ok.querySelector('b').hidden, false, 'a literal array seeds and reads truthy');
  host.remove();
  ok.remove();
  await settled();
});
