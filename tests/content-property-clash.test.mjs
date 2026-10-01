/**
 * **A content-replacing property and content of the element's own cannot share it.** `.textContent`, `.innerHTML`,
 * `.innerText` and `.outerHTML` replace the element's children; bound beside markup or a child binding, the write
 * strands that binding, and a later commit into it throws on a missing parent (`Cannot read properties of null
 * (reading 'insertBefore')`) — or the content is silently lost. Development refuses the pair where it is written: the
 * template scanner for a written binding, `spread` for a runtime key (how a `tag` component's props arrive).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
const { html } = await load('core');
const { renderInto } = await load('renderer');
const { spread } = await load('renderer/spread');
const CLASH = /binds `\.(textContent|innerHTML|innerText|outerHTML)`, which replaces the element's content/;
const into = () => document.body.appendChild(document.createElement('div'));

test('a written content property beside a child binding or markup is refused in development', { skip: isProduction && 'a development check' }, () => {
  assert.throws(() => renderInto(html`<my-el .innerHTML=${'<b>v</b>'}>${'kid'}</my-el>`, into()), CLASH, 'beside a child binding');
  assert.throws(() => renderInto(html`<div .textContent=${'v'}><b>static</b></div>`, into()), CLASH, 'beside markup');
  assert.throws(() => renderInto(html`<p !innerText=${'v'}>${'kid'}</p>`, into()), CLASH, 'a live binding too');
});

test('a spread content key beside content is refused in development — the tag-component path', { skip: isProduction && 'a development check' }, () => {
  assert.throws(() => renderInto(html`<my-el ${spread({ '.textContent': 'V' })}>${'kid'}</my-el>`, into()), CLASH);
});

test('the property alone, or the content alone, renders', () => {
  const a = into();
  renderInto(html`<div .textContent=${'only'}></div>`, a);
  assert.equal(a.querySelector('div').textContent, 'only');
  const b = into();
  renderInto(html`<my-el ${spread({ '.textContent': 'x' })}></my-el>`, b);
  assert.equal(b.querySelector('my-el').textContent, 'x', 'a spread key alone (spread refuses .innerHTML outright)');
  const c = into();
  renderInto(html`<p title=${'t'}>${'kid'}</p>`, c);
  assert.equal(c.querySelector('p').textContent, 'kid', 'CONTROL: an attribute beside content is fine');
  const d = into();
  renderInto(html`<div textcontent=${'attr'}>${'kid'}</div>`, d);
  assert.equal(d.querySelector('div').getAttribute('textcontent'), 'attr', 'CONTROL: an ATTRIBUTE by that name is not the property');
});
