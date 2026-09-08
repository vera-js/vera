/**
 * **`wireActions` — the one place authored JavaScript enters, by NAME (design §17.4).**
 *
 * The value grammar is bounded on purpose: arithmetic, comparisons, a fixed set of pure functions,
 * no `eval` and no `Function`. That is what lets a reader look at markup and know what it can do.
 * The cost is the last one percent — call an API client, format with `Intl`, run a calculation the
 * tier cannot express — and with no door for it the answer is "write a component", which throws
 * away the whole vocabulary for one line of logic.
 *
 * The properties that make it a door rather than a hole are what this file pins: the attribute
 * NAMES a function and never contains one, the registry is enumerable so "what JavaScript can this
 * page run" has a printable answer, and an action runs only while a handler is firing — otherwise
 * `data-vd-text="checkout()"` would charge a card on every re-render.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver',
  'CSSStyleSheet']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, expressions, interaction, wireActions, describeActions, settled,
  rejections, stateOf } = await load('directives');
wireDirectives([expressions, ...interaction]);

const seen = [];
wireActions({
  slug: (_ctx, _event, text) => String(text).toLowerCase().replace(/\s+/g, '-'),
  checkout: (ctx, event) => {
    seen.push([ctx.get('cart'), event.type]);
    ctx.set('status', 'sent');
    return 'ok';
  },
});

const doc = dom.window.document;
const mount = async (html) => {
  const host = doc.createElement('div');
  host.innerHTML = html;
  doc.body.appendChild(host);
  await settled();
  return host;
};
const click = (host, id) =>
  host.querySelector(`#${id}`).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

test('an action takes arguments from state and its return is written back', async () => {
  const host = await mount(`
    <div data-vd-state="{ title: 'Hello World', out: '' }">
      <button id="go" data-vd-on-click="{ out: slug(title) }">go</button>
    </div>`);
  click(host, 'go');
  await settled();
  assert.equal(stateOf(host.querySelector('[data-vd-state]')).out, 'hello-world',
    'arguments in, value out — the compute case needs nothing but that');
  host.remove();
  await settled();
});

test('an action receives a Ctx and the event, and writes through the same door directives use', async () => {
  const host = await mount(`
    <div data-vd-state="{ cart: 3, status: '', res: '' }">
      <button id="buy" data-vd-on-click="{ res: checkout() }">buy</button>
    </div>`);
  click(host, 'buy');
  await settled();
  const carrier = host.querySelector('[data-vd-state]');
  assert.deepEqual(seen.at(-1), [3, 'click'], 'it read state through ctx and was told which event ran it');
  assert.equal(stateOf(carrier).status, 'sent', 'its write landed in the same store, not a private one');
  assert.equal(stateOf(carrier).res, 'ok', 'and the return value was assigned like any other');
  host.remove();
  await settled();
});

test('AN ACTION MAY NOT RUN IN A REFLECTION — the rule that keeps this a door', async () => {
  const host = await mount(`
    <div data-vd-state="{ title: 'Hello World' }">
      <b id="r" data-vd-text="slug(title)"></b>
    </div>`);
  const codes = rejections(host.querySelector('#r')).map((r) => r.code);
  assert.ok(codes.includes('action-outside-handler'),
    'a reflection re-runs whenever its inputs change, so `data-vd-text="checkout()"` would charge ' +
    'a card on every render — an author reaching for an action is thinking about an event');
  assert.equal(host.querySelector('#r').textContent, '', 'and nothing was rendered from it');
  host.remove();
  await settled();
});

test('an unregistered name is refused at CALL time, with the registry named', async () => {
  const host = await mount(`
    <div data-vd-state="{ out: '' }">
      <button id="bad" data-vd-on-click="{ out: nope() }">x</button>
    </div>`);
  click(host, 'bad');
  await settled();
  const complaint = rejections(host.querySelector('#bad')).find((r) => r.code === 'unknown-action');
  assert.ok(complaint, 'it PARSES now: a registry is dynamic, so a parse-time snapshot of one is wrong');
  if (!isProduction) {
    assert.match(complaint.message, /"nope" is not a pure function or a registered action/);
    assert.match(complaint.fix, /slug|checkout/, 'and the fix lists what IS registered');
  }
  assert.equal(stateOf(host.querySelector('[data-vd-state]')).out, '', 'nothing was written');
  host.remove();
  await settled();
});

test('the registry is enumerable — that is most of why actions are named at all', () => {
  const names = describeActions();
  assert.ok(names.includes('slug') && names.includes('checkout'));
  assert.deepEqual(names, [...names].sort(), 'sorted, so a generated page or a diff does not churn');
  /** THE POINT: "what JavaScript can this page run" has a printable answer. */
  assert.ok(names.length > 0, 'the control');
});
