/**
 * `<select .value=${x}>` — the one form property with no attribute to write. (`.selectedIndex` is its twin, choosing
 * by position, and every spelling — `.`, `!`, a spread key — must serve what the client shows.)
 *
 * Assigning `select.value` *selects an option*; there is no `value` content attribute, so the only
 * thing markup can say is `<option selected>` on the matching one. This is what React's server
 * renderer does. `@lit-labs/ssr` drops the binding and serves a control showing its first option;
 * `@verajs/ssr` used to write ` value="b"` on the `<select>` tag, which no parser reads — the same
 * wrong control, plus an attribute the client does not have.
 *
 * Every matching rule below is the platform's and is measured in Chromium, Firefox and WebKit in
 * `tests/browser/select-value.test.js` — in particular that an option with no `value` attribute
 * falls back to its text **stripped and collapsed**, which is easy to assume is the raw text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['document', 'Node', 'HTMLElement', 'DocumentFragment', 'Text', 'Comment', 'Element'])
  globalThis[key] = dom.window[key];

/** Renderer first: importing `@verajs/ssr` replaces `globalThis.document` with its own shim. */
const { renderInto } = await load('renderer');
const { html } = await load('core');
const { spread } = await load('renderer/spread');
const { serializeTemplate } = await import('@verajs/ssr');

const state = (host) => {
  const element = host.querySelector('select');
  return { index: element.selectedIndex, value: element.value };
};
const onServer = (template) => {
  const host = dom.window.document.createElement('div');
  host.innerHTML = serializeTemplate(template);
  return state(host);
};
const onClient = (template) => {
  const host = dom.window.document.createElement('div');
  renderInto(template, host);
  return state(host);
};

const ITEMS = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];

const CASES = {
  'static options': (v) => html`<select .value=${v}><option value="a">A</option><option value="b">B</option></select>`,
  'options from a nested template': (v) =>
    html`<select .value=${v}>${ITEMS.map((item) => html`<option value=${item.id}>${item.label}</option>`)}</select>`,
  'a spread key rather than a written binding': (v) =>
    html`<select ${spread({ '.value': v })}><option value="a">A</option><option value="b">B</option></select>`,
  /** `!value` is the same binding compared against the live value — on the server there is only one value to serve. */
  'the live spelling, !value': (v) => html`<select !value=${v}><option value="a">A</option><option value="b">B</option></select>`,
  'a spread !value key': (v) =>
    html`<select ${spread({ '!value': v })}><option value="a">A</option><option value="b">B</option></select>`,
  /** `selectedIndex` chooses an option by position, which markup expresses the same way — `<option selected>`. */
  '.selectedIndex': (v) =>
    html`<select .selectedIndex=${ITEMS.findIndex((item) => item.id === v)}>${ITEMS.map((item) => html`<option value=${item.id}>${item.label}</option>`)}</select>`,
  '!selectedIndex': (v) =>
    html`<select !selectedIndex=${ITEMS.findIndex((item) => item.id === v)}><option value="a">A</option><option value="b">B</option></select>`,
  'a spread .selectedIndex key': (v) =>
    html`<select ${spread({ '.selectedIndex': ITEMS.findIndex((item) => item.id === v) })}>${ITEMS.map((item) => html`<option value=${item.id}>${item.label}</option>`)}</select>`,
};

for (const [label, build] of Object.entries(CASES)) {
  for (const wanted of ['a', 'b']) {
    test(`${label}: selecting ${wanted} agrees with the client`, () => {
      assert.deepEqual(onServer(build(wanted)), onClient(build(wanted)));
    });
  }
}

test('an option with no value attribute matches on its text, stripped and collapsed', () => {
  const build = (v) => html`<select .value=${v}><option>Alpha</option><option>  Beta   Gamma  </option></select>`;
  assert.deepEqual(onServer(build('Beta Gamma')), onClient(build('Beta Gamma')));
  assert.equal(onClient(build('Beta Gamma')).index, 1, 'the client matches on the collapsed text');
});

test('a binding overrides a selected the author wrote, because a property assignment does', () => {
  const build = (v) => html`<select .value=${v}><option value="a" selected>A</option><option value="b">B</option></select>`;
  assert.deepEqual(onServer(build('b')), onClient(build('b')));
  assert.equal(onClient(build('b')).index, 1);
});

test('the first of two options sharing a value wins', () => {
  const build = (v) => html`<select .value=${v}><option value="a">first</option><option value="a">second</option></select>`;
  assert.deepEqual(onServer(build('a')), onClient(build('a')));
  assert.equal(onClient(build('a')).index, 0);
});

test('a value needing escaping still matches', () => {
  const quote = '"';
  const build = (v) => html`<select .value=${v}><option value="x">X</option><option value=${v}>Q</option></select>`;
  assert.deepEqual(onServer(build(`a${quote}b`)), onClient(build(`a${quote}b`)));
  assert.equal(onClient(build(`a${quote}b`)).index, 1);
});

test('two selects on one page are independent', () => {
  const template = html`<div>
    <select .value=${'a'}><option value="a">A</option><option value="b">B</option></select>
    <select .value=${'y'}><option value="x">X</option><option value="y">Y</option></select>
  </div>`;
  const host = dom.window.document.createElement('div');
  host.innerHTML = serializeTemplate(template);
  const client = dom.window.document.createElement('div');
  renderInto(template, client);
  assert.deepEqual(
    [...host.querySelectorAll('select')].map((s) => s.value),
    [...client.querySelectorAll('select')].map((s) => s.value)
  );
});

test('an index is converted as the platform converts a long: a string, a fraction, null', () => {
  const build = (i) => html`<select .selectedIndex=${i}><option>A</option><option>B</option><option>C</option></select>`;
  for (const index of ['2', 1.7, null, undefined, 'x']) {
    assert.deepEqual(onServer(build(index)), onClient(build(index)), `selectedIndex = ${String(index)}`);
  }
});

test('options inside an optgroup are counted in order, as select.options counts them', () => {
  const build = (i) =>
    html`<select .selectedIndex=${i}><optgroup label="g"><option>A</option><option>B</option></optgroup><option>C</option></select>`;
  for (const index of [0, 1, 2]) assert.deepEqual(onServer(build(index)), onClient(build(index)), `index ${index}`);
});

test('a binding overrides a selected the author wrote, by index as by value', () => {
  const build = (i) => html`<select .selectedIndex=${i}><option selected>A</option><option>B</option></select>`;
  assert.deepEqual(onServer(build(1)), onClient(build(1)));
  assert.equal(onClient(build(1)).index, 1);
});

/** Two bindings on one select: the client assigns both, in order, and the later one stands — so the server serves it. */
test('the later of two bindings on one select is the one served', () => {
  const byValueThenIndex = html`<select .value=${'a'} .selectedIndex=${1}><option value="a">A</option><option value="b">B</option></select>`;
  assert.deepEqual(onServer(byValueThenIndex), onClient(byValueThenIndex));
  assert.equal(onClient(byValueThenIndex).index, 1);
  const writtenThenSpread = html`<select .value=${'a'} ${spread({ '.value': 'b' })}><option value="a">A</option><option value="b">B</option></select>`;
  assert.deepEqual(onServer(writtenThenSpread), onClient(writtenThenSpread));
  assert.doesNotMatch(serializeTemplate(writtenThenSpread), /data-vm-select/, 'and no mark survives');
});

test('selectedIndex on anything but a select is the client\'s concern, with no markup', () => {
  const markup = serializeTemplate(html`<input .selectedIndex=${1}><div ${spread({ '.selectedIndex': 1 })}></div>`);
  assert.doesNotMatch(markup, /selectedindex/i);
});

test('a select with no binding is untouched', () => {
  const template = html`<select><option value="a">A</option><option value="b">B</option></select>`;
  assert.deepEqual(onServer(template), onClient(template));
  assert.doesNotMatch(serializeTemplate(template), /selected/, 'nothing should be marked');
  assert.doesNotMatch(serializeTemplate(template), /data-vm-select/, 'and the mark must not survive');
});

/**
 * The one case markup cannot express, asserted **as** a divergence so that closing it also fails
 * here and says to update the README.
 *
 * The client leaves `selectedIndex` at `-1` with nothing showing. A parsed `<select>` whose options
 * carry no `selected` takes its **first** — there is no markup for "none of them", and adding a
 * hidden selected placeholder would change the control the author wrote.
 */
test('a value matching no option is a divergence markup cannot close, and the README says so', () => {
  const build = (v) => html`<select .value=${v}><option value="a">A</option><option value="b">B</option></select>`;
  assert.equal(onClient(build('zzz')).index, -1, 'the client selects nothing');
  assert.equal(onServer(build('zzz')).index, 0, 'markup can only fall back to the first option');

  /** An index out of range is the same case: the client selects nothing, markup its first option. */
  const byIndex = (i) => html`<select .selectedIndex=${i}><option value="a">A</option><option value="b">B</option></select>`;
  for (const index of [-1, 5]) {
    assert.equal(onClient(byIndex(index)).index, -1, `the client selects nothing at ${index}`);
    assert.equal(onServer(byIndex(index)).index, 0, `markup falls back to the first option at ${index}`);
  }

  const readme = readFileSync(new URL('../packages/ssr/README.md', import.meta.url), 'utf8');
  assert.ok(
    readme.includes('a value matching no option cannot be served'),
    'the SSR README must document the no-match case'
  );
});
