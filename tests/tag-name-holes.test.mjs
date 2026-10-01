/**
 * **An expression in TAG-name position is refused — by the server in every build, by the client in development.**
 * `<${x}>`, `</${x}>`, `<my-${x}>`: no element can be made from it, because the parser reads a tag name before any
 * value exists. The client rendered garbage (`&lt;&gt;t`) and the server other garbage (`<>t</b>`). A runtime tag name
 * is a tag VALUE from `@verajs/renderer/tag`. Only MARKUP state makes a tag position: a `<` in a comment, a raw-text
 * element, or a quoted attribute value never does — on either side (the server's scanner learned the client's raw-text
 * elements for this, so `<textarea>` content is text there too).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';
import { ROWS, T } from './fixtures/tag-name-holes.mjs';

const REFUSAL = /cannot be a tag name — a tag name must be a tag value/;
const serverScript = `
import { serializeTemplate } from '@verajs/ssr';
import { ROWS, T } from './tests/fixtures/tag-name-holes.mjs';
process.stdout.write(JSON.stringify(ROWS.map((row) => { try { serializeTemplate(T(row)); return 'served'; } catch (e) { return e.message; } })));
`;
const server = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', serverScript], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }));

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment']) globalThis[key] = dom.window[key];
const { renderInto } = await load('renderer');
const clientSays = (row) => {
  const { warn } = console;
  console.warn = () => {};
  try {
    renderInto(T(row), document.createElement('div'));
    return 'rendered';
  } catch (error) {
    return error.message;
  } finally {
    console.warn = warn;
  }
};

test('the server refuses exactly the tag-name rows, in every build', () => {
  const wrong = ROWS.filter((row, i) => REFUSAL.test(server[i]) !== row.refused).map((row, i) => `${row.label}: ${server[ROWS.indexOf(row)]}`);
  assert.deepEqual(wrong, []);
});

test('the client refuses exactly the same rows in development, with the same message', { skip: isProduction && 'a development check' }, () => {
  const wrong = ROWS.filter((row) => REFUSAL.test(clientSays(row)) !== row.refused).map((row) => `${row.label}: ${clientSays(row)}`);
  assert.deepEqual(wrong, []);
});

test('in production the client renders every row without throwing — the check is development-only', { skip: !isProduction && 'production only' }, () => {
  for (const row of ROWS) assert.equal(clientSays(row), 'rendered', row.label);
});
