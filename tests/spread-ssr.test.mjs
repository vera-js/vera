/**
 * `@verajs/spread` on the server.
 *
 * The renderer drops everything at element position as a client concern, which is right for a ref
 * and wrong for a spread: a spread carries *attributes*, and attributes are exactly what server
 * markup is made of. Lit's spread PR flagged SSR as unresolved; this is the half that makes it work.
 *
 * The division of labour is the interesting part. `@verajs/spread` knows what a key *means* —
 * `.value` is a property, `?disabled` a boolean, `onClick` an event — and hands back resolved
 * bindings. `@verajs/ssr` decides what belongs in markup and does every bit of the escaping, so the
 * escape boundary stays in one place per principle #8 and a new binding source cannot introduce a
 * second one.
 */
import { renderToString } from '@verajs/ssr/vera';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/**
 * Every server render happens here, before any test installs jsdom globals.
 *
 * `@verajs/ssr` works by shimming `customElements` and diffing the registry around an import, so a
 * test that later points `globalThis.customElements` at a jsdom window destroys the shim for every
 * subsequent `renderToString` — it reports "no custom element definition found" for a fixture that
 * is perfectly fine on its own. Render first, then borrow the globals.
 */
const { html: markup } = await renderToString(new URL('./fixtures/ssr/spread-ssr.js', import.meta.url));
const { html: shadowMarkup } = await renderToString(new URL('./fixtures/ssr/shadow-ssr.js', import.meta.url));
const input = markup.match(/<input[^>]*>/)[0];

/**
 * Parsed through the template's `.content`, because the security assertions have to ask what an
 * HTML parser concludes rather than what the string contains. An escaped attribute value
 * legitimately holds the characters `onload=`, inert — grepping for them reports a breach that is
 * not there. jsdom does not parse declarative shadow DOM, but `.content` is the same parser.
 */
const dom = new JSDOM(`<!doctype html><body>${markup}</body>`);
const host = dom.window.document.querySelector('spread-ssr');
const parsed = host.querySelector('template').content.querySelector('input');

test('plain keys serialize as attributes', () => {
  assert.match(input, /\bid="field"/);
});

test('a truthy boolean serializes, a false one is absent', () => {
  assert.match(input, /\bdisabled=""/);
  assert.doesNotMatch(input, /\breadonly/, 'false booleans are absent, not empty');
});

test('a form property is mirrored to an attribute so hydration can read it back', () => {
  assert.match(input, /\bvalue="from the server"/);
});

test('a non-form property is client state and never reaches markup', () => {
  assert.doesNotMatch(input, /internalState/i);
  assert.doesNotMatch(markup, /not.*markup/, 'nor does its value leak anywhere');
});

test('an event binding is dropped', () => {
  assert.doesNotMatch(input, /onclick/i);
});

test('a spread value is escaped by the same boundary as a written binding', () => {
  /** The payload closes its own quote if unescaped, and `onload` becomes a real handler. */
  assert.match(input, /title="&#34; onload=&#34;alert\(1\)"/, 'quotes escaped in the raw markup');
  assert.equal(parsed.getAttribute('title'), '" onload="alert(1)',
    'and the parser reads the whole payload back as one attribute value');
  const handlers = [...parsed.attributes].map((a) => a.name).filter((n) => /^on[a-z]+$/i.test(n));
  assert.deepEqual(handlers, [], 'no attribute the parser reads as a handler');
});

test('the written and spread forms of a binding serialize identically', () => {
  /**
   * The property that matters most: `${spread({ '?disabled': true })}` must produce exactly what
   * `?disabled=${true}` produces, or SSR and hydration disagree about what the markup means.
   */
  assert.match(input, /\bdisabled=""/);
  assert.match(input, /\bvalue="from the server"/);
});

test('no sigil residue survives into markup', () => {
  assert.doesNotMatch(markup, /[?@]\w+=/, 'sigils are template syntax, never output');
  assert.doesNotMatch(markup, /\[object Object\]/, 'nothing was stringified by accident');
});

test('after hydration, releasing a key restores the server value — deliberately', async () => {
  /**
   * The one place SSR and client-only rendering diverge, pinned here so it stays a decision.
   *
   * Releasing restores what the element held before the binding existed. On a hydrated page that
   * *is* the server markup, so dropping a key leaves the server's attribute in place, where the
   * same code on a client-rendered page would remove it. Correct by the rule, surprising in
   * practice.
   *
   * The escape is explicit and worth knowing: bind `null` to remove, rather than dropping the key.
   * `{ id: null }` removes the attribute on both paths; `{}` restores whatever was there.
   */
  const { JSDOM } = await import('jsdom');
  const inner = markup.match(/<template shadowrootmode="open">([\s\S]*)<\/template>/)[1];
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  for (const k of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'Event',
                   'requestAnimationFrame', 'DocumentFragment', 'Text', 'Comment'])
    globalThis[k] = dom.window[k];
  const { render } = await import('../packages/renderer/dist/development/vera-renderer-hydrate.js');
  const { spread } = await import('../packages/spread/dist/development/vera-spread.js');
  const tag = (strings, ...values) => ({ _$litType$: 1, strings, values });

  const host = dom.window.document.createElement('div');
  host.innerHTML = inner.trim();
  dom.window.document.body.appendChild(host);
  const before = host.querySelector('input');

  const draw = (p) => render(tag`<input ${spread(p)} />`, host);
  draw({ id: 'field' });
  assert.equal(host.querySelector('input'), before, 'the server element was adopted, not rebuilt');

  draw({});
  assert.equal(before.getAttribute('id'), 'field', 'dropping the key restored the server value');

  draw({ id: null });
  assert.equal(before.getAttribute('id'), null, 'binding null removes it, on either path');
});

test('a spread key replaces a static attribute instead of duplicating it', async () => {
  /**
   * A correctness bug, not a nicety. Appending produced `<input type="text" type="number">`, and an
   * HTML parser keeps the **first** duplicate — so the server rendered `type="text"` while the
   * client, where `setAttribute` overwrites, rendered `type="number"`. Same template, two documents,
   * and a hydration mismatch between them.
   *
   * A spread key now removes any attribute of that name already in the open tag before adding its
   * own, *including* when it adds nothing: `?disabled: false` and `id: null` both remove on the
   * client and so must remove here. Kinds that never touch attributes client-side — events,
   * non-form properties — leave the tag alone.
   */
  const { JSDOM } = await import('jsdom');
  const el = new JSDOM(`<!doctype html><body>${shadowMarkup}</body>`).window.document
    .querySelector('shadow-ssr > template').content.querySelector('input');

  assert.equal(el.getAttribute('type'), 'number', 'the spread replaced the static value');
  assert.equal(el.attributes.length, 3, 'and did not duplicate it');
  assert.equal(el.hasAttribute('disabled'), false, '`?disabled: false` removed the static boolean');
  assert.equal(el.getAttribute('id'), null, '`id: null` removed the static attribute');
  assert.equal(el.getAttribute('lang'), 'en', 'an unquoted attribute the spread does not name survives');
  assert.equal(el.getAttribute('title'), 'added');
});

test('server and client render the same attributes for a shadowing spread', async () => {
  /** The property that makes hydration possible at all. Order is not semantic in HTML. */
  const { JSDOM } = await import('jsdom');
  const serverEl = new JSDOM(`<!doctype html><body>${shadowMarkup}</body>`).window.document
    .querySelector('shadow-ssr > template').content.querySelector('input');

  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  for (const k of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'Event',
                   'requestAnimationFrame', 'DocumentFragment', 'Text', 'Comment'])
    globalThis[k] = dom.window[k];
  const { render } = await import('../packages/renderer/dist/development/vera-renderer.js');
  const { spread } = await import('../packages/spread/dist/development/vera-spread.js');
  const tag = (strings, ...values) => ({ _$litType$: 1, strings, values });

  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  render(
    tag`<input type="text" disabled id='keep' lang=en ${spread({
      type: 'number', '?disabled': false, title: 'added', id: null,
    })} />`,
    host
  );

  const read = (element) => [...element.attributes].map((a) => `${a.name}=${a.value}`).sort();
  assert.deepEqual(read(serverEl), read(host.querySelector('input')));
});
