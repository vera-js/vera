/**
 * Every exported function of every published entry point, handed the wrong thing.
 *
 * Passes 22 and 80 took this lens and found three defects between them. The second sweep took it
 * again **mechanically** — every export of all thirteen entry points, crossed with seven wrong
 * values, filtered for errors that name an internal rather than the call — and found six more that
 * a hand-picked pass had missed. Enumerating beats choosing.
 *
 * The failure mode being guarded is specific: not "it threw", which is usually right, but "it threw
 * a message about its own first line". `Cannot read properties of undefined (reading 'appendChild')`
 * is true and useless; it names neither the function called nor the argument that was wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'customElements', 'DocumentFragment',
                   'Text', 'Comment', 'CSSStyleSheet', 'Event', 'CustomEvent', 'MouseEvent', 'location', 'history',
                   'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'ShadowRoot', 'NodeFilter'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderInto } = await load('renderer');
const { keyed } = await load('renderer/keyed');
const { tag } = await load('renderer/tag');
const { navigate } = await load('router');
const styleModule = await load('styles');

const skip = isProduction && 'development-only diagnostics';

/** Each entry: the call, and a word its message must contain beyond the function name. */
const CASES = [
  ['untrack(nonFunction)', () => core.untrack(42), /untrack: expected a function/],
  ['html("markup")', () => core.html('<p>x</p>'), /html: expected a template literal/],
  ['svg("markup")', () => core.svg('<c/>'), /svg: expected a template literal/],
  ['mathml("markup")', () => core.mathml('<m/>'), /mathml: expected a template literal/],
  ['css("text")', () => core.css('p{}'), /css: expected a template literal/],
  ['renderInto(result) with no container', () => renderInto({}), /renderInto: expected a container node/],
  ['keyed(key) with no template', () => keyed('a'), /keyed: expected a template/],
  ['tag("h1") called, not tagged', () => tag('h1'), /tag: expected a template literal/],
  ['adoptStyles(nothing)', () => styleModule.adoptStyles(undefined), /adoptStyles: expected a component element/],
  ['applyStyles(sheet, nothing)', () => styleModule.applyStyles('p{}', undefined), /applyStyles: expected a component element/],
];

for (const [label, call, expected] of CASES) {
  test(`${label} names the mistake`, { skip }, () => {
    assert.throws(call, (error) => {
      assert.match(error.message, expected, `the message does not name the call: ${error.message}`);
      assert.doesNotMatch(
        error.message,
        /Cannot read propert|Cannot set propert|is not a function|is not iterable/,
        `the message still leaks an internal: ${error.message}`
      );
      return true;
    });
  });
}

test('navigate(undefined) names the mistake rather than rejecting with an internal', { skip }, async () => {
  await assert.rejects(() => navigate(undefined), (error) => {
    assert.match(error.message, /navigate: expected a path or a \{ name, params \} object/);
    return true;
  });
});

/**
 * The narrowing that matters: a hand-built strings array is **not** refused. `ssr-scale.test.mjs`
 * builds a hundred nested components that way and it works — the guard exists for the silent case,
 * a string, not for every shape that is not a literal.
 */
test('a hand-built strings array is still accepted', () => {
  const result = core.html(['<p>hi</p>']);
  assert.equal(result.strings[0], '<p>hi</p>');
  const host = dom.window.document.createElement('div');
  renderInto(result, host);
  assert.match(host.innerHTML, /<p>hi<\/p>/);
});

test('and every guarded call still works when called correctly', () => {
  assert.equal(core.untrack(() => 7), 7);
  assert.ok(core.html`<p>${1}</p>`.strings.raw);
  const host = dom.window.document.createElement('div');
  renderInto(core.html`<b>${'x'}</b>`, host);
  assert.match(host.innerHTML, /<b>x<\/b>/);
  assert.equal(keyed('id', core.html`<i>x</i>`).key, 'id');
});

/**
 * The inverse, and the half that is easy to skip: **a guard that refuses something legitimate is
 * itself a defect.** The first version of the template-literal check tested for `raw`, which also
 * refused a hand-built `html([markup])` that `ssr-scale.test.mjs` depends on — caught by the full
 * suite rather than by this file, which is the wrong way round.
 *
 * So every shape the guards must let through is listed here explicitly, including the awkward ones:
 * a ShadowRoot and a DocumentFragment are containers, a `hold()` result is a legal thing to key, and
 * a key may be a number or an object.
 */
test('no guard refuses a legitimate input', async () => {
  const { hold } = await load('renderer');
  const { html: tagHtml } = await load('renderer/tag');
  const D = dom.window.document;
  const shadowHost = D.createElement('div');
  const shadow = shadowHost.attachShadow({ mode: 'open' });
  const heading = tag`h1`;

  const accepted = [
    ['renderInto into an Element', () => renderInto(core.html`<p>${1}</p>`, D.createElement('div'))],
    ['renderInto into a ShadowRoot', () => renderInto(core.html`<p>${1}</p>`, shadow)],
    ['renderInto into a DocumentFragment', () => renderInto(core.html`<p>${1}</p>`, D.createDocumentFragment())],
    ['keyed wrapping a template', () => keyed('a', core.html`<li>${1}</li>`)],
    ['keyed wrapping a hold()', () => keyed('a', hold(core.html`<li>${1}</li>`))],
    ['keyed with a numeric key', () => keyed(0, core.html`<li>${1}</li>`)],
    ['keyed with an object key', () => keyed({}, core.html`<li>${1}</li>`)],
    ['tag with no interpolation', () => tag`h1`],
    ['tag used in a template', () => tagHtml`<${heading}>x</${heading}>`],
    ['html with no interpolation', () => core.html`<p>x</p>`],
    ['css with interpolation', () => core.css`p { color: ${'red'} }`],
    ['untrack with a named function', () => core.untrack(function named() { return 1; })],
    ['applyStyles(sheet, element)', () => styleModule.applyStyles(core.css`p{}`, shadowHost)],
  ];

  for (const [label, call] of accepted) assert.doesNotThrow(call, `a guard refuses ${label}`);
});
