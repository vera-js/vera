/**
 * **A PLAIN element's whole content belongs to its one SOLE binding** — so the element is the range, and the part it
 * becomes adds no comments.
 *
 * `<ul>${rows}</ul>` used to bracket its rows with two empty comments inside the `<ul>`: two nodes created per such
 * position on the client, and two DOM writes per position that hydration had to insert into server markup (which
 * carries none). A SOLE position's parent is its element and never changes, so the part can own the element instead.
 *
 * Only a PLAIN element: a light-DOM component renders into its OWN children, so a binding there keeps its anchor and
 * its markers, and the two coexist — clearing the binding must never take the component's render with it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'customElements', 'DocumentFragment', 'CustomEvent', 'Event'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const core = await load('core');
const { renderer, renderInto, hold } = await load('renderer');
const { keyed } = await load('renderer/keyed');
core.wire([renderer]);
const { html } = core;
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => setTimeout(r, 0)));
const comments = (el) => [...el.childNodes].filter((n) => n.nodeType === 8).length;

test('a SOLE position on a plain element adds no comments, whatever it holds', () => {
  const host = document.createElement('div');
  const draw = (content) => renderInto(html`<ul>${content}</ul>`, host);
  const ul = () => host.querySelector('ul');
  const shapes = [
    ['a list', ['a', 'b'].map((x) => html`<li>${x}</li>`), 'ab'],
    ['text', 'plain', 'plain'],
    ['a template', html`<li>one</li>`, 'one'],
    ['nothing', null, ''],
    ['a list again', ['c'].map((x) => html`<li>${x}</li>`), 'c'],
    ['a node', document.createTextNode('node'), 'node'],
    ['an empty list', [], ''],
  ];
  for (const [label, content, text] of shapes) {
    draw(content);
    assert.equal(comments(ul()), 0, `${label}: no comment inside the <ul>`);
    assert.equal(ul().textContent, text, `${label}: the content`);
  }
});

test('hold() in a SOLE position parks and restores the same nodes', () => {
  const host = document.createElement('div');
  const draw = (editing) => renderInto(html`<section>${hold(editing ? html`<input><b>e</b>` : html`<p>view</p>`)}</section>`, host);
  draw(true);
  const input = host.querySelector('input');
  draw(false);
  assert.equal(host.querySelector('section').textContent, 'view');
  draw(true);
  assert.equal(host.querySelector('input'), input, 'the parked input came back, not a new one');
  assert.equal(comments(host.querySelector('section')), 0);
});

test('a keyed list in a SOLE position reorders, grows and empties in place', () => {
  const host = document.createElement('div');
  const row = (id) => keyed(id, html`<li>${id}</li>`);
  const draw = (ids) => renderInto(html`<ol>${ids.map(row)}</ol>`, host);
  draw([1, 2, 3]);
  const [one, , three] = host.querySelectorAll('li');
  draw([3, 1, 4]);
  const now = [...host.querySelectorAll('li')];
  assert.deepEqual(now.map((li) => li.textContent), ['3', '1', '4']);
  assert.equal(now[0], three, 'moved, not rebuilt');
  assert.equal(now[1], one);
  draw([]);
  assert.equal(host.querySelector('ol').childNodes.length, 0);
  draw([5]);
  assert.equal(host.querySelector('ol').textContent, '5');
});

test("a light-DOM component's own render survives its parent's binding changing — the binding keeps its markers there", async () => {
  customElements.define('x-own-panel', class extends HTMLElement {
    connectedCallback() {
      core.init(this, () => {
        return () => html`<b>own</b>`;
      });
    }
  });
  const host = document.body.appendChild(document.createElement('div'));
  const draw = (content) => renderInto(html`<x-own-panel>${content}</x-own-panel>`, host);
  draw(html`<i>a</i>`);
  await frame();
  const panel = host.querySelector('x-own-panel');
  assert.equal(panel.querySelector('b')?.textContent, 'own', 'CONTROL: the component rendered its own content');
  for (const content of [null, 'text', ['x', 'y'].map((x) => html`<i>${x}</i>`), html`<i>b</i>`, null]) {
    draw(content);
    await frame();
    assert.equal(panel.querySelector('b')?.textContent, 'own', `the component's render survived ${JSON.stringify(content)}`);
  }
});

test('content beside a non-SOLE position is untouched when it changes', () => {
  const host = document.createElement('div');
  const draw = (content) => renderInto(html`<p><b>before</b>${content}<b>after</b></p>`, host);
  for (const content of [['a', 'b'].map((x) => html`<i>${x}</i>`), null, 'text', html`<i>t</i>`]) {
    draw(content);
    const bs = host.querySelectorAll('p > b');
    assert.deepEqual([...bs].map((b) => b.textContent), ['before', 'after']);
  }
});
