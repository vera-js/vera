/**
 * **The server writes a value unescaped only where the browser will read it as raw text — in every context.**
 *
 * Inside `<style>` and `<script>` the server writes a value raw and neutralizes only that element's own end tag,
 * because a browser decodes nothing there. That is correct exactly when the BROWSER reads the element as raw text,
 * and the scanner deciding it used to be wrong in three ways, each an injection: inside `<svg>`/`<math>`, where
 * `<style>` is an SVG element whose content is markup (published in 0.2.1); in an `svg`/`mathml` template or any
 * template rendered into a foreign position, which the scanner read as though it began in HTML; and inside the
 * obsolete raw-text elements (`xmp`, `noembed`, `noframes`, `plaintext`), where `</xmp>` in the value closed the
 * run of text the server thought it was in.
 *
 * Every raw-text element × every context that changes how it parses × every hole shape, rendered by the server and
 * PARSED by jsdom — twice, because `<noscript>` is raw text only with scripting on, and markup with it off (only
 * `runScripts: 'dangerously'` sets jsdom's scripting flag; `'outside-only'` parses exactly as `{}` does). A row may be refused (thrown);
 * it may never put an injected element, an event-handler attribute or a `javascript:` URL into the parsed page.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { JSDOM, VirtualConsole } from 'jsdom';
import { ROWS, EXACT, TAGS, CONTEXTS, HOLES } from './fixtures/ssr-foreign-raw-text.mjs';

const serverScript = `
import { serializeTemplate } from '@verajs/ssr';
import { ROWS, EXACT } from './tests/fixtures/ssr-foreign-raw-text.mjs';
const run = (row) => { try { return { out: serializeTemplate(row.template()) }; } catch (error) { return { error: error.message }; } };
process.stdout.write(JSON.stringify({ rows: ROWS.map(run), exact: EXACT.map(run) }));
`;
const served = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', serverScript], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
);

const URL_ATTRIBUTES = ['href', 'src', 'xlink:href', 'action', 'formaction'];
/** What a parse of `markup` contains that it must not: the injected element, any handler attribute, a script URL. */
const injected = (markup, options) => {
  const { document } = new JSDOM(`<!doctype html><body>${markup}`, options).window;
  const found = [];
  if (document.getElementById('pwn')) found.push('#pwn');
  for (const element of document.querySelectorAll('*'))
    for (const { name, value } of element.attributes) {
      if (/^on/i.test(name)) found.push(`${element.localName}[${name}]`);
      if (URL_ATTRIBUTES.includes(name) && /^\s*javascript:/i.test(value)) found.push(`${element.localName}[${name}=${value}]`);
    }
  return found;
};

test('the two parses differ: scripting on makes <noscript> raw text', () => {
  const markup = '<noscript><b>x</b></noscript>';
  const parse = (options) => new JSDOM(`<!doctype html><body>${markup}`, options).window.document.querySelector('noscript').firstChild.nodeName;
  assert.equal(parse({}), 'B');
  assert.equal(parse({ runScripts: 'dangerously', virtualConsole: new VirtualConsole() }), '#text');
});

test('the table is exercised: every tag, context and hole, mostly served', () => {
  assert.equal(served.rows.length, TAGS.length * Object.keys(CONTEXTS).length * Object.keys(HOLES).length);
  const refused = served.rows.filter((row) => row.error);
  assert.ok(refused.length < served.rows.length / 4, `${refused.length} of ${served.rows.length} refused: ${refused.slice(0, 3).map((r) => r.error)}`);
});

test('the control: in plain HTML a <style> value really is written raw', () => {
  const row = served.rows[ROWS.findIndex((r) => r.label === 'html × <style> × text')];
  assert.match(row.out, /<style>[^]*<img id=pwn/, 'raw — so a misread context would inject, and the table can see it');
  assert.deepEqual(injected(row.out), [], 'and the raw path is safe where it applies');
});

/** The `<script>` rows hold deliberately broken source; their syntax errors are not the subject. */
for (const options of [{}, { runScripts: 'dangerously', virtualConsole: new VirtualConsole() }]) {
  test(`no row injects anything into the parsed page (scripting ${options.runScripts ? 'on' : 'off'})`, () => {
    const wrong = [];
    for (let i = 0; i < ROWS.length; i++) {
      const { out } = served.rows[i];
      if (out === undefined) continue;
      const [before, after] = ROWS[i].shell ?? ['', ''];
      const found = [...injected(out, options), ...(ROWS[i].shell ? injected(before + out + after, options) : [])];
      if (found.length) wrong.push(`${ROWS[i].label}: ${found.join(', ')}\n      ${out}`);
    }
    assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
  });
}

test('the published 0.2.1 hole: <svg><style>${text}</style>', () => {
  const row = served.rows[ROWS.findIndex((r) => r.label === 'svg × <style> × text')];
  assert.ok(!row.out.includes('<img'), row.out);
  assert.deepEqual(injected(row.out), []);
});

test('foreign depth comes back down: raw text after the foreign element is raw again', () => {
  const wrong = [];
  for (let i = 0; i < EXACT.length; i++) {
    const { out, error } = served.exact[i];
    if (!out?.includes(EXACT[i].expect)) wrong.push(`${EXACT[i].label}: ${out ?? error}`);
  }
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
});
