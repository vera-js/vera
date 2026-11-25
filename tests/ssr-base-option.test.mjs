/**
 * **`base` is a directory URL** (2026-11-23). Its message offered "a URL or a path string", but a path such as
 * `/srv/components/` has nothing to resolve against: the containment check threw `TypeError: Invalid URL` from inside
 * the package, naming neither the option nor what it wants. A string that is not an absolute URL is now refused as an
 * option (`ssr-option`), saying what to pass; a URL, or its string, works as before.
 *
 * **A URL that holds no directory is refused the same way** (2026-11-25). The check was `URL.canParse(value)`, but the
 * bound resolves `.` against the value: a Windows path (`C:\dir\` reads as the scheme `c:`), a `mailto:` or a `data:` URL
 * parses, has an opaque path, and threw `Invalid URL` from the bound. So the rows below hold one of each, as a string and
 * as a URL, beside the paths.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const { renderToString } = await import('@verajs/ssr');
const components = new URL('./tests/fixtures/ssr/', pathToFileURL(process.cwd() + '/'));
const page = new URL('content-ssr.js', components);

test('a path is refused as the option, saying what base wants', async () => {
  const opaque = ['C:\\projects\\x\\', 'mailto:a@b', 'data:text/plain,x'];
  for (const base of [fileURLToPath(components), 'tests/fixtures/ssr/', ...opaque, ...opaque.map((text) => new URL(text))]) {
    await assert.rejects(
      () => renderToString(page, { tag: 'content-page', base }),
      (error) => error instanceof TypeError && /\(ssr-option\)/.test(error.message) && /base/.test(error.message) && /file: URL/.test(error.message),
      String(base)
    );
  }
});

test('CONTROL: a URL and its string contain the module, and still refuse one outside', async () => {
  for (const base of [components, components.href]) {
    const { html } = await renderToString(page, { tag: 'content-page', base });
    assert.ok(html.length > 0, `${base}: rendered`);
  }
  await assert.rejects(() => renderToString(page, { tag: 'content-page', base: new URL('./tests/fixtures/ssr-throws/', pathToFileURL(process.cwd() + '/')) }), /ssr-url-refused/);
});

/**
 * A URL or a Set made in another realm is still one: `instanceof` refused both as the wrong kind. jsdom's window has a
 * `URL` class of its own (a test harness hands one in), and a `vm` context a `Set` of its own.
 */
test('a URL and a Set from another realm are taken as the options they are', async () => {
  const base = new new JSDOM('').window.URL(components.href);
  const seen = vm.runInNewContext('new Set()');
  assert.equal(base instanceof URL, false, "CONTROL: the URL is not this realm's");
  assert.equal(seen instanceof Set, false, "CONTROL: the Set is not this realm's");
  const { html } = await renderToString(page, { tag: 'content-page', base, seen });
  assert.ok(html.length > 0);
  assert.ok(seen.size > 0, 'the page wrote into the Set it was given');
  await assert.rejects(() => renderToString(page, { tag: 'content-page', seen: {} }), /\(ssr-option\)/);
  await assert.rejects(() => renderToString(page, { tag: 'content-page', seen: { [Symbol.toStringTag]: 'Set' } }), /\(ssr-option\)/);
  await assert.rejects(() => renderToString(page, { tag: 'content-page', base: { href: components.href } }), /\(ssr-option\)/);
});
