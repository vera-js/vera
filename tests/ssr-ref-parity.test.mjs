/**
 * A ref is client state with no markup, and the server has to agree — byte for byte.
 *
 * Two ways to write one, both of which the renderer accepts because of how its scanner reads a tag:
 * the element position `<p ${myRef}>`, and the explicit `<p &=${myRef}>`, where the scanner
 * back-reads the name `&` and `AttrPart` maps that to a ref.
 *
 * The server dropped neither cleanly. `&=${myRef}` did not match its sigil pattern — which required
 * a name after the sigil — so it served `<p &=[object Object]>`: malformed markup that also printed
 * the object. And the element position dropped the value but kept the space that introduced it,
 * serving `<p >r</p>` where the client renders `<p>r</p>`.
 *
 * Neither is dangerous. Both are the two halves of one framework disagreeing about something neither
 * of them renders, which is exactly the class of difference that makes hydration mismatches hard to
 * find later.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { serializeTemplate } from '@verajs/ssr/vera';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment'])
  globalThis[key] = dom.window[key];

const { html, ref } = await load('core');
const { renderInto } = await load('renderer');

const onClient = (template) => {
  const host = document.createElement('div');
  document.body.append(host);
  renderInto(template, host);
  return host.innerHTML.replace(/<!---->/g, '').trim();
};

const box = ref(null);
const CASES = {
  'element position, function': () => html`<p ${(element) => element}>r</p>`,
  'element position, ref object': () => html`<p ${box}>r</p>`,
  'element position between attributes': () => html`<p class="a" ${box} id="b">r</p>`,
  'element position, only binding': () => html`<input ${box}>`,
  'explicit ampersand': () => html`<p &=${box}>r</p>`,
  'explicit ampersand after an attribute': () => html`<p class="a" &=${box}>r</p>`,
  'explicit ampersand, function': () => html`<p &=${(element) => element}>r</p>`,
};

test('server and client agree exactly on every way of writing a ref', () => {
  const disagreements = [];
  for (const [name, make] of Object.entries(CASES)) {
    const server = serializeTemplate(make());
    const client = onClient(make());
    if (server !== client) disagreements.push(`${name}\n      server: ${server}\n      client: ${client}`);
  }
  assert.deepEqual(disagreements, [], `\n  ${disagreements.join('\n  ')}`);
});

/** The value must not reach the markup in any form — not stringified, not as an attribute name. */
test('a ref never leaks into the markup', () => {
  for (const make of Object.values(CASES)) {
    const server = serializeTemplate(make());
    assert.doesNotMatch(server, /object Object/, `${server}: the ref was stringified`);
    assert.doesNotMatch(server, /&=/, `${server}: the sigil survived`);
    assert.doesNotMatch(server, / >/, `${server}: the binding left its space behind`);
  }
});

/** A named sigil binding still behaves — the optional name must not have loosened anything. */
test('named sigil bindings are unaffected', () => {
  assert.equal(serializeTemplate(html`<input ?disabled=${true}>`), '<input disabled="">');
  assert.equal(serializeTemplate(html`<input ?disabled=${false}>`), '<input>');
  assert.equal(serializeTemplate(html`<input .value=${'v'}>`), '<input value="v">');
  assert.equal(serializeTemplate(html`<button @click=${() => {}}>b</button>`), '<button>b</button>');
  assert.equal(serializeTemplate(html`<p title=${'t'}>x</p>`), '<p title="t">x</p>');
});

/**
 * **A dynamic attribute *name* is refused, not dropped.**
 *
 * `<b ${name}="x">` is the one element-position shape that is not a ref: the slot sits inside the
 * tag with an `=` immediately after it. Dropping the value emitted `<b="x">` — not an attribute,
 * not a tag, markup no browser would produce from that template. The client is no better off, since
 * it hands the template to the platform's parser and a marker is not a name. Both halves being
 * broken is exactly when saying so beats serving either one's version of broken.
 */
test('an attribute name that is an expression is refused', () => {
  assert.throws(
    () => serializeTemplate({ strings: Object.assign(['<b ', '="x">y</b>'], { raw: [] }), values: ['dyn'] }),
    /an attribute name cannot be an expression/,
    'the malformed shape is named rather than served'
  );
  assert.throws(
    () => serializeTemplate({ strings: Object.assign(['<b ', '="x">y</b>'], { raw: [] }), values: ['dyn'] }),
    /@verajs\/renderer\/spread/,
    'and the supported alternative is named with it'
  );
});

test('the shapes that look similar still serialize', () => {
  /** A ref at an element position: dropped, space and all. */
  assert.equal(serializeTemplate(onServerTemplate(), ...[]), serializeTemplate(onServerTemplate()));
  assert.equal(serializeTemplate(html`<b title=${'t'}>y</b>`), '<b title="t">y</b>', 'an ordinary attribute');
  assert.equal(serializeTemplate(html`<p>${'a'}=b</p>`), '<p>a=b</p>', 'an `=` after a text position');
});

/** A template built at one call site, so the two calls above compare the same identity. */
function onServerTemplate() {
  return html`<input ${{ value: null }} />`;
}
