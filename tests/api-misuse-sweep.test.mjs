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
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'customElements', 'DocumentFragment',
                   'Text', 'Comment', 'CSSStyleSheet', 'Event', 'CustomEvent', 'MouseEvent', 'location', 'history',
                   'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'ShadowRoot', 'NodeFilter'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderInto } = await load('renderer');
const { keyed } = await load('renderer/keyed');
const { tag, html: tagHtml } = await load('renderer/tag');
const routerModule = await load('router');
const { navigate } = routerModule;
const reactivity = await load('store');
const styleModule = await load('styles');

const skip = isProduction && 'development-only diagnostics';

/** Each entry: the call, and a word its message must contain beyond the function name. */
const CASES = [
  ['untrack(nonFunction)', () => core.untrack(42), /untrack: expected a function/],
  ['init(notAnElement)', () => core.init(null), /init: expected a component element/],
  ['createStore(notAnObject)', () => core.createStore(42), /createStore: expected an object/],
  ['applyStyles([notCSS], element)', () => styleModule.applyStyles([42], document.createElement('div')), /applyStyles: expected CSS/],
  ['a frozen store refusing a write', () => { const store = core.createStore(Object.freeze({ n: 1 })); store.n = 2; }, /createStore: this store's source object refused the write/],
  ['html("markup")', () => core.html('<p>x</p>'), /html: expected a template literal/],
  ['svg("markup")', () => core.svg('<c/>'), /svg: expected a template literal/],
  ['mathml("markup")', () => core.mathml('<m/>'), /mathml: expected a template literal/],
  ['css("text")', () => styleModule.css('p{}'), /css: expected a template literal/],
  ['renderInto(result) with no container', () => renderInto({}), /renderInto: expected a container node/],
  ['keyed(key) with no template', () => keyed('a'), /keyed: expected a template/],
  ['a content property beside content', () => renderInto(core.html`<div .textContent=${'v'}><b>s</b></div>`, document.createElement('div')), /renderer: <div> binds `\.textContent`/],
  ['a binding inside an SVG <title> beside an element', () => renderInto(core.html`<svg><title>${'a'}<desc></desc></title></svg>`, document.createElement('div')), /renderer: a binding inside <title> in SVG or MathML/],
  ['a binding inside an obsolete raw-text element', () => renderInto(core.html`<xmp>${'a'}</xmp>`, document.createElement('div')), /renderer: a binding inside <xmp> is never rendered/],
  ['a template ending inside a tag', () => renderInto(core.html`<p title=${'x'}`, document.createElement('div')), /renderer: a template cannot end inside a tag/],
  ['an expression in an attribute name', () => renderInto(core.html`<p data-${'x'}="1"></p>`, document.createElement('div')), /renderer: an attribute name cannot be an expression/],
  ['an expression in tag-name position', () => renderInto(core.html`<${'p'}>x</${'p'}>`, document.createElement('div')), /renderer: an expression in tag position/],
  ['tag("h1") called, not tagged', () => tag('h1'), /tag: expected a template literal/],
  ['a string interpolated into a tag', () => tag`${'h1'}`, /tag: only another tag may be interpolated/],
  ['a tag that is not an element name', () => tag(Object.assign(['a b'], { raw: ['a b'] })), /tag: "a b" is not an element name/],
  ['a tag outside tag position', () => tagHtml`<p>${tag`h1`}</p>`, /tag: a tag \(`h1`\) may only stand in tag position/],
  ['an object style on a tag component', () => tag`div`({ style: { color: 'red' } }), /tag: `style` expects a STRING/],
  ['children on a void tag component', () => tag`br`({ children: ['x'] }), /tag: <br> is a void element/],
  ['adoptStyles(nothing)', () => styleModule.adoptStyles(undefined), /adoptStyles: expected a component element/],
  ['applyStyles(sheet, nothing)', () => styleModule.applyStyles('p{}', undefined), /applyStyles: expected a component element/],
  /**
   * The eight below were guarded in the source and absent from this list — found by enumerating
   * every `name: expected …` message in the package sources and comparing, which is now the assertion
   * at the bottom of this file. A hand-kept list of guards is a list that stops growing when the
   * guards do: `computed`'s was added during the 2026-08-26 sweep and never landed here, and `wire`
   * is the most-called function in the framework.
   */
  ['wire(notAModule)', () => core.wire(42), /wire: expected a module or an insert descriptor/],
  ['wire(a descriptor whose fn is undefined)', () => core.wire({ on: 'render', fn: undefined, priority: 50 }), /wire: that object is not an insert descriptor/],
  ['wire(renderInto) — a function named like a module', () => core.wire(renderInto), /wire: `renderInto` is not a module — did you mean `renderer`\?/],
  ['wire({ priority: NaN })', () => core.wire({ on: 'probe-insert', fn: () => {}, priority: Number.NaN }), /wire: priority must be a finite number/],
  ['computed(notAFunction)', () => reactivity.computed(42), /computed: expected a function to derive the value from/],
  ['setRenderScheduler(notAFunction)', () => core.setRenderScheduler(42), /setRenderScheduler: expected a function/],
  ['setRouterRenderer(notAFunction)', () => routerModule.setRouterRenderer(42), /setRouterRenderer: expected a function/],
  ['setMatchFunction(notAFunction)', () => routerModule.setMatchFunction(42), /setMatchFunction: expected a function/],
  ['initRouter with no view', () => routerModule.initRouter(document.createElement('div'), {}), /initRouter: needs an element and a view/],
  ['setBasePath(notAString)', () => routerModule.setBasePath(42), /setBasePath: expected a string or null/],
  ['allowRenderLoop(notAnElement)', () => core.allowRenderLoop(42), /allowRenderLoop: expected a component element/],
];

/** Guards behind an async API: they REJECT rather than throw, so the coverage check below awaits them. */
const REJECTING = [['navigate(notAPath)', () => navigate(42)]];

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
 * A hand-built strings array is **data, not markup**: it owns no `raw`, exactly like a template-shaped object from
 * `JSON.parse`, so the renderer cannot tell the two apart and renders both as text — `html([markup])` was an
 * `unsafeHTML` nothing at the call site declared (`template-forgery.test.mjs`). Not a throw: the same check meets
 * attacker data. Trusted markup is a property binding, `.innerHTML=${markup}`.
 */
test('a hand-built strings array renders as text, never markup', () => {
  const result = core.html(['<p>hi</p>']);
  assert.equal(result.strings[0], '<p>hi</p>');
  const host = dom.window.document.createElement('div');
  const { warn } = console;
  console.warn = () => {};
  try {
    renderInto(result, host);
  } finally {
    console.warn = warn;
  }
  assert.equal(host.querySelector('p'), null);
  assert.match(host.textContent, /\[object Object\]/);
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
 * itself a defect.** (A hand-built `html([markup])` was once listed here as legitimate; it is the
 * `unsafeHTML` door the forged-template check closes — see the test above.)
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
    ['css with interpolation', () => styleModule.css`p { color: ${'red'} }`],
    ['untrack with a named function', () => core.untrack(function named() { return 1; })],
    ['applyStyles(sheet, element)', () => styleModule.applyStyles(styleModule.css`p{}`, shadowHost)],
  ];

  for (const [label, call] of accepted) assert.doesNotThrow(call, `a guard refuses ${label}`);
});

/**
 * **Every guard in the source has a case here.**
 *
 * The list above is hand-kept, and a hand-kept list of guards stops growing when the guards do. Eight
 * of the fifteen `name: expected …` messages in the package sources had no case when this was written —
 * including `wire`, the most-called function in the framework, and `computed`, whose guard was added
 * during the same audit that wrote the rest of this file.
 *
 * Derived from the source rather than restated, so adding a guard and forgetting a case fails here
 * instead of leaving a diagnostic nobody has ever executed.
 */
test('every by-name guard in the source is exercised above', async () => {
  /**
   * Two kinds of guard, both enumerated from the SOURCE: a literal `name: expected …` (packages not yet on the code
   * system) and a `misuse(…, 'code', …)` call (core and styles since 2026-10-09 — their prose lives in a table). A code is
   * exercised when some case THROWS a message ending in it: `(code)` in development, `…/e/code` in production.
   */
  const guards = new Set();
  const codes = new Set();
  for (const file of globSync('packages/*/src/**/*.{ts,js}', { cwd: root })) {
    if (file.endsWith('.d.ts')) continue;
    const text = readFileSync(join(root, file), 'utf8');
    for (const match of text.matchAll(/`([a-zA-Z]+): expected /g)) guards.add(match[1]);
    for (const match of text.matchAll(/misuse\([^,]+,\s*'([a-z][a-z0-9-]*)'/g)) codes.add(match[1]);
  }
  assert.ok(guards.size + codes.size >= 15, `only found ${guards.size} literal guards and ${codes.size} coded ones — has the message shape changed?`);

  const exercised = new Set(CASES.map(([, , pattern]) => /\/?\^?([a-zA-Z]+): expected/.exec(String(pattern))?.[1]).filter(Boolean));
  exercised.add('navigate');
  const thrownCodes = new Set();
  for (const [, call] of [...CASES, ...REJECTING]) {
    try { await call(); } catch (error) {
      const code = /\(([a-z][a-z0-9-]*)\)$|\/e\/([a-z][a-z0-9-]*)$/.exec(String(error?.message ?? ''));
      if (code) thrownCodes.add(code[1] ?? code[2]);
    }
  }
  const missing = [...guards].filter((name) => !exercised.has(name)).sort();
  const missingCodes = isProduction ? [] : [...codes].filter((code) => !thrownCodes.has(code)).sort();
  assert.deepEqual(
    [...missing, ...missingCodes],
    [],
    `guards with no misuse case: ${[...missing, ...missingCodes].join(', ')} — add one to CASES above`
  );
});
