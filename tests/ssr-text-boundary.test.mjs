/**
 * **The server and the client must agree about text, and two characters make that impossible to
 * assume.**
 *
 * The HTML input-stream preprocessor rewrites exactly two things *before* tokenization, so a raw
 * byte written into markup does not always come back:
 *
 * - **CR and CRLF collapse to a single LF.** The server rendered `a\r\nb`, the client read back
 *   `a\nb`, and the two sides held different strings on every render of anything carrying a Windows
 *   newline — a `<textarea>` value, a CSV cell, a string from an HTTP payload. Nothing was injected
 *   and nothing looked wrong; hydration simply mismatched, forever, silently.
 * - **NUL is dropped in text and becomes U+FFFD in an attribute**, and `&#0;` is a parse error that
 *   also becomes U+FFFD. There is no spelling that round-trips, so this one is a documented
 *   limitation rather than a defect (see `packages/ssr/README.md`).
 *
 * Character references are resolved *after* preprocessing, which is why CR is fixable and NUL is
 * not. `&#13;` was **verified in Chromium, Firefox and WebKit**, all three identical: raw CRLF
 * parses to `[97, 10, 98]` while `a&#13;\nb` parses to `[97, 13, 10, 98]`, in text and in attribute
 * values alike.
 *
 * **Two probe errors are baked into how this test is written**, because both looked exactly like
 * framework defects:
 *
 * 1. **Parse the server's markup once.** Taking `template.innerHTML` and parsing the result again
 *    loses the CR without any help from Vera — the HTML *serializer* does not escape CR, so a round
 *    trip through `innerHTML` drops what the markup correctly carried. The first version of this
 *    check did exactly that and reported a fix as still broken.
 * 2. **Read the markup as bytes, not as text.** Python's universal-newline translation quietly
 *    turned `\r\n` into `\n` while I was inspecting the output, which made a faithful serializer
 *    look like it was dropping the CR.
 *
 * The server render runs in its own process, because importing `@verajs/ssr` installs a DOM and a
 * renderer of its own and cannot share a process with a client render.
 */
import './dom-globals.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';
import { CASES } from './fixtures/ssr/text-boundary-cases.js';

const root = new URL('..', import.meta.url).pathname;

/**
 * **Two characters cannot survive a server round trip at all, for two different reasons.**
 *
 * - `NUL` — the HTML preprocessor drops it in text and rewrites it to U+FFFD in an attribute, and
 *   `&#0;` is a parse error that also becomes U+FFFD. No spelling round-trips.
 * - `lone surrogate` — `\uD800` with no pair is not encodable in UTF-8, so **the transport** mangles
 *   it, not the parser: `Buffer.toString('utf8')` yields U+FFFD, and so does every HTTP response.
 *
 * The second one is here because the first version of this check ran the server render **in the same
 * process** and compared JS strings directly, which never crosses an encoding boundary — so a lone
 * surrogate matched, and the defect was invisible. Running the server out of process is not only
 * about `@verajs/ssr` installing its own DOM; it is what makes the bytes real.
 */
const UNREPRESENTABLE = new Set(['NUL', 'lone surrogate']);

/** The server half, out of process. */
const serverMarkup = execFileSync(
  process.execPath,
  [
    '--conditions',
    'development',
    '-e',
    `import('@verajs/ssr/vera').then(async ({ renderToString }) => {
       const { html } = await renderToString(new URL('./tests/fixtures/ssr/text-boundary.js', 'file://${root}'), { tag: 't-text' });
       process.stdout.write(html);
     })`,
  ],
  { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24 }
);

/** ONE parse — see note 1 above. */
const doc = new JSDOM(`<!doctype html><body>${serverMarkup}</body>`).window.document;
const template = doc.querySelector('template');
const scope = template ? template.content : doc;

const server = {};
for (const p of scope.querySelectorAll('p')) server[p.getAttribute('data-k')] = { text: p.textContent, title: p.getAttribute('title') };

const { html, wire } = await load('core');
const { renderer, renderInto } = await load('renderer');
wire([renderer]);

test('the server rendered every case', () => {
  assert.equal(Object.keys(server).length, Object.keys(CASES).length, 'a case went missing on the server');
});

test('server and client agree on every representable string', () => {
  const mismatches = [];
  for (const [key, value] of Object.entries(CASES)) {
    if (UNREPRESENTABLE.has(key)) continue;
    const host = doc.createElement('div');
    renderInto(html`<p title=${value}>${value}</p>`, host);
    const client = host.querySelector('p');
    if (server[key].text !== client.textContent)
      mismatches.push(`${key} text: server ${JSON.stringify(server[key].text)} vs client ${JSON.stringify(client.textContent)}`);
    if (server[key].title !== client.getAttribute('title'))
      mismatches.push(`${key} attr: server ${JSON.stringify(server[key].title)} vs client ${JSON.stringify(client.getAttribute('title'))}`);
  }
  assert.deepEqual(mismatches, [], `hydration would mismatch on:\n  ${mismatches.join('\n  ')}`);
});

test('a carriage return survives the round trip as a character reference', () => {
  assert.match(serverMarkup, /&#13;/, 'the server must escape CR, or the parser eats it');
  const cr = String.fromCharCode(13);
  assert.ok(server.CRLF.text.includes(cr), 'and it must come back as a real CR');
  assert.ok(server.CRLF.title.includes(cr), 'in attribute values too');
});

test('the two exceptions are documented, and neither is an injection', () => {
  assert.notEqual(server.NUL.text, CASES.NUL, 'NUL genuinely cannot round-trip');
  assert.notEqual(server['lone surrogate'].text, CASES['lone surrogate'], 'nor can a lone surrogate');
  /**
   * **And the README actually says so.** A limitation that is only recorded in a test is a
   * limitation the person who hits it will never find; this is the line that keeps the two together.
   */
  const readme = readFileSync(new URL('../packages/ssr/README.md', import.meta.url), 'utf8');
  for (const phrase of ['NUL', 'lone surrogate', '&#13;'])
    assert.ok(readme.includes(phrase), `the SSR README must document ${phrase}`);
  assert.doesNotMatch(serverMarkup, /<script/i, 'and nothing in this set escapes the text boundary');
  assert.doesNotMatch(serverMarkup, /<\/style>/i);
});
