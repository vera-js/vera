/**
 * **The tier parity fixes, held against core** (2026-11-19, found by running core's suites against lite's and static's
 * shipped bundles — `VERA_TIER`, `tests/dist.mjs`). Each row renders the same template through core and through the tier
 * and compares what the platform holds:
 *
 * - a non-array ITERABLE child (a `Set`, a `Map`, a generator) renders its items, core's rule; a string stays one text;
 * - a first `.value=${undefined}` is WRITTEN (the platform's setter makes it "undefined", as core and the server do) —
 *   lite skipped it, because its "last written" started as `undefined`;
 * - a template-SHAPED object that is no template — a forgery from `JSON.parse` carrying a `"toString"` key, or a wrapper
 *   around a real literal's strings (only core's `hold`/`tag` build those) — renders the text `[object Object]` and never
 *   throws; development says which (`forged-template`, `template-wrapper`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const core = await load('core');
const { renderer, renderInto } = await load('renderer');
core.wire([renderer]);
const lite = await load('lite');

const literal = (pieces) => Object.assign([...pieces], { raw: [...pieces] });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const visible = (root) => root.innerHTML.replace(/<!--[^]*?-->/g, '');
let seq = 0;

/** Core: `renderInto` a template made of `pieces` and `values`, twice when `next` is given (an update). */
const viaCore = (pieces, values, next) => {
  const host = document.createElement('div');
  const shape = literal(pieces);
  renderInto(core.html(shape, ...values), host);
  if (next) renderInto(core.html(shape, ...next), host);
  return host;
};
/** Lite: a real component of the shipped bundle, its values in a signal, updated once when `next` is given. */
const viaLite = async (pieces, values, next) => {
  const tag = `tier-fix-${seq++}`;
  const shape = literal(pieces);
  const held = lite.signal(values);
  lite.define(tag, () => () => lite.html(shape, ...held.value));
  const element = document.body.appendChild(document.createElement(tag));
  if (next) {
    held.value = next;
    await settle();
  }
  return element;
};
/** Development warnings said during `work`, as `[codes]`. */
const codes = async (work) => {
  const said = [];
  const { warn } = console;
  console.warn = (...args) => said.push(args.map(String).join(' '));
  try {
    await work();
  } finally {
    console.warn = warn;
  }
  return said.map((line) => /\(([a-z-]+)\)\s*$/.exec(line)?.[1] ?? line);
};

function* letters() {
  yield 'x';
  yield 'y';
}

test('an iterable child renders its items as core does; a string stays one text; a generator re-renders', async () => {
  const cases = {
    'a Set': [new Set(['a', 'b'])],
    'a Map': [new Map([['k', 'v']])],
    'a generator': [letters()],
    'a string': ['hello'],
    'a Set of templates': [new Set([core.html`<i>1</i>`])],
  };
  for (const [name, values] of Object.entries(cases)) {
    const liteValues = name === 'a Set of templates' ? [new Set([lite.html`<i>1</i>`])] : name === 'a generator' ? [letters()] : values;
    assert.equal(visible(await viaLite(['<p>', '</p>'], liteValues)), visible(viaCore(['<p>', '</p>'], values)), name);
  }
  /** CONTROL: the iterable really is listed — core renders the Set's items, not its text. */
  assert.equal(visible(viaCore(['<p>', '</p>'], [new Set(['a', 'b'])])), '<p>ab</p>');
  /** An update: one generator, then a fresh one (a one-shot iterable is read once per render, on both). */
  assert.equal(visible(await viaLite(['<p>', '</p>'], [letters()], [letters()])), visible(viaCore(['<p>', '</p>'], [letters()], [letters()])));
  /** An update from a Set to text and back renders as a fresh render would. */
  assert.equal(visible(await viaLite(['<p>', '</p>'], [new Set(['a'])], ['t'])), '<p>t</p>');
});

test('a first .value=${undefined} is written as core and the server write it; null is the same as before', async () => {
  for (const [pieces, pick] of [
    [['<input .value=', '>'], 'input'],
    [['<textarea .value=', '></textarea>'], 'textarea'],
    [['<select><option .value=', '>label</option></select>'], 'option'],
  ])
    for (const value of [undefined, null]) {
      const fromCore = viaCore(pieces, [value]).querySelector(pick).value;
      const fromLite = (await viaLite(pieces, [value])).querySelector(pick).value;
      assert.equal(fromLite, fromCore, `${pick} .value=${value}`);
    }
  /** CONTROL: the platform's setter makes `undefined` the text "undefined" — the case lite skipped. */
  assert.equal(viaCore(['<input .value=', '>'], [undefined]).querySelector('input').value, 'undefined');
});

test('a template-shaped object that is no template renders [object Object] and never throws; development says which', async () => {
  const forgery = () => JSON.parse('{"strings":["<b>x</b>"],"values":[],"toString":"x"}');
  const wrapper = () => ({ strings: core.html`<b id="w">${0}</b>`.strings, values: ['w'] });
  let said;
  const lited = await (async () => {
    let element;
    said = await codes(async () => {
      element = await viaLite(['<p>', '</p>'], [forgery()]);
    });
    return element;
  })();
  assert.equal(visible(lited), '<p>[object Object]</p>', 'the forgery is text, its own toString never called');
  assert.equal(visible(viaCore(['<p>', '</p>'], [forgery()])), '<p>[object Object]</p>', 'CONTROL: core renders it so');
  if (!isProduction) assert.ok(said.includes('forged-template'), `development names it: ${said.join(' | ')}`);
  let wrapped;
  said = await codes(async () => {
    wrapped = await viaLite(['<p>', '</p>'], [wrapper()]);
  });
  assert.equal(visible(wrapped), '<p>[object Object]</p>', 'a wrapper is text in lite (a template only to core)');
  assert.equal(viaCore(['<p>', '</p>'], [wrapper()]).querySelector('#w')?.textContent, 'w', 'CONTROL: core renders the wrapper as its template');
  if (!isProduction) assert.ok(said.includes('template-wrapper'), `development names it: ${said.join(' | ')}`);
  /** An update through the text path: the forgery replaces text in place, still without a throw. */
  assert.equal(visible(await viaLite(['<p>', '</p>'], ['t'], [forgery()])), '<p>[object Object]</p>');
});

/**
 * **Lite says core's development diagnostics** (Brian, 2026-11-19), from the same shared checks and prose: a boolean
 * child (`boolean-child`), a whole attribute value that is not text (`attribute-value`), a handler that cannot listen
 * (`not-a-listener`) and a misspelled event (`event-name-typo`) — each said where core says it, production silent. The
 * control: core says the same codes for the same templates.
 */
test('lite says core\'s development diagnostics for the same mistakes, with the same codes; production says nothing', async () => {
  const cases = [
    ['boolean-child', ['<p>', '</p>'], [false]],
    ['attribute-value', ['<p title=', '>x</p>'], [() => {}]],
    ['not-a-listener', ['<button @click=', '>b</button>'], ['alert(1)']],
    ['event-name-typo', ['<button @clik=', '>b</button>'], [() => {}]],
  ];
  for (const [code, pieces, values] of cases) {
    const fromLite = await codes(() => viaLite(pieces, values));
    const fromCore = await codes(async () => viaCore(pieces, values));
    if (isProduction) {
      assert.deepEqual(fromLite.filter((c) => c === code), [], `${code}: production says nothing`);
      continue;
    }
    assert.ok(fromCore.includes(code), `CONTROL: core says ${code}: ${fromCore.join(' | ')}`);
    assert.ok(fromLite.includes(code), `lite says ${code}: ${fromLite.join(' | ')}`);
  }
  if (isProduction) return;
  /** Said once where core says it once: the same typo bound again is quiet. */
  const again = await codes(() => viaLite(['<button @clik=', '>b</button>'], [() => {}]));
  assert.equal(again.filter((c) => c === 'event-name-typo').length, 0, 'the same typo on the same tag is said once');
  /** A boolean that keeps producing `false` speaks once; a flip speaks again (core's rule). */
  const flips = await codes(() => viaLite(['<p>', '</p>'], [false], [true]));
  assert.equal(flips.filter((c) => c === 'boolean-child').length, 2, `false, then true: ${flips.join(' | ')}`);
});

/* ── static ──────────────────────────────────────────────────────────────────────────────────── */
const staticTier = await load('static');
/** Static: a real component of the shipped bundle, rendered once, its own light DOM read. */
const viaStatic = (pieces, values) => {
  const tag = `tier-fix-static-${seq++}`;
  const shape = literal(pieces);
  staticTier.define(tag, () => () => staticTier.html(shape, ...values));
  const element = new (customElements.get(tag))();
  element.connectedCallback();
  return element;
};
/** The attribute names an element carries — the junk the bug wrote shows here (`?hidden`, `.value`, `@click`). */
const names = (element) => [...element.attributes].map((a) => a.name).sort();

test('static: an iterable child renders its items, a string one text, as core does', () => {
  for (const values of [[new Set(['a', 'b'])], [new Map([['k', 'v']])], [letters()], ['hello']])
    assert.equal(visible(viaStatic(['<p>', '</p>'], values)), visible(viaCore(['<p>', '</p>'], values.map((v) => (v?.next ? letters() : v)))));
});

test('static: a nullish whole attribute is removed and a nullish part is empty, as core does', () => {
  for (const pieces of [['<p class=', '>x</p>'], ['<p class="', '">x</p>'], ['<p class="a ', ' b">x</p>']])
    for (const value of [null, undefined]) {
      const fromStatic = viaStatic(pieces, [value]).querySelector('p');
      const fromCore = viaCore(pieces, [value]).querySelector('p');
      assert.equal(fromStatic.getAttribute('class'), fromCore.getAttribute('class'), `${pieces.join('${…}')} with ${value}`);
    }
  /** CONTROL: core removes a nullish whole attribute (the rule being matched). */
  assert.equal(viaCore(['<p class=', '>x</p>'], [null]).querySelector('p').hasAttribute('class'), false);
});

test('static: ?name is honored; .prop, !live, @event and a function value write nothing — never a junk attribute', async () => {
  for (const value of [true, false, 'x', 0]) {
    const fromStatic = viaStatic(['<p ?hidden=', '>x</p>'], [value]).querySelector('p');
    assert.deepEqual(names(fromStatic), names(viaCore(['<p ?hidden=', '>x</p>'], [value]).querySelector('p')), `?hidden=${value}`);
  }
  let said = [];
  said = await codes(async () => {
    for (const [pieces, value] of [
      [['<input .value=', '>'], 'v'],
      [['<input !value=', '>'], 'v'],
      [['<button @click=', '>b</button>'], () => {}],
      [['<p title=', '>x</p>'], () => 'app code'],
    ]) {
      const element = viaStatic(pieces, [value]).firstElementChild;
      assert.deepEqual(names(element), [], `${pieces[0]}: nothing written, ${element.outerHTML}`);
      assert.equal(element.outerHTML.includes('app code') || element.outerHTML.includes('=>'), false, 'no function source in the markup');
    }
  });
  if (!isProduction) assert.ok(said.filter((c) => c === 'static-needs-renderer').length >= 4, `development names each: ${said.join(' | ')}`);
});

test('static: a template-shaped object renders [object Object], never throws; a true ?type on a JSON block with a value is refused', async () => {
  const forgery = () => JSON.parse('{"strings":["<b>x</b>"],"values":[],"toString":"x"}');
  const said = await codes(async () => {
    assert.equal(visible(viaStatic(['<p>', '</p>'], [forgery()])), '<p>[object Object]</p>');
    assert.equal(visible(viaStatic(['<p>', '</p>'], [{ strings: core.html`<b>${0}</b>`.strings, values: [1] }])), '<p>[object Object]</p>');
  });
  if (!isProduction) assert.ok(said.includes('forged-template') && said.includes('template-wrapper'), said.join(' | '));
  /** `?type=${true}` empties a JSON block's type: its value is then refused, never run (static judges the final type). */
  assert.throws(() => viaStatic(['<script type="application/json" ?type=', '>', '</script>'], [true, 'alert(1)']), /static-hole/);
  /** CONTROL: a false one leaves the block JSON, its value text. */
  assert.equal(viaStatic(['<script type="application/json" ?type=', '>', '</script>'], [false, '{"a":1}']).querySelector('script').getAttribute('type'), 'application/json');
});

/**
 * **S4: every value static writes must land** (2026-11-19). The parser keeps a duplicated attribute's FIRST occurrence and
 * drops the second, with the value static wrote there — silently lost until now. Static refuses such a template
 * (`static-hole`), as lite refuses a duplicated attribute; core keeps the last (the control). A value that lands is unaffected.
 */
test('static: a template whose value the parser drops (a duplicated attribute) is refused; core keeps the last', () => {
  /** The value sits in the SECOND occurrence, which the parser drops: refused, never silently lost. */
  assert.throws(() => viaStatic(['<b title="a" title=', '>t</b>'], ['dropped']), /static-hole/);
  assert.equal(viaCore(['<b title="a" title=', '>t</b>'], ['last']).querySelector('b').getAttribute('title'), 'last', 'CONTROL: core keeps the last');
  /** CONTROL: the value in the FIRST occurrence lands (the parser drops the static second): rendered, nothing refused. */
  assert.equal(viaStatic(['<b title=', ' title="x">t</b>'], ['kept']).querySelector('b').getAttribute('title'), 'kept');
});

/**
 * **Static says core's development diagnostics** (2026-11-19, as lite does), from the same shared checks and prose: a
 * boolean child (`boolean-child`), a whole attribute value that is not text (`attribute-value`) and a script URL it
 * removes (`script-url`) — each where core says it, with a CONTROL value neither says anything for, production silent.
 * Each case has its own call site, and its own attribute name or URL: every one is said once (below).
 */
test('static says core\'s development diagnostics for the same mistakes, with the same codes; a control says nothing; production says nothing', async () => {
  const cases = [
    ['boolean-child', ['<p>', '</p>'], [false], [0]],
    ['boolean-child', ['<title>', '</title>'], [true], ['text']],
    ['attribute-value', ['<p data-sa-1=', '>x</p>'], [[1, 2]], ['1 2']],
    ['attribute-value', ['<p data-sa-2="', '">x</p>'], [new Date(0)], [new URL('https://x.test/')]],
    ['script-url', ['<a href=', '>x</a>'], ['javascript:void(1)'], ['https://x.test/']],
    ['script-url', ['<svg><a href="', '">x</a></svg>'], ['javascript:void(2)'], ['#top']],
  ];
  for (const [code, pieces, values, control] of cases) {
    const where = `${code} in ${pieces.join('${…}')}`;
    const fromStatic = await codes(async () => viaStatic(pieces, values));
    const fromCore = await codes(async () => viaCore(pieces, values));
    const quiet = await codes(async () => viaStatic(pieces, control));
    const quietCore = await codes(async () => viaCore(pieces, control));
    assert.deepEqual([...quiet, ...quietCore], [], `${where}: the control value says nothing on either`);
    if (isProduction) {
      assert.deepEqual(fromStatic, [], `${where}: production says nothing`);
      continue;
    }
    assert.ok(fromCore.includes(code), `CONTROL: core says ${where}: ${fromCore.join(' | ')}`);
    assert.deepEqual(fromStatic, [code], `static says ${where}, once: ${fromStatic.join(' | ')}`);
  }
});

/**
 * **Said once, and never twice for one value** (2026-11-19). Static draws once, so a value is said once per call site,
 * hole and value (a boolean), per tag, name and kind (an attribute value: core's key) or per tag, name and refused URL —
 * a list of a thousand cards says it once, and a different value still speaks. Where static already names a value
 * (`static-needs-renderer`: a function in an attribute) nothing else is said, where core says nothing (`?name`, a value
 * beside other text, `<style>`) neither does static, and a script URL in an array is `script-url` alone, as in core.
 */
test('static: each warning is said once per site and value, never twice for one value, and not where core is silent', { skip: isProduction && 'development diagnostics' }, async () => {
  const card = literal(['<li>', '</li>']);
  const cards = [];
  for (let i = 0; i < 1000; i++) cards.push(staticTier.html(card, false));
  const many = await codes(async () => viaStatic(['<ul>', '</ul>'], [[...cards, staticTier.html(card, true)]]));
  assert.deepEqual(many, ['boolean-child', 'boolean-child'], `a thousand false cards say it once, the true one once: ${many.join(' | ')}`);
  const listed = await codes(async () => viaStatic(['<p>', '</p>'], [new Set([false, false, true])]));
  assert.deepEqual(listed, ['boolean-child', 'boolean-child'], `the items of a Set: ${listed.join(' | ')}`);
  /** The same tag, name and kind again is quiet; another kind on it still speaks (core's key). */
  const kinds = await codes(async () => {
    viaStatic(['<p data-sa-3=', '>x</p>'], [{}]);
    viaStatic(['<p data-sa-3=', '>x</p>'], [{}]);
    viaStatic(['<p data-sa-3=', '>x</p>'], [[1]]);
  });
  assert.deepEqual(kinds, ['attribute-value', 'attribute-value'], kinds.join(' | '));
  const urls = await codes(async () => {
    for (let i = 0; i < 3; i++) viaStatic(['<a href=', '>x</a>'], ['javascript:void(3)']);
    viaStatic(['<a href=', '>x</a>'], ['javascript:void(4)']);
  });
  assert.deepEqual(urls, ['script-url', 'script-url'], urls.join(' | '));
  /** One value, one warning — and the same silence as core's. */
  for (const [pieces, values, said] of [
    [['<p data-sa-fn=', '>x</p>'], [() => 1], ['static-needs-renderer']],
    [['<p ?hidden=', '>x</p>'], [{}], []],
    [['<p data-sa-4="a ', '">x</p>'], [[1, 2]], []],
    [['<style>', '</style>'], [false], []],
    [['<a href=', '>x</a>'], [['javascript:void(5)']], ['script-url']],
  ]) {
    const fromStatic = await codes(async () => viaStatic(pieces, values));
    assert.deepEqual(fromStatic, said, `${pieces.join('${…}')}: ${fromStatic.join(' | ')}`);
    if (said[0] !== 'static-needs-renderer') assert.deepEqual(await codes(async () => viaCore(pieces, values)), said, `CONTROL: core says the same for ${pieces.join('${…}')}`);
  }
});
