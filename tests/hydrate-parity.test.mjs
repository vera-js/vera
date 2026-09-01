/**
 * Where a hydrated DOM differs from a client-rendered one, and where it must not.
 *
 * `hydrate.ts` used to call the `<textarea>` carve-out "the one respect in which a hydrated DOM is
 * not byte-identical to a client-rendered one". There are four, and they share a cause: `@verajs/ssr`
 * mirrors `.value`, `.checked` and `.selected` on form elements into markup, because markup is the
 * only way form state reaches the client at all. The client sets those as properties and writes no
 * attribute, exactly as a browser does — so the server's copy stays behind after adoption.
 *
 * The count mattered more than it looks. A probe comparing a hydrated DOM against a client-rendered
 * one flagged `<input ${spread({ '.value': … })}>` as a defect, on the strength of the source saying
 * there was only one such case. A list is what makes that question answerable, so this is the list —
 * and the other half of it is the assertion that **nothing else** differs, which is what would catch
 * a real divergence appearing.
 */
import { load, isProduction } from './dist.mjs';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import test from 'node:test';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent',
])
  globalThis[key] = dom.window[key];

const { html } = await load('core');
const { renderInto } = await load('renderer');
const { renderInto: hydrateInto } = await load('renderer/hydrate');
const { keyed } = await load('renderer/keyed');
const { spread } = await load('renderer/spread');
const { hold } = await load('renderer');

/** The client's own part markers are bookkeeping and are not part of the comparison. */
const strip = (host) => host.innerHTML.replace(/<!---->/g, '');

/**
 * Renders `make()` two ways — adopting `markup`, and from nothing — and answers both results plus
 * whether adoption actually happened.
 */
const bothWays = (make, markup) => {
  const said = [];
  const { warn } = console;
  console.warn = (...args) => said.push(args.join(' '));
  const adopting = document.createElement('div');
  adopting.innerHTML = markup;
  const served = adopting.firstElementChild;
  try {
    hydrateInto(make(), adopting);
  } finally {
    console.warn = warn;
  }
  const fresh = document.createElement('div');
  renderInto(make(), fresh);
  return {
    hydrated: strip(adopting),
    client: strip(fresh),
    adopted: said.filter((line) => /fell back/.test(line)).length === 0,
    keptNode: adopting.firstElementChild === served,
  };
};

/**
 * The four, by name. The markup on the left is what `@verajs/ssr` emits for that binding — written
 * out rather than generated, so this suite does not depend on the SSR package.
 */
test('a form binding leaves the server default behind, and that is deliberate', () => {
  for (const [label, markup, make, expectedHydrated, expectedClient] of [
    ['input .value', '<input value="typed">', () => html`<input .value=${'typed'} />`, '<input value="typed">', '<input>'],
    ['input .checked', '<input type="checkbox" checked="">', () => html`<input type="checkbox" .checked=${true} />`, '<input type="checkbox" checked="">', '<input type="checkbox">'],
    ['option .selected', '<select><option selected="">a</option></select>', () => html`<select><option .selected=${true}>a</option></select>`, '<select><option selected="">a</option></select>', '<select><option>a</option></select>'],
    ['textarea .value', '<textarea>body</textarea>', () => html`<textarea .value=${'body'}></textarea>`, '<textarea>body</textarea>', '<textarea></textarea>'],
  ]) {
    const { hydrated, client, adopted } = bothWays(make, markup);
    if (!isProduction) assert.ok(adopted, `${label}: hydration fell back`);
    assert.equal(hydrated, expectedHydrated, `${label}: the hydrated DOM changed`);
    assert.equal(client, expectedClient, `${label}: the client-rendered DOM changed`);
    assert.notEqual(hydrated, client, `${label} no longer differs — the list above needs shortening`);
  }
});

/**
 * And the other half: everything else has to come out identical. This is the assertion that would
 * catch a real divergence, and the reason the four above are enumerated rather than tolerated.
 */
test('every other binding hydrates to exactly what a client render produces', () => {
  const rows = ['a', 'b', 'c'];
  for (const [label, markup, make] of [
    ['a plain attribute', '<div class="c">x</div>', () => html`<div class=${'c'}>x</div>`],
    ['a plain property', '<div>x</div>', () => html`<div .title=${'t'}>x</div>`],
    ['a boolean attribute, true', '<b hidden="">x</b>', () => html`<b ?hidden=${true}>x</b>`],
    ['a boolean attribute, false', '<b>x</b>', () => html`<b ?hidden=${false}>x</b>`],
    ['text', '<p>hello</p>', () => html`<p>${'hello'}</p>`],
    ['falsy children', '<p>0||||false</p>', () => html`<p>${0}|${''}|${null}|${undefined}|${false}</p>`],
    ['entities and unicode', '<p>a &amp; b &lt; c — héllo 日本 🎉</p>', () => html`<p>${'a & b < c'} — héllo 日本 🎉</p>`],
    ['a comment in the template', '<p>a<!-- note -->b</p>', () => html`<p>a<!-- note -->b</p>`],
    ['nested templates', '<div><p><i>v</i></p></div>', () => html`<div>${html`<p>${html`<i>${'v'}</i>`}</p>`}</div>`],
    ['an array of templates', '<ul><li>a</li><li>b</li><li>c</li></ul>', () => html`<ul>${rows.map((r) => html`<li>${r}</li>`)}</ul>`],
    ['a keyed list', '<ul><li data-k="a">a</li><li data-k="b">b</li><li data-k="c">c</li></ul>', () => html`<ul>${rows.map((r) => keyed(r, html`<li data-k=${r}>${r}</li>`))}</ul>`],
    ['a keyed list beside plain children', '<ul><li>first</li><li>a</li><li>b</li><li>c</li><li>last</li></ul>', () => html`<ul><li>first</li>${rows.map((r) => keyed(r, html`<li>${r}</li>`))}<li>last</li></ul>`],
    ['spread', '<div id="x" data-n="1">spread</div>', () => html`<div ${spread({ id: 'x', 'data-n': '1', '?hidden': false })}>spread</div>`],
    ['hold', '<div><span>v</span></div>', () => html`<div>${hold(html`<span>v</span>`)}</div>`],
  ]) {
    const { hydrated, client, adopted, keptNode } = bothWays(make, markup);
    if (!isProduction) assert.ok(adopted, `${label}: hydration fell back on markup a server would emit`);
    assert.ok(keptNode, `${label}: the server's element was replaced rather than adopted`);
    assert.equal(hydrated, client, `${label}: hydrating and rendering fresh disagree`);
  }
});

/**
 * The control: a probe that cannot notice a difference proves nothing about the ones above.
 *
 * **Detected structurally, not by the warning.** The fallback message is `__DEV__`-only, so a
 * warning-based control passes vacuously in production — which is exactly how this was written
 * first, and the gate's production pass is what said so. A fallback clears the container and renders
 * fresh, so the server's element stops being the one in the document, and *that* is true in both
 * builds.
 */
test('the comparison notices markup that does not match the template', () => {
  const unnoticed = [];
  for (const [label, markup] of [
    ['changed text', '<div class="c">WRONG</div>'],
    ['an extra element', '<div class="c">x</div><b>extra</b>'],
    ['a different tag', '<span class="c">x</span>'],
    ['the wrong number of children', '<div class="c">x</div><div class="c">x</div>'],
  ]) {
    const { adopted, keptNode } = bothWays(() => html`<div class=${'c'}>x</div>`, markup);
    if (keptNode || (!isProduction && adopted)) unnoticed.push(label);
  }
  assert.deepEqual(unnoticed, [], 'the comparison did not notice a corrupted server render');

  /** An *empty* container is not a corruption — it is the client-only path, where there is nothing
   * to adopt and rendering fresh is the whole point. It was in the list above until it failed. */
  const { adopted, hydrated, client } = bothWays(() => html`<div class=${'c'}>x</div>`, '');
  if (!isProduction) assert.ok(adopted, 'an empty container is not a mismatch');
  assert.equal(hydrated, client, 'and it renders exactly what a client render produces');
});

/**
 * **A disagreeing attribute is not in that list, and must not be.** The README is explicit — "an
 * attribute that disagrees is simply re-set during adoption and is not a fallback at all" — so the
 * server's wrong value is repaired and the whole render is kept, which is the cheapest possible
 * response and the reason attributes are not worth a mismatch.
 *
 * It is here because it was written into the control above first, where it read as the control
 * failing. A behaviour that looks like a missed detection until you read why is worth an assertion
 * of its own.
 */
test('an attribute the server got wrong is repaired rather than thrown away', () => {
  const { hydrated, client, adopted, keptNode } = bothWays(
    () => html`<div class=${'c'}>x</div>`,
    '<div class="WRONG">x</div>'
  );
  if (!isProduction) assert.ok(adopted, 'a wrong attribute should not cost the render');
  assert.ok(keptNode, "the server's element should be kept");
  assert.equal(hydrated, client, 'and the attribute should end up correct');
});
