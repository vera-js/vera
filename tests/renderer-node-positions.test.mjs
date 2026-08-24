/**
 * A DOM node at a child position renders **as itself**, moved into place.
 *
 * This is how a template holds something another library owns — a charting canvas, a map container,
 * an editor instance — and the guarantee is identity: the node the author handed over is the node on
 * the page, before and after a re-render. Rebuilding it would destroy whatever that library had
 * attached to it, silently, and the template would still look right.
 *
 * A `DocumentFragment` is the same contract for several nodes at once.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
for (const key of ['document', 'Node', 'HTMLElement', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[key] = dom.window[key];

const { render } = await load('renderer');
const html = (strings, ...values) => ({ strings, values });

let pass = 0;
const failures = [];
const check = (name, condition, extra = '') => (condition ? pass++ : failures.push(`${name} ${extra}`));

/* ── an element the caller owns ─────────────────────────────────────────────────────────────── */
{
  const owned = dom.window.document.createElement('canvas');
  owned.id = 'owned';
  /** Something a third-party library would have attached; it must survive. */
  owned.dataset.chart = 'attached';

  const container = dom.window.document.createElement('div');
  render(html`<div>${owned}</div>`, container);
  check('a DOM node is moved into place, not copied', container.querySelector('#owned') === owned);

  render(html`<div>${owned}</div>`, container);
  check('and the same node survives a re-render', container.querySelector('#owned') === owned);
  check('with what the library attached to it', container.querySelector('#owned')?.dataset.chart === 'attached');
}

/* ── a fragment of several ──────────────────────────────────────────────────────────────────── */
{
  const fragment = dom.window.document.createDocumentFragment();
  const first = dom.window.document.createElement('b');
  const second = dom.window.document.createElement('i');
  first.id = 'first';
  second.id = 'second';
  fragment.append(first, second);

  const container = dom.window.document.createElement('div');
  render(html`<div>${fragment}</div>`, container);
  check('a DocumentFragment renders its children', container.querySelector('#first') === first);
  check('all of them', container.querySelector('#second') === second);
}

/* ── a node beside ordinary content ─────────────────────────────────────────────────────────── */
{
  const owned = dom.window.document.createElement('span');
  owned.id = 'between';
  const container = dom.window.document.createElement('div');
  render(html`<div>before${owned}after</div>`, container);
  const text = container.querySelector('div').textContent;
  check('a node sits between its siblings', /before/.test(text) && /after/.test(text), text);
  check('and is still the node handed over', container.querySelector('#between') === owned);
}

if (failures.length) for (const failure of failures) console.log('FAIL:', failure);
console.log(`renderer node positions: ${pass} checks`);
assert.equal(failures.length, 0);
