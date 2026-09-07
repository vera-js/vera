/**
 * The query pack — `route`, `query`, `region`: state that lives in the URL, and lists that answer
 * to it.
 *
 * The claims worth testing are the ones a hand-rolled version gets wrong: that a shared LINK
 * reproduces what the sender saw (the URL beats the markup's seed), that a search box does not
 * fill the history stack, that a stale `page` in a link is clamped rather than showing a void,
 * and that a directive which both reads and writes state reaches a FIXED POINT instead of
 * spinning. The last one is the reason `region` compares before writing, and a test that only
 * checked the visible rows would never notice it.
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

const { wireDirectives, interaction, expressions, query, settled, rejections, stateOf } =
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
const shown = (host) => [...host.querySelectorAll('li')].filter((li) => !li.hidden).map((li) => li.textContent);

const LIST = `
  <ul data-vd-region="{ items: 'li', search: 'q', facets: 'tag', page: 'page', size: 2, counts: 'counts' }">
    <li data-tag="fruit">apple</li>
    <li data-tag="fruit">banana</li>
    <li data-tag="tool">chisel</li>
    <li data-tag="tool">drill</li>
    <li data-tag="fruit">elderberry</li>
  </ul>`;

test('route publishes @route, and expressions read it', async () => {
  url('/list?tab=details#notes');
  const host = await mount(`
    <div data-vd-route>
      <b data-vd-text="@route.path"></b>
      <i data-vd-text="@route.query.tab"></i>
      <u data-vd-text="@route.hash"></u>
    </div>`);
  assert.equal(host.querySelector('b').textContent, '/list');
  assert.equal(host.querySelector('i').textContent, 'details', 'the query string is walkable');
  assert.equal(host.querySelector('u').textContent, 'notes');

  /** A navigation the pack did not cause still reaches it — popstate, or the router's own event. */
  url('/other?tab=summary');
  dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  await settled();
  assert.equal(host.querySelector('b').textContent, '/other', 'republished on navigation');
  assert.equal(host.querySelector('i').textContent, 'summary');
  host.remove();
  await settled();
});

test('THE LINK WINS: a shared URL beats the markup seed', async () => {
  url('/list?q=ban&page=3');
  const host = await mount(`
    <div data-vd-state="{ q: '', page: 1 }" data-vd-query="q page">
      <b data-vd-text="q"></b><i data-vd-text="page"></i>
    </div>`);
  assert.equal(host.querySelector('b').textContent, 'ban', 'the URL replaced the seed');
  assert.equal(host.querySelector('i').textContent, '3', 'and numbers come back as numbers');
  const carrier = host.querySelector('[data-vd-state]');
  assert.equal(typeof stateOf(carrier).page, 'number', 'so arithmetic on page works');
  host.remove();
  await settled();
});

test('a state change writes the URL — and does NOT grow the history stack', async () => {
  url('/list');
  const host = await mount(`
    <div data-vd-state="{ q: '' }" data-vd-query="q">
      <input data-vd-sync="q" />
    </div>`);
  const depth = dom.window.history.length;
  const input = host.querySelector('input');
  for (const text of ['a', 'ap', 'app']) {
    input.value = text;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await settled();
  }
  assert.match(dom.window.location.search, /q=app/, 'the URL followed the box');
  assert.equal(dom.window.history.length, depth,
    'replaceState, not pushState — a search box must not make the back button useless');

  /** An emptied key leaves the URL rather than sitting there as `?q=`. */
  input.value = '';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await settled();
  assert.equal(dom.window.location.search, '', 'empty means absent — a clean link');
  host.remove();
  await settled();
});

test('region filters by search over item text, and by facet over data fields', async () => {
  url('/list');
  const host = await mount(`<div data-vd-state="{ q: '', tag: '', page: 1, counts: {} }">${LIST}</div>`);
  assert.deepEqual(shown(host), ['apple', 'banana'], 'page 1 of 5 at size 2');

  const carrier = host.querySelector('[data-vd-state]');
  stateOf(carrier).q = 'ber';
  await settled();
  assert.deepEqual(shown(host), ['elderberry'], 'text search matched one');

  stateOf(carrier).q = '';
  stateOf(carrier).tag = 'tool';
  await settled();
  assert.deepEqual(shown(host), ['chisel', 'drill'], 'the facet matched the data field');

  /** An unset facet is not a filter — the commonest mistake in hand-rolled versions. */
  stateOf(carrier).tag = '';
  await settled();
  assert.deepEqual(shown(host), ['apple', 'banana'], 'cleared facet restored everything (page 1)');
  host.remove();
  await settled();
});

test('counts come back as state, so the page renders its own results line and controls', async () => {
  url('/list');
  const host = await mount(`
    <div data-vd-state="{ q: '', tag: '', page: 1, counts: {} }">
      ${LIST}
      <b data-vd-text="counts.matched"></b>
      <i data-vd-text="counts.pages"></i>
      <button data-vd-on-click="{ page: page + 1 }" data-vd-show="page < counts.pages">next</button>
    </div>`);
  assert.equal(host.querySelector('b').textContent, '5', 'matched');
  assert.equal(host.querySelector('i').textContent, '3', 'pages at size 2');
  assert.equal(host.querySelector('button').hidden, false, 'next is offered on page 1');

  host.querySelector('button').click();
  await settled();
  assert.deepEqual(shown(host), ['chisel', 'drill'], 'the click paged forward');

  const carrier = host.querySelector('[data-vd-state]');
  stateOf(carrier).q = 'ber';
  await settled();
  assert.equal(host.querySelector('i').textContent, '1', 'a narrower search means fewer pages');
  assert.equal(host.querySelector('button').hidden, true, 'and next stops being offered');
  host.remove();
  await settled();
});

test('a stale page in a link is CLAMPED, never an empty void — and written back', async () => {
  url('/list?page=99');
  const host = await mount(`
    <div data-vd-state="{ q: '', tag: '', page: 1, counts: {} }" data-vd-query="page">${LIST}</div>`);
  assert.deepEqual(shown(host), ['elderberry'], 'page 99 of 3 showed the last page');
  const carrier = host.querySelector('[data-vd-state]');
  assert.equal(stateOf(carrier).page, 3, 'and the clamp was written back to state');
  assert.match(dom.window.location.search, /page=3/, 'so the URL agrees with what is on screen');
  host.remove();
  await settled();
});

test('THE FIXED POINT: a directive that reads and writes state settles instead of spinning', async () => {
  url('/list');
  const host = await mount(`<div data-vd-state="{ q: '', tag: '', page: 1, counts: {} }">${LIST}</div>`);
  const carrier = host.querySelector('[data-vd-state]');
  const first = stateOf(carrier).counts;

  /** Settle repeatedly: an unguarded write-on-every-run would keep re-running for ever, and the
   *  object identity would change on each pass. */
  for (let i = 0; i < 5; i++) await settled();
  assert.equal(stateOf(carrier).counts, first,
    'counts were written once and then left alone — the compare-before-write is load-bearing');
  assert.deepEqual(shown(host), ['apple', 'banana'], 'and the view is unchanged');
  host.remove();
  await settled();
});

test('items keep their own directives — region only hides, it never rebuilds', async () => {
  url('/list');
  const host = await mount(`
    <div data-vd-state="{ q: '', tag: '', page: 1, counts: {}, taps: 0 }">
      <ul data-vd-region="{ items: 'li', search: 'q', counts: 'counts' }">
        <li data-tag="fruit"><button data-vd-on-click="{ taps: taps + 1 }">apple</button></li>
        <li data-tag="tool">chisel</li>
      </ul>
      <b data-vd-text="taps"></b>
    </div>`);
  const carrier = host.querySelector('[data-vd-state]');
  host.querySelector('button').click();
  await settled();
  assert.equal(host.querySelector('b').textContent, '1', "the item's own handler works");

  stateOf(carrier).q = 'chis';
  await settled();
  stateOf(carrier).q = '';
  await settled();
  /** The element was hidden and shown again — the same node, never re-created, so its directive
   *  instance survived and no re-activation was needed. */
  host.querySelector('button').click();
  await settled();
  assert.equal(host.querySelector('b').textContent, '2', 'and still works after being filtered out and back');
  host.remove();
  await settled();
});

test('refusals: a region without an object, a query without keys', async () => {
  url('/list');
  const host = await mount(`
    <div data-vd-state="{ n: 0 }">
      <ul id="bad" data-vd-region="oops"></ul>
      <div id="empty" data-vd-query="  "></div>
    </div>`);
  assert.ok(rejections(host.querySelector('#bad')).some((r) => r.code === 'region-not-object'));
  assert.ok(rejections(host.querySelector('#empty')).some((r) => r.code === 'query-no-keys'));
  if (!isProduction) {
    assert.ok(rejections(host.querySelector('#empty')).some((r) => /one or more state keys/.test(r.message)));
  }
  host.remove();
  await settled();
});
