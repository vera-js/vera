/**
 * The `until()` example in the renderer README, executed.
 *
 * `packages/renderer/README.md` presents the `_$child$` protocol and then says *"that is the whole
 * surface: `until()` is nine lines against it"*, and prints those nine lines. They cannot carry a
 * `<!-- recipe -->` marker, because the block deliberately leaves `fetchUser` and `host` to the
 * reader — so `tests/docs-recipes.test.mjs` has never run it.
 *
 * That combination — a short, confident, load-bearing example that nothing executes — is where this
 * project's last two documentation defects were: `llms.txt`'s buildless recipe wired the render
 * *function* where `wire` wants the module, and its import-map comment named the wrong package for
 * an injected import. Both were copied-from files nobody ran.
 *
 * So the block is lifted **out of the README** rather than restated here, and run with only those
 * two names supplied. If someone edits the example, this runs the edit; if someone changes the
 * protocol, this runs the example against the change.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent',
])
  globalThis[key] = dom.window[key];

const { html, wire } = await load('core');
const { renderer, renderInto } = await load('renderer');
wire([renderer]);

const README = readFileSync(new URL('../packages/renderer/README.md', import.meta.url), 'utf8');
const strip = (host) => host.innerHTML.replace(/<!---->/g, '');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The example, taken from the README. Anchored on its own first comment and last line so an edit to
 * the surrounding prose does not change what is executed — and so a *deleted* example fails here
 * rather than silently stopping being checked.
 */
const extract = () => {
  const block = /\/\*\* Hoisted[\s\S]*?renderInto\(html`<p>\$\{until\(fetchUser\(\), html`<em>loading…<\/em>`\)\}<\/p>`, host\);/.exec(README);
  assert.ok(block, 'the `until()` example is gone from packages/renderer/README.md, or its shape changed');
  return block[0];
};

/** Runs the block with the two names it leaves to the reader, and hands back what it defined. */
const runExample = (host, fetchUser) =>
  new Function('html', 'renderInto', 'host', 'fetchUser', `${extract()}\nreturn { until };`)(
    html,
    renderInto,
    host,
    fetchUser
  );

test('the documented until() renders its placeholder and then its value', async () => {
  const host = document.createElement('div');
  let resolve;
  runExample(host, () => new Promise((r) => { resolve = r; }));
  assert.equal(strip(host), '<p><em>loading…</em></p>', 'the placeholder should render immediately');
  resolve('Ada');
  await settle();
  assert.equal(strip(host), '<p>Ada</p>', 'the resolved value should replace the placeholder');
});

/**
 * The rule the example exists to demonstrate: continuity lives in the return value. Rendering the
 * same promise again must recognise it and do nothing, rather than committing the placeholder over
 * a value that has already arrived.
 */
test('rendering the same promise again does not restart it', async () => {
  const host = document.createElement('div');
  const { until } = runExample(host, () => Promise.resolve('ignored'));
  const promise = Promise.resolve('Grace');
  /** **One `draw`, called twice.** Written as two template literals these are two *templates*, so
   * the part is torn down between them and `previous` is correctly `undefined` — which looks exactly
   * like the continuity rule failing. `CLAUDE.md` names this trap and it caught this file first. */
  const draw = () => html`<p>${until(promise, html`<em>loading…</em>`)}</p>`;
  renderInto(draw(), host);
  await settle();
  assert.equal(strip(host), '<p>Grace</p>');
  renderInto(draw(), host);
  assert.equal(strip(host), '<p>Grace</p>', 'the placeholder was committed over a value already there');
});

/**
 * And the half that makes `previous.live = false` worth the line: a promise that has been superseded
 * must not overwrite the newer one when it eventually settles. Without it the page shows whichever
 * request happened to be slowest.
 */
test('a superseded promise does not overwrite the newer one', async () => {
  const host = document.createElement('div');
  const { until } = runExample(host, () => Promise.resolve('ignored'));
  let resolveSlow;
  const slow = new Promise((r) => { resolveSlow = r; });
  const draw = (promise) => html`<p>${until(promise, html`<em>loading…</em>`)}</p>`;
  renderInto(draw(slow), host);
  renderInto(draw(Promise.resolve('FAST')), host);
  await settle();
  assert.equal(strip(host), '<p>FAST</p>');
  resolveSlow('STALE');
  await settle();
  assert.equal(strip(host), '<p>FAST</p>', 'a superseded promise overwrote a newer value');
});

/**
 * The first of the three traps the README names, asserted as a trap: written as an object-literal
 * method the applier is a new function per call, so the part cannot recognise it and `previous` is
 * always `undefined`. Kept here because it is the mistake the hoisting rule exists to prevent, and a
 * rule with no demonstration is a rule people talk themselves out of.
 */
test('an applier that is not hoisted never sees its previous state', () => {
  const seen = [];
  /** Deliberately wrong: a fresh function on every call. */
  const unhoisted = (value) => ({
    _$child$(part, previous) {
      seen.push(previous);
      part._$commit$(value);
      return { value };
    },
  });
  const host = document.createElement('div');
  /** One `draw` for the same reason as above: two literals would rebuild the part and hide the point. */
  const drawUnhoisted = (value) => html`<p>${unhoisted(value)}</p>`;
  renderInto(drawUnhoisted('a'), host);
  renderInto(drawUnhoisted('b'), host);
  assert.deepEqual(seen, [undefined, undefined], 'an unhoisted applier should never be handed previous state');

  /** And the hoisted form does see it, which is the whole difference. */
  const hoistedSeen = [];
  function applyHoisted(part, previous) {
    hoistedSeen.push(previous);
    part._$commit$(this.value);
    return { value: this.value };
  }
  const hoisted = (value) => ({ _$child$: applyHoisted, value });
  const other = document.createElement('div');
  const drawHoisted = (value) => html`<p>${hoisted(value)}</p>`;
  renderInto(drawHoisted('a'), other);
  renderInto(drawHoisted('b'), other);
  assert.equal(hoistedSeen.length, 2);
  assert.equal(hoistedSeen[0], undefined, 'the first pass has nothing previous');
  assert.deepEqual(hoistedSeen[1], { value: 'a' }, 'the second pass is handed what the first returned');
});
