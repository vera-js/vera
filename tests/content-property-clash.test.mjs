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
const CLASH = /^(?:Error: )?(renderer|spread): <[a-z-]+> binds `\.(textContent|innerHTML|innerText|outerHTML)`, which replaces the element's content[\s\S]*\(content-clash\)$/;
const into = () => document.body.appendChild(document.createElement('div'));

test('a written content property beside a child binding or markup is refused in development', { skip: isProduction && 'a development check' }, () => {
  assert.throws(() => renderInto(html`<my-el .innerHTML=${'<b>v</b>'}>${'kid'}</my-el>`, into()), CLASH, 'beside a child binding');
  assert.throws(() => renderInto(html`<div .textContent=${'v'}><b>static</b></div>`, into()), CLASH, 'beside markup');
  assert.throws(() => renderInto(html`<p !innerText=${'v'}>${'kid'}</p>`, into()), CLASH, 'a live binding too');
});

test('a spread content key beside content is refused in development — the tag-component path', { skip: isProduction && 'a development check' }, () => {
  assert.throws(() => renderInto(html`<my-el ${spread({ '.textContent': 'V' })}>${'kid'}</my-el>`, into()), CLASH);
  /** The module the user wired names it: a spread key says `spread:`, a template binding `renderer:`. */
  assert.throws(() => renderInto(html`<my-el ${spread({ '.textContent': 'V' })}>${'kid'}</my-el>`, into()), /^(?:Error: )?spread: [\s\S]*the property alone \(`<my-el \$\{spread\(\{ '\.textContent': … \}\)\}><\/my-el>`\)/);
  assert.throws(() => renderInto(html`<my-el .textContent=${'V'}>${'kid'}</my-el>`, into()), /^(?:Error: )?renderer: /);
});

test('a spread content key on an element whose only content is a binding is refused too — it leaves no node until it commits', { skip: isProduction && 'a development check' }, () => {
  assert.throws(() => renderInto(html`<div ${spread({ '.textContent': 'a' })}>${'k'}</div>`, into()), CLASH);
});

test('outerText replaces the element itself: refused beside content', { skip: isProduction && 'a development check' }, () => {
  assert.throws(() => renderInto(html`<my-el .outerText=${'a'}>${'k'}</my-el>`, into()), /binds `\.outerText`/);
});

test('an &nbsp; is content, not formatting — HTML whitespace is [ \\t\\n\\f\\r] only', { skip: isProduction && 'a development check' }, () => {
  assert.throws(() => renderInto(html`<p .innerHTML=${'<b>x</b>'}>&nbsp;</p>`, into()), CLASH);
});

test('formatting whitespace is not content — the property strands nothing', () => {
  const host = into();
  renderInto(html`<div .innerHTML=${'<b>x</b>'}>
  </div>`, host);
  assert.equal(host.querySelector('div b')?.textContent, 'x');
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
