/**
 * **`watch` — reacting to a state change you did not author.**
 *
 * The motivating case needs stating precisely, because the obvious version of it was ALREADY
 * handled and I spent several passes repeating a premise that measurement disproved: `list`
 * clamps `page` to the page count, so narrowing a search until the results shrink past your page
 * moves you back on its own. What no clamp can catch is a new query whose results are still long —
 * type a fresh search on page 4 of 8 and you land on page 4 of the NEW results, which no reader
 * expects and no existing behaviour prevents.
 *
 * The two claims that make it correct rather than merely working are the ones a naive version gets
 * wrong: it must NOT fire on the first pass (or a shared link's `page` is destroyed at load, by the
 * very pack the link feature belongs to), and a watch that feeds itself must stop and say so rather
 * than hang the page.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/list' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'CSSStyleSheet', 'location', 'history', 'PopStateEvent']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, expressions, interaction, query, settled, rejections, stateOf } =
  await load('directives');
wireDirectives([expressions, ...interaction, query]);

const doc = dom.window.document;
const url = (path) => dom.window.history.replaceState({}, '', path);
const mount = async (html) => {
  const host = doc.createElement('div');
  host.innerHTML = html;
  doc.body.appendChild(host);
  await settled();
  return host;
};
const ITEMS = ['alpha', 'alto', 'amber', 'ash', 'aspen', 'astor', 'atlas', 'auburn', 'august',
  'aurora', 'bay', 'beech', 'birch', 'bramble', 'briar', 'bronze'];
const LIST = `
  <ul data-vd-list="{ items: 'li', search: 'q', page: 'page', size: 2, counts: 'counts' }">
    ${ITEMS.map((one) => `<li>${one}</li>`).join('')}
  </ul>`;
const shown = (host) => [...host.querySelectorAll('li')].filter((li) => !li.hidden).map((li) => li.textContent);

test('a new query returns to the START of its results, which the clamp cannot do', async () => {
  url('/list');
  const host = await mount(`
    <div data-vd-state="{ q: '', page: 1, counts: {} }" data-vd-watch="{ q: { page: 1 } }">${LIST}</div>`);
  const carrier = host.querySelector('[data-vd-state]');

  stateOf(carrier).page = 4;
  await settled();
  assert.deepEqual(shown(host), ['atlas', 'auburn'], 'the control: paging works and we are mid-list');

  /** 'a' still matches ten items — seven pages — so nothing shrinks past page 4 and the clamp
   *  never fires. Without the watch this stays on page 4 of the new results. */
  stateOf(carrier).q = 'a';
  await settled();
  assert.equal(stateOf(carrier).page, 1, 'the watch reset it');
  assert.deepEqual(shown(host), ['alpha', 'alto'], 'and the reader is looking at the first matches');
  host.remove();
  await settled();
});

test('paging inside a result set does NOT reset — only the watched key does', async () => {
  url('/list');
  const host = await mount(`
    <div data-vd-state="{ q: '', page: 1, counts: {} }" data-vd-watch="{ q: { page: 1 } }">${LIST}</div>`);
  const carrier = host.querySelector('[data-vd-state]');
  stateOf(carrier).page = 3;
  await settled();
  assert.equal(stateOf(carrier).page, 3, 'a watch fires on ITS key changing, not on any re-run');
  assert.deepEqual(shown(host), ['aspen', 'astor']);
  host.remove();
  await settled();
});

test('THE SHARED LINK SURVIVES: a watch does not fire on its first pass', async () => {
  url('/list?q=a&page=3');
  const host = await mount(`
    <div data-vd-state="{ q: '', page: 1, counts: {} }" data-vd-query="q page"
         data-vd-watch="{ q: { page: 1 } }">${LIST}</div>`);
  const carrier = host.querySelector('[data-vd-state]');

  /**
   * The first observation establishes a baseline and nothing else. Firing on it would reset `page`
   * the instant the page loaded — the watch destroying the query pack's guarantee that a shared
   * link reproduces what the sender saw, which is the feature sabotaging the feature it serves.
   */
  assert.equal(stateOf(carrier).q, 'a', 'the link seeded the query');
  assert.equal(stateOf(carrier).page, 3, 'AND its page, un-reset');
  assert.deepEqual(shown(host), ['aspen', 'astor'], 'the reader sees what the sender saw');
  host.remove();
  await settled();
});

test('a watch that feeds itself is STOPPED and says which mistake was made', async () => {
  url('/list');
  const host = await mount(`<div data-vd-state="{ n: 0 }" data-vd-watch="{ n: { n: n + 1 } }"></div>`);
  const carrier = host.querySelector('[data-vd-state]');

  stateOf(carrier).n = 1;
  await settled();
  await settled();

  assert.ok(rejections(carrier).some((r) => r.code === 'watch-loop'),
    'the honest failure is to break the loop and name it, never to let the page hang');
  assert.ok(stateOf(carrier).n < 20, `it stopped rather than ran away (n = ${stateOf(carrier).n})`);
  if (!isProduction) {
    assert.match(rejections(carrier).find((r) => r.code === 'watch-loop').fix, /keys the watch does not read/);
  }
  host.remove();
  await settled();
});

test('refusals: a watch that is not an object, and an entry that is not assignments', async () => {
  url('/list');
  const host = await mount(`
    <div data-vd-state="{ n: 0 }">
      <div id="bad" data-vd-watch="oops"></div>
      <div id="entry" data-vd-watch="{ n: 3 }"></div>
    </div>`);
  assert.ok(rejections(host.querySelector('#bad')).some((r) => r.code === 'watch-not-object'));

  stateOf(host.querySelector('[data-vd-state]')).n = 1;
  await settled();
  assert.ok(rejections(host.querySelector('#entry')).some((r) => r.code === 'watch-entry-not-object'),
    'a watched key whose body is not assignments is refused when it fires, with the key named');
  host.remove();
  await settled();
});

test('an EQUAL object is not a change — identity is not the question', async () => {
  url('/list');
  const host = await mount(`
    <div data-vd-state="{ box: {}, hits: 0 }" data-vd-watch="{ box: { hits: hits + 1 } }"></div>`);
  const carrier = host.querySelector('[data-vd-state]');

  stateOf(carrier).box = { a: 1 };
  await settled();
  assert.equal(stateOf(carrier).hits, 1, 'a real change fires');

  /**
   * `Object.is` was the comparison first, so watching a key holding an OBJECT fired on every
   * republish of an equal value — and the writers that produce these build a fresh object each
   * time (`counts` from `list`, `@route` from the query pack). `watch` now shares the structural
   * comparison the server's fixed-point walk uses, because the two are asking the same question and
   * were about to answer it differently.
   */
  stateOf(carrier).box = { a: 1 };
  await settled();
  assert.equal(stateOf(carrier).hits, 1, 'a NEW object holding the same thing is not a change');
  host.remove();
  await settled();
});

test('the loop cap recovers: a page settles, then works again', async () => {
  url('/list');
  const host = await mount(`
    <div data-vd-state="{ n: 0, seen: 0 }" data-vd-watch="{ n: { seen: seen + 1 } }"></div>`);
  const carrier = host.querySelector('[data-vd-state]');

  /**
   * The counter resets on a pass that fires NOTHING, which is the real settled signal — it reset on
   * a microtask first, and microtasks flush between animation frames, so a watch writing once per
   * frame reset its own counter every frame and could never trip. The consequence to pin is that a
   * page changing a watched key many times over its life is never silenced.
   */
  for (let i = 1; i <= 30; i++) {
    stateOf(carrier).n = i;
    await settled();
  }
  assert.equal(stateOf(carrier).seen, 30, 'thirty separate changes each fired — no cap in sight');
  assert.deepEqual(rejections(carrier).filter((r) => r.code === 'watch-loop'), [],
    'and nothing was mistaken for a loop');
  host.remove();
  await settled();
});
