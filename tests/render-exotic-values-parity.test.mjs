/**
 * What the two renderers do with values nobody means to interpolate — enumerated, not hand-picked.
 *
 * The class of bug this exists for is the one `CLAUDE.md` calls the worst in the SSR package: the
 * server and the client disagree about something neither of them renders, so nothing fails until a
 * hydration mismatch appears somewhere else entirely. Coercion is where that hides, because almost
 * every value has *some* string form and the two sides reach it by different routes — the client
 * assigns to the DOM and gets WebIDL's `DOMString` conversion, the server calls a function.
 *
 * `String(value)` and `` `${value}` `` are the same operation for every input except a **symbol**,
 * which `String` alone special-cases into its description rather than throwing. That one exception
 * is what let `<p title="a ${symbol} b">` render `a Symbol(s) b` on a client where
 * `<p title=${symbol}>` threw — the same sigil on the same attribute, disagreeing with itself
 * depending on whether static text sat beside it — and let the server serve markup no client could
 * reproduce.
 *
 * **Markup is compared by parsing it, never as text.** The two sides spell an escape differently
 * (`&#62;` against `&gt;`) and both are correct; comparing strings would report that as a
 * divergence and bury the real ones. Parsed once, as a browser does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['document', 'Node', 'HTMLElement', 'DocumentFragment', 'Text', 'Comment', 'Element'])
  globalThis[key] = dom.window[key];

/**
 * **Order matters, and getting it wrong makes this suite assert nothing.** Importing `@verajs/ssr`
 * installs its own DOM over the globals — `globalThis.document` is *replaced*, and its elements hold
 * children as a string, so `querySelector` on one answers null rather than throwing. A comparison
 * written against the bare global after that line is the shim against itself, reading `null` for
 * everything and agreeing perfectly.
 *
 * So the renderer is loaded **first**, capturing jsdom's document at its module scope, and every
 * host below comes from `dom.window` rather than the global. The guard test right after this makes
 * that structural rather than remembered.
 */
const { renderInto } = await load('renderer');
const { html } = await load('core');
const { serializeTemplate } = await import('@verajs/ssr/vera');

test('the client half is a real DOM, not the SSR shim that just replaced the global one', () => {
  assert.notEqual(globalThis.document, dom.window.document,
    'the SSR shim did not install — if that changes, re-check what this suite is comparing');
  const probe = dom.window.document.createElement('div');
  probe.innerHTML = '<p title="a">x</p>';
  assert.ok(probe.querySelector('p'), 'the client half must be jsdom; the shim answers null here');
  assert.equal(probe.querySelector('p').getAttribute('title'), 'a');
});

class Stringy {
  toString() { return 'STRINGY'; }
}

/** One entry per value shape that has ever coerced differently on the two sides. */
const VALUES = [
  ['NaN', () => NaN],
  ['Infinity', () => Infinity],
  ['negative zero', () => -0],
  ['a huge number', () => 1e21],
  ['a tiny number', () => 1e-7],
  ['a bigint', () => 10n],
  ['a symbol', () => Symbol('s')],
  ['a Date', () => new Date(0)],
  ['a RegExp', () => /a/g],
  ['an array', () => [1, 2]],
  ['a nested array', () => [[1], [2]]],
  ['an object with toString', () => new Stringy()],
  ['a Set', () => new Set([1, 2])],
];

const POSITIONS = {
  'child text': (value) => html`<p>${value}</p>`,
  'an attribute': (value) => html`<p title=${value}></p>`,
  'an attribute beside static text': (value) => html`<p title="a ${value} b"></p>`,
  'a boolean attribute': (value) => html`<p ?hidden=${value}></p>`,
};

/** `{ threw: true }` or the parsed result, so "both refused" counts as agreement. */
const onServer = (build, value) => {
  let markup;
  try { markup = serializeTemplate(build(value)); } catch { return { threw: true }; }
  const host = dom.window.document.createElement('div');
  host.innerHTML = markup;
  return read(host);
};

const onClient = (build, value) => {
  const host = dom.window.document.createElement('div');
  try { renderInto(build(value), host); } catch { return { threw: true }; }
  return read(host);
};

const read = (host) => {
  const p = host.querySelector('p');
  return {
    threw: false,
    text: p ? p.textContent : host.textContent,
    title: p ? p.getAttribute('title') : null,
    hidden: p ? p.hasAttribute('hidden') : null,
  };
};

/**
 * The one difference that is deliberate, and it is asserted *as* a difference so that making the
 * two sides agree also fails here — a documented divergence that quietly stops being true is worth
 * as little as an undocumented one.
 */
const DOCUMENTED = 'A function interpolated at a text position renders as nothing here and as its source on the';

test('the SSR README still documents the function divergence', () => {
  const readme = readFileSync(new URL('../packages/ssr/README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes(DOCUMENTED),
    'the README no longer documents it — either restore the sentence or make the two sides agree');
});

test('a function at a text position is the documented divergence, and only that', () => {
  const server = onServer(POSITIONS['child text'], function named() {});
  const client = onClient(POSITIONS['child text'], function named() {});
  assert.equal(server.text, '', 'the server should still drop it');
  assert.ok(client.text.includes('named'), 'the client should still render its source');
});

for (const [position, build] of Object.entries(POSITIONS)) {
  for (const [label, make] of VALUES) {
    test(`${position}: server and client agree on ${label}`, () => {
      const server = onServer(build, make());
      const client = onClient(build, make());
      assert.deepEqual(server, client);
    });
  }
}

/**
 * The shapes named in `serializeValue`'s own comment as having disagreed with a browser. They were
 * corrected for `title=${x}` and stayed wrong for `title="a ${x} b"`, which the compiler classifies
 * as TEXT — there is no sigil and no `name=` tail to match, so it was emitted into the stream with
 * the child-position rule. One fix, two branches, and only one of them had it.
 */
test('an attribute beside static text takes the attribute rule, not the child rule', () => {
  const cases = [
    ['an array', [1, 2], 'a 1,2 b'],
    ['a Set', new Set([1, 2]), 'a [object Set] b'],
    ['a template result', html`<i>x</i>`, 'a [object Object] b'],
    ['nullish', null, 'a  b'],
    ['false', false, 'a false b'],
  ];
  for (const [label, value, expected] of cases) {
    const build = POSITIONS['an attribute beside static text'];
    assert.equal(onClient(build, value).title, expected, `the client changed for ${label}`);
    assert.equal(onServer(build, value).title, expected, `the server disagrees for ${label}`);
  }
});

test('a function in an attribute is its source on both sides — the text-position rule is not this one', () => {
  const build = POSITIONS['an attribute beside static text'];
  const fn = function named() {};
  assert.ok(onClient(build, fn).title.includes('named'));
  assert.equal(onServer(build, fn).title, onClient(build, fn).title);
});

test('a symbol is refused by both sides, in every position that converts one', () => {
  /**
   * `?hidden` is excluded on purpose: a boolean attribute is a truthiness test and never converts
   * its value, so a symbol is simply truthy there — on both sides, which is the whole requirement.
   */
  for (const position of ['child text', 'an attribute', 'an attribute beside static text']) {
    assert.equal(onServer(POSITIONS[position], Symbol('s')).threw, true, `the server rendered a symbol at ${position}`);
    assert.equal(onClient(POSITIONS[position], Symbol('s')).threw, true, `the client rendered a symbol at ${position}`);
  }
  assert.equal(onServer(POSITIONS['a boolean attribute'], Symbol('s')).hidden, true);
  assert.equal(onClient(POSITIONS['a boolean attribute'], Symbol('s')).hidden, true);
});

/**
 * `value` is the only **string** form property the server writes, and the three elements that carry
 * one do not share an IDL. Measured in Chromium, Firefox and WebKit rather than assumed — see
 * `tests/browser/form-property-coercion.test.js` — because four elements with a property of the same
 * name meaning three different things is exactly the shape a code read gets wrong.
 *
 * `null` and `undefined` are **not** interchangeable here, and a `== null` test is what collapsed
 * them: `[LegacyNullToEmptyString]` makes `null` the empty string on `<input>` and `<textarea>` and
 * nothing else does, while `undefined` is the text `"undefined"` on all of them.
 */
const FORM_VALUES = [
  ['true', true],
  ['false', false],
  ['null', null],
  ['undefined', undefined],
  ['zero', 0],
  ['the empty string', ''],
  ['an array', [1, 2]],
];

for (const [tag, build] of [
  ['input', (value) => html`<input .value=${value}>`],
  ['textarea', (value) => html`<textarea .value=${value}></textarea>`],
  ['option', (value) => html`<select><option .value=${value}>label</option></select>`],
]) {
  for (const [label, value] of FORM_VALUES) {
    test(`${tag}.value: server and client agree on ${label}`, () => {
      /** The same IDL property on both sides — an attribute against a property is not a comparison. */
      const serverHost = dom.window.document.createElement('div');
      serverHost.innerHTML = serializeTemplate(build(value));
      const clientHost = dom.window.document.createElement('div');
      renderInto(build(value), clientHost);
      assert.equal(serverHost.querySelector(tag).value, clientHost.querySelector(tag).value);
    });
  }
}

test('a boolean form property still takes truthiness, which is a different rule again', () => {
  for (const [label, value, expected] of [['a string', 'anything', true], ['zero', 0, false], ['null', null, false]]) {
    const build = (v) => html`<input type="checkbox" .checked=${v}>`;
    const serverHost = dom.window.document.createElement('div');
    serverHost.innerHTML = serializeTemplate(build(value));
    const clientHost = dom.window.document.createElement('div');
    renderInto(build(value), clientHost);
    assert.equal(serverHost.querySelector('input').checked, expected, `server, ${label}`);
    assert.equal(clientHost.querySelector('input').checked, expected, `client, ${label}`);
  }
});
