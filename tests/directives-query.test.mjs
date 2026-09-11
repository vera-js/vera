/**
 * The query pack — `route`, `query`, `list`: state that lives in the URL, and lists that answer
 * to it.
 *
 * The claims worth testing are the ones a hand-rolled version gets wrong: that a shared LINK
 * reproduces what the sender saw (the URL beats the markup's seed), that a search box does not
 * fill the history stack, that a stale `page` in a link is clamped rather than showing a void,
 * and that a directive which both reads and writes state reaches a FIXED POINT instead of
 * spinning. The last one is the reason `list` compares before writing, and a test that only
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

const { wireDirectives, interactions, expressions, query, settled, rejections, stateOf } =
  await load('directives');
wireDirectives([expressions, ...interactions, query]);

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
  <ul data-vd-list="{ items: 'li', search: 'q', facets: 'tag', page: 'page', size: 2, counts: 'counts' }">
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

test('list filters by search over item text, and by facet over data fields', async () => {
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

test('items keep their own directives — list only hides, it never rebuilds', async () => {
  url('/list');
  const host = await mount(`
    <div data-vd-state="{ q: '', tag: '', page: 1, counts: {}, taps: 0 }">
      <ul data-vd-list="{ items: 'li', search: 'q', counts: 'counts' }">
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

test('refusals: a list without an object, a query without keys', async () => {
  url('/list');
  const host = await mount(`
    <div data-vd-state="{ n: 0 }">
      <ul id="bad" data-vd-list="oops"></ul>
      <div id="empty" data-vd-query="  "></div>
    </div>`);
  assert.ok(rejections(host.querySelector('#bad')).some((r) => r.code === 'list-not-object'));
  assert.ok(rejections(host.querySelector('#empty')).some((r) => r.code === 'query-no-keys'));
  if (!isProduction) {
    assert.ok(rejections(host.querySelector('#empty')).some((r) => /one or more state keys/.test(r.message)));
  }
  host.remove();
  await settled();
});

/* ── the shop set: sort, ranges, multi-select ────────────────────────────────────────────── */

const SHOP = `
  <div data-vd-state="{ s: '', tag: '', price-min: '', price-max: '' }" data-shop>
    <ul data-vd-list="{ items: 'li', sort: 's', facets: 'tag', ranges: 'price' }">
      <li data-tag="fruit" data-price="3" data-title="banana">banana</li>
      <li data-tag="tool" data-price="12" data-title="chisel">chisel</li>
      <li data-tag="fruit" data-price="1.5" data-title="apple">apple</li>
      <li data-tag="tool" data-title="heirloom">heirloom</li>
    </ul>
  </div>`;

test('sort: state-driven, numeric-aware, and clearing it restores the server order', async () => {
  url('/shop');
  const host = await mount(SHOP);
  const state = stateOf(host.querySelector('[data-shop]'));

  state.s = 'price';
  await settled();
  assert.deepEqual(shown(host), ['apple', 'banana', 'chisel', 'heirloom'],
    'numeric ascending — 1.5 before 3 before 12, the priceless item last');

  state.s = 'price desc';
  await settled();
  assert.deepEqual(shown(host), ['chisel', 'banana', 'apple', 'heirloom'],
    'descending flips the compared, the missing attribute still sorts last');

  state.s = 'title';
  await settled();
  assert.deepEqual(shown(host), ['apple', 'banana', 'chisel', 'heirloom'], 'strings localeCompare');

  state.s = '';
  await settled();
  assert.deepEqual(shown(host), ['banana', 'chisel', 'apple', 'heirloom'],
    'clearing the sort RESTORES the server order — the last sort must not stick in the DOM');
  host.remove();
  await settled();
});

test('ranges: a double bound over data-price; unset bounds are unbounded', async () => {
  url('/shop');
  const host = await mount(SHOP);
  const state = stateOf(host.querySelector('[data-shop]'));

  state['price-min'] = 2;
  await settled();
  assert.deepEqual(shown(host).sort(), ['banana', 'chisel'],
    'min alone: apple (1.5) is out, and so is the item with NO price once a bound is active');

  state['price-max'] = 5;
  await settled();
  assert.deepEqual(shown(host), ['banana'], 'both bounds: only 3 sits inside [2, 5]');

  state['price-min'] = '';
  state['price-max'] = '';
  await settled();
  assert.equal(shown(host).length, 4, 'an unset bound is not a filter');
  host.remove();
  await settled();
});

test('an array facet is a multi-select: any listed value matches, empty is no filter', async () => {
  url('/shop');
  const host = await mount(SHOP);
  const state = stateOf(host.querySelector('[data-shop]'));

  state.tag = ['fruit'];
  await settled();
  assert.deepEqual(shown(host).sort(), ['apple', 'banana'], 'one value selected');

  state.tag = ['fruit', 'tool'];
  await settled();
  assert.equal(shown(host).length, 4, 'OR within the facet — any listed value matches');

  state.tag = [];
  await settled();
  assert.equal(shown(host).length, 4, 'an empty array, like an unset scalar, is not a filter');
  host.remove();
  await settled();
});

test('checkbox groups write the array, and a shared ?tags= link restores it', async () => {
  url('/shop');
  const host = await mount(`
    <div data-vd-state="{ tags: [] }" data-vd-query="tags">
      <input type="checkbox" value="fruit" data-vd-sync="tags">
      <input type="checkbox" value="tool" data-vd-sync="tags">
    </div>`);
  const [fruit, tool] = host.querySelectorAll('input');
  const change = (box, on) => {
    box.checked = on;
    box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };
  change(fruit, true);
  change(tool, true);
  await settled();
  assert.match(dom.window.location.search, /tags=fruit%2Ctool|tags=fruit,tool/,
    'membership rides the URL comma-joined');
  change(fruit, false);
  await settled();
  assert.deepEqual(stateOf(host.firstElementChild).tags, ['tool'], 'unchecking removes');
  host.remove();
  await settled();

  /** The other side of the link: the seed declares the SHAPE, the URL fills it. */
  url('/shop?tags=fruit,tool');
  const second = await mount(`
    <div data-vd-state="{ tags: [] }" data-vd-query="tags">
      <input type="checkbox" value="fruit" data-vd-sync="tags">
    </div>`);
  assert.deepEqual(stateOf(second.firstElementChild).tags, ['fruit', 'tool'],
    'an array seed comes back as an array');
  assert.equal(second.querySelector('input').checked, true, 'and the box shows it');
  second.remove();
  await settled();
});

test('radio groups are single choice; a multi select is the whole array', async () => {
  url('/shop');
  const host = await mount(`
    <div data-vd-state="{ pick: 'b', sizes: ['s'] }">
      <input type="radio" name="p" value="a" data-vd-sync="pick">
      <input type="radio" name="p" value="b" data-vd-sync="pick">
      <select multiple data-vd-sync="sizes">
        <option value="s">small</option><option value="m">medium</option>
      </select>
    </div>`);
  const carrier = host.firstElementChild;
  const [a, b] = host.querySelectorAll('input');
  assert.equal(b.checked, true, 'state wins at activation — the seeded radio is checked');
  assert.equal(a.checked, false);

  a.checked = true;
  a.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await settled();
  assert.equal(stateOf(carrier).pick, 'a', 'checking a radio writes its value');

  const select = host.querySelector('select');
  assert.equal(select.options[0].selected, true, 'the seeded array selected its option');
  select.options[1].selected = true;
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await settled();
  assert.deepEqual(stateOf(carrier).sizes, ['s', 'm'], 'a multi select syncs the whole array');
  host.remove();
  await settled();
});

test('an array literal in the seed pre-selects — the other half of shape-from-seed', async () => {
  url('/shop');
  const host = await mount(`
    <div data-vd-state="{ tags: ['fruit', 'tool'] }">
      <input type="checkbox" value="fruit" data-vd-sync="tags">
      <input type="checkbox" value="tool" data-vd-sync="tags">
      <input type="checkbox" value="other" data-vd-sync="tags">
    </div>`);
  assert.deepEqual([...host.querySelectorAll('input')].map((box) => box.checked), [true, true, false],
    'the seeded values arrive checked');
  host.remove();
  await settled();
});

test('a facet value containing a comma survives the URL round trip', async () => {
  url('/shop');
  const host = await mount(`
    <div data-vd-state="{ tags: [] }" data-vd-query="tags">
      <input type="checkbox" value="a,b" data-vd-sync="tags">
      <input type="checkbox" value="plain" data-vd-sync="tags">
    </div>`);
  const [comma, plain] = host.querySelectorAll('input');
  for (const box of [comma, plain]) {
    box.checked = true;
    box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  }
  await settled();
  const link = dom.window.location.search;
  host.remove();
  await settled();

  /** Open the link fresh: the entry's own comma must not read as a separator. */
  url(`/shop${link}`);
  const second = await mount(`
    <div data-vd-state="{ tags: [] }" data-vd-query="tags">
      <input type="checkbox" value="a,b" data-vd-sync="tags">
    </div>`);
  assert.deepEqual(stateOf(second.firstElementChild).tags, ['a,b', 'plain'],
    'two entries came back, not three');
  assert.equal(second.querySelector('input').checked, true);
  second.remove();
  await settled();
});

test('animate: true — the platform FLIP fires for DISCRETE changes and never for typing', async () => {
  url('/shop');
  /** A stub startViewTransition: jsdom has none, so the test provides the platform. */
  let transitions = 0;
  let namedDuringCallback = 0;
  dom.window.document.startViewTransition = (callback) => {
    transitions++;
    const host2 = dom.window.document.querySelector('[data-shop2]');
    namedDuringCallback = [...host2.querySelectorAll('li')]
      .filter((li) => li.style.getPropertyValue('view-transition-name')).length;
    callback();
    return { finished: Promise.resolve() };
  };
  const host = await mount(`
    <div data-vd-state="{ s: '', q: '' }" data-shop2>
      <ul data-vd-list="{ items: 'li', sort: 's', search: 'q', animate: true }">
        <li data-price="3">b</li><li data-price="1">a</li><li data-price="2">c</li>
      </ul>
    </div>`);
  const state = stateOf(host.querySelector('[data-shop2]'));

  state.s = 'price';
  await settled();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(transitions, 1, 'a SORT is discrete: one transition');
  assert.ok(namedDuringCallback > 0, 'movers carried transient view-transition-names');
  assert.deepEqual(shown(host), ['a', 'c', 'b'], 'and the reorder landed through the async commit');
  assert.equal([...host.querySelectorAll('li')].filter((li) => li.style.getPropertyValue('view-transition-name')).length,
    0, 'names cleared after finished — transient, measured clean');

  state.q = 'a';
  await settled();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(transitions, 1, 'TYPING never animates — the per-keystroke global transition is the jank omni measured');
  assert.deepEqual(shown(host), ['a'], 'the filter still applied, instantly');

  delete dom.window.document.startViewTransition;
  host.remove();
  await settled();
});

test("the async-commit scope pin: a DEFERRED transition callback breaks nothing (omni's trap)", async () => {
  url('/shop');
  /** The platform defers the mutation callback — directive scope is long gone when it runs.
   *  Omni's programs broke exactly here; ours must not, because commit closes over plain data. */
  dom.window.document.startViewTransition = (callback) => {
    const finished = new Promise((resolve) => setTimeout(() => { callback(); resolve(); }, 60));
    return { finished };
  };
  const host = await mount(`
    <div data-vd-state="{ s: '', c: {} }" data-shop3>
      <ul data-vd-list="{ items: 'li', sort: 's', counts: 'c', animate: true }">
        <li data-price="2">x</li><li data-price="1">y</li>
      </ul>
      <b data-vd-text="c.matched"></b>
    </div>`);
  const state = stateOf(host.querySelector('[data-shop3]'));
  state.s = 'price';
  await settled();
  assert.equal(host.querySelector('b').textContent, '2',
    'counts wrote SYNCHRONOUSLY — state never waits on the transition');
  assert.deepEqual(shown(host), ['x', 'y'], 'DOM not yet committed (deferred)');
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(shown(host), ['y', 'x'], 'the deferred commit landed, no scope needed');
  assert.equal(rejections().filter((r) => r.code === 'directive-threw').length, 0, 'nothing threw');
  delete dom.window.document.startViewTransition;
  host.remove();
  await settled();
});
