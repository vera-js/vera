/**
 * Whether event bindings accumulate, counted the way pass 108 counted DOM churn.
 *
 * A renderer that re-attaches a handler on every pass leaks one per render. Nothing in a correctness
 * suite can see it — the button works, the latest closure runs, and the page simply gets heavier for
 * as long as it is open. Unlike retention this needs **no `gc()`**: `addEventListener` and
 * `removeEventListener` are countable directly, so the numbers are deterministic.
 *
 * ## One call site, or the numbers are wrong
 *
 * `CLAUDE.md`: *"Two template literals are two templates, even with identical text."* The first
 * version of this measurement re-rendered through a second literal with the same markup, got **one**
 * extra listener out of fifty renders, and that one was a rebuild caused by the measurement rather
 * than anything the renderer did. Every case below draws through a single `draw()`.
 *
 * ## What is pinned
 *
 * That re-rendering attaches nothing, that a keyed reverse attaches nothing, and that a fresh row
 * costs exactly one. Explicit `removeEventListener` on teardown is deliberately **not** required: a
 * discarded node takes its listeners with it, so removing them by hand would be work with no effect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'MouseEvent',
])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer, renderInto } = await load('renderer');
const { html } = await load('renderer/tag');
const { keyed } = await load('renderer/keyed');
core.wire([renderer]);

/** Every node inherits these, so wrapping the prototype counts all of them. */
const traffic = (work) => {
  const proto = dom.window.EventTarget.prototype;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  const counts = { added: 0, removed: 0 };
  proto.addEventListener = function (...args) { counts.added++; return add.apply(this, args); };
  proto.removeEventListener = function (...args) { counts.removed++; return remove.apply(this, args); };
  try { work(); } finally { proto.addEventListener = add; proto.removeEventListener = remove; }
  return counts;
};

test('re-rendering a binding attaches nothing after the first pass', () => {
  const into = dom.window.document.createElement('div');
  const draw = (i) => renderInto(html`<button @click=${() => i}>${i}</button>`, into);

  /** The control: without this, "zero added" would also describe an instrument that sees nothing. */
  assert.deepEqual(traffic(() => draw(0)), { added: 1, removed: 0 }, 'the first render attached one');

  assert.deepEqual(
    traffic(() => { for (let i = 1; i <= 200; i++) draw(i); }),
    { added: 0, removed: 0 },
    '200 re-renders should swap the handler in place, not re-attach it'
  );
});

test('and the handler that fires is the latest one', () => {
  const into = dom.window.document.createElement('div');
  let seen = null;
  const draw = (i) => renderInto(html`<button @click=${() => { seen = i; }}>${i}</button>`, into);
  for (const value of [1, 2, 3]) draw(value);

  into.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(seen, 3, 'the binding was updated, not merely left alone');
});

/**
 * **A handler that comes and goes must still fire exactly once.**
 *
 * `renderer.ts` records the original failure — *"`function -> undefined -> function` registers
 * twice"* — and the fix was making the part object itself the listener rather than a closure, so the
 * DOM de-duplicates the repeated `addEventListener`. Counting calls cannot see whether that still
 * holds: twenty on/off cycles issue twenty calls either way, and the difference is whether the DOM
 * folded them into one registration or kept twenty.
 *
 * So this asserts the thing that actually matters, and it is what fails the day the listener becomes
 * a closure again: **one click, one call.**
 */
test('a handler cycled off and on still fires exactly once', () => {
  const into = dom.window.document.createElement('div');
  let fired = 0;
  const draw = (handler) => renderInto(html`<button @click=${handler}>x</button>`, into);

  for (let i = 0; i < 20; i++) {
    draw(undefined);
    draw(() => { fired++; });
  }

  into.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(fired, 1, 'twenty attach cycles must not mean twenty registrations');
});

test('a keyed list costs one listener per row, and a reverse costs none', () => {
  const into = dom.window.document.createElement('div');
  const ids = Array.from({ length: 100 }, (_, i) => `r${i}`);
  const rows = (list) =>
    renderInto(html`<ul>${list.map((id) => keyed(id, html`<li @click=${() => id}>${id}</li>`))}</ul>`, into);

  assert.equal(traffic(() => rows(ids)).added, 100, 'one per row');

  assert.deepEqual(
    traffic(() => rows([...ids].reverse())),
    { added: 0, removed: 0 },
    'a reverse moves the rows, and their handlers travel with them'
  );
});

/**
 * Dropping the rows attaches nothing, and re-adding costs one each because the nodes are new. The
 * absence of `removeEventListener` is not asserted: a discarded node carries its listeners away, so
 * removing them by hand would be work with no effect, and requiring it would pin an implementation
 * choice rather than a property.
 */
test('dropping rows costs nothing, and re-adding costs one each', () => {
  const into = dom.window.document.createElement('div');
  const ids = Array.from({ length: 100 }, (_, i) => `d${i}`);
  const rows = (list) =>
    renderInto(html`<ul>${list.map((id) => keyed(id, html`<li @click=${() => id}>${id}</li>`))}</ul>`, into);

  rows(ids);
  assert.equal(traffic(() => rows([])).added, 0, 'tearing down attaches nothing');
  assert.equal(traffic(() => rows(ids)).added, 100, 're-adding builds fresh nodes');
});
