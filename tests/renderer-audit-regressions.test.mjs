/**
 * Regressions found in the 2026-08-25 full-framework audit, renderer half.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment'])
  globalThis[key] = dom.window[key];

const { render } = await load('renderer');
const { html, tag } = await load('renderer/tag');

/* ── a string can never become a tag ─────────────────────────────────────────────────────────── */

/**
 * The refusal is the security property this entry exists for — the set of tags an app can produce
 * is fixed by its source, so a tag can never come from a request. It lived only in `tag` itself,
 * which guards interpolation into a tag *literal*; reaching tag position through `html` produced no
 * error and no element, because the base scanner reads the expression as an element ref on a tag
 * with no name and the surrounding markup renders as escaped text.
 */
test('a string in tag position is refused, not silently mangled', { skip: isProduction && 'the guard is __DEV__' }, () => {
  assert.throws(() => html`<${'script'}>x</${'script'}>`, /cannot become markup/);
  assert.throws(() => html`<${'div'}></${'div'}>`, /Only a tag may be interpolated/);
  assert.throws(() => html`<${null}></${null}>`, /null cannot become markup/);
});

test('a tag in tag position still works, and updates in place', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const draw = (t, body) => html`<${t} class="x">${body}</${t}>`;
  render(draw(tag`h1`, 'a'), host);
  assert.equal(host.querySelector('h1')?.textContent, 'a');
  const first = host.querySelector('h1');
  render(draw(tag`h1`, 'b'), host);
  assert.equal(host.querySelector('h1'), first, 'same tag keeps the element');
  render(draw(tag`h2`, 'c'), host);
  assert.equal(host.querySelector('h2')?.textContent, 'c', 'a different tag rebuilds');
});

/** A value elsewhere in the template must stay an ordinary binding. */
test('a non-tag value outside tag position is unaffected', () => {
  const host = document.createElement('div');
  document.body.append(host);
  render(html`<p title=${'t'}>${'body'}</p>`, host);
  assert.equal(host.querySelector('p')?.getAttribute('title'), 't');
  assert.equal(host.querySelector('p')?.textContent, 'body');
});

/**
 * The base renderer cannot refuse it — `<${x}>` is a legal element-ref position as far as the
 * scanner is concerned — but it can say what the author almost certainly meant.
 */
test('the base renderer names the tag entry for an expression in tag position', { skip: isProduction && 'the guard is __DEV__' }, async () => {
  const core = await load('core');
  const errors = [];
  const nativeError = console.error;
  console.error = (...args) => errors.push(String(args[0]));
  try {
    /** The scan happens when the renderer first builds the template, not when `html` is called. */
    const host = document.createElement('div');
    document.body.append(host);
    render(core.html`<${'div'}>x</${'div'}>`, host);
  } finally {
    console.error = nativeError;
  }
  assert.ok(
    errors.some((m) => m.includes('@verajs/renderer/tag')),
    'it must name the entry that does support runtime tag names'
  );
});
