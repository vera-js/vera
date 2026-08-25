/**
 * `_$child$` — a value at a child position that applies itself.
 *
 * The same idea as `_$apply$` at element position, which is how `@verajs/renderer/spread` ships as
 * a package the renderer knows nothing about. This is the other position worth extending, and the
 * point of it is that a third party can write `until()`, a portal or a virtualizer without the
 * framework growing a directive system: no base class, no factory, no lifecycle — a directive is an
 * object carrying a hoisted applier.
 *
 * Everything below is written the way a *consumer* would write it, against nothing but the public
 * protocol, because that is the claim being tested.
 *
 * Tests BUILT artifacts, development AND production (see ./dist.mjs).
 */
import { load } from './dist.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;

const { render } = await load('renderer');
/** List rendering is a module now; this suite drives the renderer directly, so it uses the
 *  no-registry door rather than `wire([domRender, lists])`. */
const { lists } = await load('renderer/lists');
(await load('renderer')).handle(lists.fn);
const html = (strings, ...values) => ({ _$litType$: 1, strings, values });
const into = () => {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  return container;
};
const read = (container) => container.innerHTML.replace(/<!---->/g, '');

/**
 * The applier is **hoisted**, and that is the contract: its identity is the directive's identity,
 * so the part knows whose `previous` it is holding. An applier written as an object-literal method
 * is a new function per call and would never see its own state — the same reason `spread` hoists
 * `_$apply$`.
 */
function applyUntil(part, previous) {
  if (previous && previous.promise === this.promise) return previous;
  if (previous) previous.live = false;
  const state = { promise: this.promise, live: true };
  part._$commit$(this.placeholder);
  this.promise.then((value) => {
    if (state.live) part._$commit$(value);
  });
  return state;
}
const until = (promise, placeholder) => ({ _$child$: applyUntil, promise, placeholder });

test('a directive renders, keeps its place across renders, and updates asynchronously', async () => {
  const container = into();
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  const draw = () => render(html`<p>${until(promise, html`<em>loading…</em>`)}</p>`, container);

  draw();
  assert.equal(read(container), '<p><em>loading…</em></p>');

  draw();
  assert.equal(read(container), '<p><em>loading…</em></p>', 'a re-render must not restart it');

  resolve(html`<b>done</b>`);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(read(container), '<p><b>done</b></p>');

  draw();
  assert.equal(read(container), '<p><b>done</b></p>', 'and the resolved value survives a re-render');
});

test('a part goes back to an ordinary value afterwards', async () => {
  const container = into();
  const promise = Promise.resolve(html`<b>done</b>`);
  const draw = (value) => render(html`<p>${value}</p>`, container);
  draw(until(promise, html`<em>…</em>`));
  await Promise.resolve();
  await Promise.resolve();
  draw('plain text');
  assert.equal(read(container), '<p>plain text</p>');
});

/**
 * Continuity belongs to the directive that created it. Two different appliers landing on one part
 * across renders must not read each other's state — which would hand one directive another's
 * internals and is the failure mode a shared slot invites.
 */
test('two directives at one part do not share state', () => {
  const seen = [];
  function first(part, previous) {
    seen.push(['first', previous]);
    part._$commit$('one');
    return 'first-state';
  }
  function second(part, previous) {
    seen.push(['second', previous]);
    part._$commit$('two');
    return 'second-state';
  }
  const container = into();
  const draw = (applier) => render(html`<p>${{ _$child$: applier }}</p>`, container);

  draw(first);
  draw(second);
  draw(first);

  assert.deepEqual(seen, [
    ['first', undefined],
    ['second', undefined],
    ['first', undefined],
  ], 'each applier saw only its own history, and none survived the other');
  assert.equal(read(container), '<p>one</p>');
});

test('a directive keeps its state across its own commits, and loses it when the part is cleared', () => {
  const seen = [];
  function counting(part, previous) {
    seen.push(previous);
    part._$commit$(`n=${(previous ?? 0) + 1}`);
    return (previous ?? 0) + 1;
  }
  const container = into();
  const draw = (value) => render(html`<p>${value}</p>`, container);
  const directive = { _$child$: counting };

  draw(directive);
  draw(directive);
  draw(directive);
  assert.deepEqual(seen, [undefined, 1, 2], 'its own rendering did not destroy its continuity');
  assert.equal(read(container), '<p>n=3</p>');

  /** Something else took the part over: the directive's assumptions no longer hold. */
  draw(html`<i>other</i>`);
  draw(directive);
  assert.equal(seen[3], undefined, 'and an external clear reset it');
});

/**
 * The protocol must not disturb what a child position already accepts — the matrices in
 * `render-parity` and `render-update-parity` cover the values themselves; this is the ordering.
 * A template is the common object at a child position and returns before the check is ever read,
 * which is why the check costs the hot path nothing.
 */
test('ordinary child values are unaffected', () => {
  const container = into();
  const draw = (value) => render(html`<p>${value}</p>`, container);
  draw(html`<i>t</i>`);
  assert.equal(read(container), '<p><i>t</i></p>');
  draw(['a', 'b']);
  assert.equal(read(container), '<p>ab</p>');
  const node = dom.window.document.createElement('span');
  draw(node);
  assert.equal(container.querySelector('span'), node);
  draw({ toString: () => 'stringified' });
  assert.equal(read(container), '<p>stringified</p>');
});
