/**
 * Keyed reconciliation under stress, and the part-mode transitions around it.
 *
 * `renderer.test.mjs` covers the primitives thoroughly; this covers the combinations that only go
 * wrong at scale or when two features meet — duplicate keys, nesting, a thousand-item shuffle,
 * SVG inside a keyed list, refs surviving a reorder. Written during the renderer audit, where
 * every one of them passed first try; they are here so that stays true.
 *
 * The shuffle case is the one worth keeping most: it asserts every element is *reused*, not merely
 * that the text ends up right. A reconciler that silently rebuilds rows produces identical markup
 * and loses focus, scroll position, form state and animation.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<body></body>', { pretendToBeVisual: true });
for (const k of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'Event',
                 'requestAnimationFrame', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[k] = dom.window[k];

const { render, keyed, hold } = await load('renderer');
/** The shape core's `html` and `svg` tags produce, as the other renderer suites do it. */
const html = (strings, ...values) => ({ _$litType$: 1, strings, values });
const svg = (strings, ...values) => ({ _$litType$: 2, strings, values });

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => ok ? pass++ : (fail++, console.log('FAIL:', name, extra));

const host = () => {
  const element = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(element);
  return element;
};
const rows = (element) => [...element.querySelectorAll('li')].map((node) => node.textContent).join(',');

/* ── keyed reconciliation ───────────────────────────────────────────────────────────────────── */
{
  const draw = (element, items) =>
    render(html`<ul>${items.map((item) => keyed(item.k, html`<li>${item.v}</li>`))}</ul>`, element);

  const reorder = host();
  draw(reorder, [{ k: 1, v: 'a' }, { k: 2, v: 'b' }, { k: 3, v: 'c' }]);
  const before = [...reorder.querySelectorAll('li')];
  draw(reorder, [{ k: 3, v: 'c' }, { k: 1, v: 'a' }, { k: 2, v: 'b' }]);
  const after = [...reorder.querySelectorAll('li')];
  check('a reorder moves the same elements', after[0] === before[2] && after[1] === before[0]);
  check('and produces the right order', rows(reorder) === 'c,a,b', rows(reorder));

  const middle = host();
  draw(middle, [{ k: 1, v: 'a' }, { k: 2, v: 'b' }, { k: 3, v: 'c' }]);
  draw(middle, [{ k: 1, v: 'a' }, { k: 3, v: 'c' }]);
  check('removal from the middle', rows(middle) === 'a,c', rows(middle));
  draw(middle, [{ k: 1, v: 'a' }, { k: 2, v: 'b' }, { k: 3, v: 'c' }]);
  check('insertion into the middle', rows(middle) === 'a,b,c', rows(middle));

  const dup = host();
  draw(dup, [{ k: 1, v: 'a' }, { k: 1, v: 'b' }, { k: 2, v: 'c' }]);
  check('duplicate keys do not corrupt the list', rows(dup) === 'a,b,c', rows(dup));

  const churn = host();
  draw(churn, [{ k: 1, v: 'a' }, { k: 2, v: 'b' }, { k: 3, v: 'c' }]);
  draw(churn, [{ k: 4, v: 'd' }, { k: 5, v: 'e' }, { k: 6, v: 'f' }]);
  check('a list where every key changed', rows(churn) === 'd,e,f', rows(churn));

  const emptied = host();
  draw(emptied, [{ k: 1, v: 'a' }]);
  draw(emptied, []);
  const wasEmpty = rows(emptied) === '';
  draw(emptied, [{ k: 2, v: 'b' }]);
  check('list → empty → list', wasEmpty && rows(emptied) === 'b', `${wasEmpty} / ${rows(emptied)}`);
}

/* ── a thousand rows, shuffled ──────────────────────────────────────────────────────────────── */
{
  const element = host();
  const draw = (order) =>
    render(html`<ul>${order.map((k) => keyed(k, html`<li>${k}</li>`))}</ul>`, element);
  const keys = Array.from({ length: 1000 }, (_, i) => i);
  draw(keys);
  const byKey = new Map([...element.querySelectorAll('li')].map((node, i) => [i, node]));

  /** Seeded, because a reconciliation bug that only some orderings hit must be reproducible. */
  let seed = 42;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const shuffled = [...keys].sort(() => random() - 0.5);
  draw(shuffled);

  const after = [...element.querySelectorAll('li')];
  check('a 1000-row shuffle keeps every row', after.length === 1000, `${after.length} rows`);
  check('and reuses every element rather than rebuilding',
    after.every((node, i) => node === byKey.get(shuffled[i])));
}

/* ── combinations ───────────────────────────────────────────────────────────────────────────── */
{
  const nested = host();
  const drawGroups = (groups) =>
    render(
      html`<div>${groups.map((g) => keyed(g.k, html`<ul>${g.items.map((i) => keyed(i, html`<li>${i}</li>`))}</ul>`))}</div>`,
      nested
    );
  drawGroups([{ k: 'x', items: [1, 2] }, { k: 'y', items: [3] }]);
  drawGroups([{ k: 'y', items: [3, 4] }, { k: 'x', items: [2, 1] }]);
  check('keyed lists nest', nested.textContent === '3421', JSON.stringify(nested.textContent));

  const drawing = host();
  const drawCircles = (ids) =>
    render(html`<svg>${ids.map((i) => keyed(i, svg`<circle r=${i} />`))}</svg>`, drawing);
  drawCircles([1, 2, 3]);
  drawCircles([3, 1, 2]);
  const circles = [...drawing.querySelectorAll('circle')];
  check('svg templates reorder inside a keyed list',
    circles.map((n) => n.getAttribute('r')).join(',') === '3,1,2');
  check('and stay in the SVG namespace',
    circles[0].namespaceURI === 'http://www.w3.org/2000/svg');

  const refs = host();
  const seen = new Map();
  const drawRefs = (keys) =>
    render(html`<ul>${keys.map((k) => keyed(k, html`<li ${(el) => seen.set(k, el)}>${k}</li>`))}</ul>`, refs);
  drawRefs([1, 2, 3]);
  const captured = new Map(seen);
  drawRefs([3, 2, 1]);
  const moved = [...refs.querySelectorAll('li')];
  check('element refs still point at their own row after a reorder',
    moved[0] === captured.get(3) && moved[2] === captured.get(1));

  let fired = null;
  const events = host();
  const drawEvents = (keys) =>
    render(html`<ul>${keys.map((k) => keyed(k, html`<li @click=${() => { fired = k; }}>${k}</li>`))}</ul>`, events);
  drawEvents([1, 2]);
  drawEvents([2, 1]);
  events.querySelectorAll('li')[0].dispatchEvent(new dom.window.Event('click'));
  check('a moved row carries its own handler', fired === 2, `fired for ${fired}`);
}

/* ── part-mode transitions ──────────────────────────────────────────────────────────────────── */
{
  const element = host();
  render(html`<div>${'plain'}</div>`, element);
  const asText = element.textContent;
  render(html`<div>${html`<span>tpl</span>`}</div>`, element);
  const asTemplate = element.textContent;
  render(html`<div>${[html`<i>1</i>`, html`<i>2</i>`]}</div>`, element);
  const asList = element.textContent;
  render(html`<div>${'back'}</div>`, element);
  check('a child position moves between text, template and list',
    asText === 'plain' && asTemplate === 'tpl' && asList === '12' && element.textContent === 'back',
    `${asText}/${asTemplate}/${asList}/${element.textContent}`);

  const toggling = host();
  const drawPair = (a, b) =>
    render(html`<div>${a ? html`<i>A</i>` : ''}${b ? html`<b>B</b>` : ''}</div>`, toggling);
  drawPair(true, true);
  drawPair(false, true);
  drawPair(true, false);
  drawPair(true, true);
  check('adjacent child parts toggle independently', toggling.textContent === 'AB',
    JSON.stringify(toggling.textContent));

  /**
   * Matches lit-html: only `null` and `undefined` are empty. `false` and `0` render, because a
   * template that interpolates a boolean usually means to show it.
   */
  const values = host();
  render(html`<div>[${null}][${undefined}][${false}][${0}]</div>`, values);
  check('null and undefined are empty; false and 0 render',
    values.textContent === '[][][false][0]', JSON.stringify(values.textContent));
}

/* ── hold, from a single call site ──────────────────────────────────────────────────────────── */
{
  const element = host();
  /**
   * One call site, toggling. `hold` keys parked instances by template identity, so two separate
   * `render` calls with their own literals are two different templates and nothing is re-adopted —
   * which is correct, and easy to mistake for a bug when writing the test.
   */
  const draw = (showInput) =>
    render(html`<div>${hold(showInput ? html`<input value="typed" />` : html`<p>other</p>`)}</div>`, element);

  draw(true);
  const input = element.querySelector('input');
  input.value = 'user typed';
  draw(false);
  check('the parked subtree leaves the DOM', element.querySelector('input') === null);
  draw(true);
  const returned = element.querySelector('input');
  check('and the same element comes back', returned === input);
  check('carrying state no attribute records', returned?.value === 'user typed', returned?.value);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
