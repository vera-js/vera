/**
 * **An element the HTML parser drops must not take other elements' bindings with it.**
 *
 * A parser discards elements its parent's content model forbids — `<div>` inside `<select>`, a
 * nested `<form>` — and that is correct of it. What was not correct is what happened next here: the
 * dropped element took its binding MARKER with it, markers paired with bindings by document order,
 * and so every binding after the casualty was handed its predecessor's name and value.
 *
 * The consequence is a security one, not a cosmetic one, and it is the reason this is guarded in
 * PRODUCTION rather than only warned about in development:
 *
 *     html`<select><a href=${untrusted}>row</a></select><a href=${safe}>go</a>`
 *
 * rendered `<a href="javascript:alert(1)">go</a>` — the discarded element's value, on a real
 * clickable link, while the app's own `href` never applied. A `<select>` filled from data with a
 * row wrapper is an ordinary mistake, and nothing anywhere reported it.
 *
 * The fix is that each marker carries its own spec index in its attribute NAME, so pairing is
 * addressed rather than positional: a missing marker is skipped, its value consumed and discarded,
 * and every surviving binding keeps its own element. Measured at 33 B gzipped on the base renderer.
 *
 * The development half is the other rule this audit kept applying: the repair would otherwise
 * SILENCE the problem, so the skip is where the warning lives.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node',
  'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = key === 'window' ? dom.window : dom.window[key];

const { renderer } = await load('renderer');
const core = await load('core');
core.wire([renderer]);
const { renderInto } = await load('renderer/hydrate');

const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(resolve));

/** A template built by hand, so a case can place a binding on an element the parser will discard. */
const render = async (strings, values) => {
  const host = dom.window.document.createElement('div');
  dom.window.document.body.append(host);
  const real = console.warn;
  const warned = [];
  console.warn = (message) => warned.push(String(message));
  try {
    renderInto({ ['_$litType$']: 1, strings: Object.assign(strings, { raw: [] }), values }, host);
    await frame();
  } finally {
    console.warn = real;
  }
  return { host, warned: warned.filter((m) => m.includes('never reached the parsed tree')) };
};

/**
 * Nestings the parser DISCARDS an element for. Deliberately short: this suite is not a content
 * model, and the guard it tests does not consult one — it counts what actually survived, so it
 * holds for dropping contexts nobody enumerated. These two are the reachable ones measured
 * 2026-09-12, and they are here to prove the guard fires, not to enumerate HTML.
 */
const DROPS = {
  'a div inside a select': ['<select><i title=', '>row</i></select><b title=', '>after</b>'],
  'a form inside a form': ['<form><form title=', '>row</form></form><b title=', '>after</b>'],
};

/**
 * Nestings the parser RESTRUCTURES without discarding anything. Every binding survives, so nothing
 * here may warn — this is the control that stops the guard being satisfied by a pattern that fires
 * on any unusual nesting at all.
 */
const RESTRUCTURES = {
  'a block inside a paragraph': ['<p><i title=', '>x</i></p><b title=', '>after</b>'],
  'a non-table element in a table': ['<table><i title=', '>x</i></table><b title=', '>after</b>'],
  'a row without a tbody': ['<table><tr title=', '><td>c</td></tr></table><b title=', '>after</b>'],
  'a list item in a list item': ['<ul><li><li title=', '>x</li></li></ul><b title=', '>after</b>'],
  'an anchor in an anchor': ['<a><a title=', '>x</a></a><b title=', '>after</b>'],
  'an option inside a select': ['<select><option title=', '>x</option></select><b title=', '>after</b>'],
  'ordinary nesting': ['<div><i title=', '>x</i></div><b title=', '>after</b>'],
};

test('a surviving binding keeps its own element, whatever the parser discarded', async () => {
  let checked = 0;
  for (const [name, strings] of Object.entries({ ...DROPS, ...RESTRUCTURES })) {
    const { host } = await render([...strings], ['CASUALTY', 'survivor']);
    checked++;
    assert.equal(
      host.querySelector('b')?.getAttribute('title'),
      'survivor',
      `${name}: a later binding was handed the discarded element's value`
    );
    host.remove();
  }
  assert.equal(checked, Object.keys(DROPS).length + Object.keys(RESTRUCTURES).length,
    'NON-ZERO CONTROL: every case must actually have been rendered');
});

/**
 * The case that makes this a production guard. Stated as its own test rather than a row above,
 * because the row above would pass on a renderer that simply dropped BOTH bindings — and dropping
 * the app's own `href` is not the failure this prevents.
 */
test('a discarded element cannot move an untrusted value onto a live link', async () => {
  const { host } = await render(
    ['<select><a href=', '>row</a></select><a href=', '>go</a>'],
    ['javascript:alert(1)', '/safe/path']
  );
  const link = host.querySelector('a');
  assert.ok(link, 'NON-ZERO CONTROL: the surviving link must exist, or this asserts nothing');
  assert.equal(link.getAttribute('href'), '/safe/path',
    "the discarded element's href landed on a real, clickable link and the app's own never applied");
  host.remove();
});

test('the author is told, and only when something was actually lost',
  { skip: isProduction && 'diagnostics are folded away' }, async () => {
    for (const [name, strings] of Object.entries(DROPS)) {
      const { warned, host } = await render([...strings], ['CASUALTY', 'survivor']);
      assert.equal(warned.length, 1, `${name}: the repair must not silence the report`);
      host.remove();
    }
    for (const [name, strings] of Object.entries(RESTRUCTURES)) {
      const { warned, host } = await render([...strings], ['a', 'b']);
      assert.deepEqual(warned, [], `${name}: nothing was lost here, so nothing may be reported`);
      host.remove();
    }
  });

/**
 * **Reshaping is not the same as invalid, and a diagnostic built here must know the difference.**
 *
 * Of the cases above, `a row without a tbody` and `a list item in a list item` are **conforming
 * HTML**: the `<tbody>` start tag and the `</li>` end tag are both omissible, so the parser is
 * inserting exactly what the spec prescribes. They are not authoring mistakes and a warning that
 * fires on them is a false positive on correct code.
 *
 * That class is far wider than those two — **every omissible tag produces it**, and the corpus below
 * is nine of them. It is pinned because the open question this file exists next to is whether to add
 * a content-model warning for reshaping, and the tempting mechanism (compare the tree you got against
 * the tree your template describes) fires on every one of these. A structural differential is
 * therefore NOT the cheap alternative to a conformance table that it first appears to be: to stay
 * quiet here it would have to know which tags are omissible, which is a content-model table arriving
 * by the back door. Warn on INVALID nesting or do not warn at all.
 *
 * The other half of the pin is the stronger one: every binding must land on its own element through
 * all of this. The suite above checks the witness after the structure; this checks each binding
 * inside it too, because an implied close or an implied open moves elements the template never
 * mentioned and addressed pairing is what has to survive that.
 */
const VALID_RESHAPES = {
  'implied </p>': ['<p title=', '>a</p><p title=', '>b</p><b title=', '>after</b>'],
  'implied </li>': ['<ul><li title=', '>a<li title=', '>b</ul><b title=', '>after</b>'],
  'implied </li> in an ol': ['<ol><li title=', '>a<li title=', '>b</ol><b title=', '>after</b>'],
  'implied <tbody>': ['<table><tr title=', '><td title=', '>c</table><b title=', '>after</b>'],
  'implied </td>': ['<table><tr><td title=', '>a<td title=', '>b</table><b title=', '>after</b>'],
  'implied </option>': ['<select><option title=', '>a<option title=', '>b</select><b title=', '>after</b>'],
  'implied </dt> and </dd>': ['<dl><dt title=', '>a<dd title=', '>b</dl><b title=', '>after</b>'],
  'implied </th>': ['<table><tr><th title=', '>a<th title=', '>b</table><b title=', '>after</b>'],
  'a thead then an implied tbody':
    ['<table><thead><tr><td title=', '>h</thead><tr><td title=', '>c</table><b title=', '>after</b>'],
  /** The control: nothing about this one is reshaped, so a failure here is the harness, not HTML. */
  'CONTROL ordinary nesting': ['<div title=', '><span title=', '>x</span></div><b title=', '>after</b>'],
};

test('conforming HTML the parser reshapes keeps every binding on its own element', async () => {
  let checked = 0;
  for (const [name, strings] of Object.entries(VALID_RESHAPES)) {
    const { host } = await render([...strings], ['ONE', 'TWO', 'survivor']);
    const landed = [...host.querySelectorAll('[title]')].map((el) => el.getAttribute('title'));
    assert.deepEqual(landed, ['ONE', 'TWO', 'survivor'],
      `${name}: bindings did not land in order on their own elements`);
    checked++;
    host.remove();
  }
  assert.equal(checked, Object.keys(VALID_RESHAPES).length,
    'NON-ZERO CONTROL: every case must actually have been rendered');
  assert.ok(checked >= 9, 'the corpus is a floor, not a census — conforming reshapes are many');
});

/**
 * The control that stops the two tests around it passing vacuously. If a corpus entry's markup did
 * not actually reshape — a typo, or a construction the parser leaves alone — it would be testing
 * ordinary nesting under an alarming name, and both neighbours would go green having proved nothing
 * about implied tags at all.
 */
test('the corpus actually reshapes — implied tags really are being inserted and closed', async () => {
  const { host: table } = await render(
    [...VALID_RESHAPES['implied <tbody>']], ['ONE', 'TWO', 'survivor']);
  assert.ok(table.querySelector('tbody'),
    'the parser must have inserted a <tbody> the template never wrote, or this case reshapes nothing');
  table.remove();

  const { host: list } = await render(
    [...VALID_RESHAPES['implied </li>']], ['ONE', 'TWO', 'survivor']);
  const items = [...list.querySelectorAll('li')];
  assert.equal(items.length, 2, 'both list items must exist');
  assert.ok(!items[0].contains(items[1]),
    'the second <li> must be a SIBLING — if it nested, the implied close never happened');
  list.remove();
});

test('conforming HTML never warns, however much the parser moves it',
  { skip: isProduction && 'diagnostics are folded away' }, async () => {
    for (const [name, strings] of Object.entries(VALID_RESHAPES)) {
      const { warned, host } = await render([...strings], ['ONE', 'TWO', 'survivor']);
      assert.deepEqual(warned, [],
        `${name}: this markup is CONFORMING — the parser is doing what the spec prescribes, and ` +
          'telling the author they made a mistake is a false positive on correct code');
      host.remove();
    }
  });

test('the warning names the element that was DISCARDED, not one that rendered',
  { skip: isProduction && 'diagnostics are folded away' }, async () => {
    const { warned, host } = await render(
      ['<select><i title=', '>row</i></select><b title=', '>after</b>'],
      ['CASUALTY', 'survivor']
    );
    assert.equal(warned.length, 1);
    /**
     * `<i>` is the casualty; `<b>` rendered correctly. Pointing an author at `<b>` is the exact
     * failure the message exists to cure — the symptom is already remote from the cause, and a
     * diagnostic that names the wrong element makes the distance worse rather than closing it.
     */
    assert.match(warned[0], /on <i>/, 'the discarded element must be named');
    assert.doesNotMatch(warned[0], /on <b>/, 'an element that rendered correctly must not be blamed');
    assert.match(warned[0], /content model/, 'and the reason it was discarded');
    host.remove();
  });
