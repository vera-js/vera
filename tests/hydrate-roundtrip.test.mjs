/**
 * **The server's real markup, hydrated** (2026-11-23). `hydrate-parity.test.mjs` writes the served markup by hand so it
 * does not depend on the SSR package, which also means it keeps checking the old bytes when `@verajs/ssr` changes what
 * it serves. Here `@verajs/ssr` serves each shape in a child process (it installs its own DOM globals, so it cannot
 * share a realm with jsdom), the client adopts that markup in jsdom, and the result is compared with a client render
 * from nothing. The shapes are the ones whose served bytes are least obvious: raw text, escapable raw text, a leading
 * LF, whitespace, references, foreign content, comments.
 *
 * Every shape must be ADOPTED (the server's node kept, both builds) and come out identical, except one difference that
 * is deliberate and asserted by name: **a value in a comment keeps the server's spacing.** Where a binding is dropped
 * the server leaves one space so the statics on either side cannot join into another token, so `<!-- ${x} -->` is
 * served with one space more than the client writes; adoption keeps a comment's text, and a comment is invisible.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './dist.mjs';

import { SHAPES, COMMENTS, ALL } from './fixtures/hydrate-roundtrip/shapes.mjs';

/** Served by the same build under test: the child inherits this process's conditions and `VERA_DIST`. */
/** Without `NODE_TEST_CONTEXT`: a child that inherits it may start the test harness and write its report into stdout. */
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const serve = fileURLToPath(new URL('./fixtures/hydrate-roundtrip/serve.mjs', import.meta.url));
const served = JSON.parse(execFileSync(process.execPath, [...process.execArgv, serve], { encoding: 'utf8', env }));

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
const { hydrating } = await import('./hydration.mjs');
const hydrateInto = await hydrating();
const { html } = await load('core');
const { renderInto } = await load('renderer');

/** The client's own part markers are bookkeeping, not part of the comparison. */
const strip = (host) => host.innerHTML.replace(/<!---->/g, '');
/** One strings array per shape, cached: two arrays are two templates. */
const arrays = new Map();
const make = (strings, values) => {
  if (!arrays.has(strings)) arrays.set(strings, Object.assign([...strings], { raw: [...strings] }));
  return html(arrays.get(strings), ...values);
};
/**
 * Adopts the served markup and renders from nothing. Adopted = the server's first element is still the one in the
 * container: a fallback clears it and renders fresh, in both builds (the fallback's warning is development's only).
 */
const roundTrip = (index) => {
  const [, strings, values] = ALL[index];
  const adopting = document.createElement('div');
  adopting.innerHTML = served[index];
  const first = adopting.firstElementChild;
  const { warn } = console;
  console.warn = () => {};
  try {
    hydrateInto(make(strings, values), adopting);
  } finally {
    console.warn = warn;
  }
  const fresh = document.createElement('div');
  renderInto(make(strings, values), fresh);
  return { adopted: first !== null && adopting.firstElementChild === first, hydrated: strip(adopting), client: strip(fresh) };
};

test('every shape the server serves is adopted and hydrates to exactly what a client render produces', () => {
  assert.equal(served.length, ALL.length, 'CONTROL: the server answered every shape');
  SHAPES.forEach(([label], index) => {
    const { adopted, hydrated, client } = roundTrip(index);
    assert.ok(adopted, `${label}: hydration fell back on the server's own markup (${JSON.stringify(served[index])})`);
    assert.equal(hydrated, client, `${label}: served ${JSON.stringify(served[index])}`);
  });
});

test("the one deliberate difference: a comment holding a value keeps the server's spacing, one space more", () => {
  COMMENTS.forEach(([label, , , expectedHydrated, expectedClient], offset) => {
    const index = SHAPES.length + offset;
    const { adopted, hydrated, client } = roundTrip(index);
    assert.ok(adopted, `${label}: hydration fell back (${JSON.stringify(served[index])})`);
    assert.equal(hydrated, expectedHydrated, `${label}: the hydrated DOM changed`);
    assert.equal(client, expectedClient, `${label}: the client-rendered DOM changed`);
    assert.notEqual(hydrated, client, `${label} no longer differs: drop it from this list and from the README`);
  });
});

test('CONTROL: the comparison notices served markup that does not match', () => {
  const index = SHAPES.findIndex(([label]) => label === 'CONTROL: plain text');
  const saved = served[index];
  served[index] = '<p>WRONG</p>';
  try {
    const { adopted, hydrated, client } = roundTrip(index);
    assert.ok(!adopted, 'the adoption check noticed markup the template does not describe');
    assert.equal(hydrated, client, 'and the page ends up as the client renders it');
  } finally {
    served[index] = saved;
  }
});
