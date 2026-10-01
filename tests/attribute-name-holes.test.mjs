/**
 * **An expression inside an attribute NAME is refused — by the server in every build, by the client in development.**
 *
 * `<p data-${k}="1">` cannot be rendered: the parser sees the marker before any value exists. The client used to
 * write a broken `data-="1"` and the server threw; the server also served `<p data-${k}>` as `<p data->` and fused
 * `<p ${k}-x="1">` into the TAG name (`<p-x>`). One rule now refuses the same templates on both sides, and its
 * controls — every legitimate hole in a tag (refs, values, continuations, comments, raw text) — are refused by
 * neither. A runtime name is a spread, which the error shows.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';
import { ROWS, T } from './fixtures/attribute-name-holes.mjs';

const REFUSAL = /an attribute name cannot be an expression/;

/* ── server, in its own process ─────────────────────────────────────────────────────────────── */
const serverScript = `
import { serializeTemplate } from '@verajs/ssr';
import { ROWS, T } from './tests/fixtures/attribute-name-holes.mjs';
process.stdout.write(JSON.stringify(ROWS.map((row) => {
  try { serializeTemplate(T(row)); return 'served'; } catch (error) { return error.message; }
})));
`;
const server = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', serverScript], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
);

/* ── client ─────────────────────────────────────────────────────────────────────────────────── */
const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[key] = dom.window[key];
const { renderInto } = await load('renderer');
const { renderInto: hydrateInto } = await load('renderer/hydrate');
const clientSays = (row) => {
  try {
    renderInto(T(row), document.createElement('div'));
    return 'rendered';
  } catch (error) {
    return error.message;
  }
};

test('the table is exercised on both sides', () => {
  assert.equal(server.length, ROWS.length);
  assert.ok(ROWS.some((r) => r.refused) && ROWS.some((r) => !r.refused), 'shapes AND controls');
});

test('the client and the server refuse exactly the same templates', () => {
  const wrong = [];
  for (let i = 0; i < ROWS.length; i++) {
    const row = ROWS[i];
    /** Production pays nothing for the client's check (a template's first development render finds it): it renders. */
    const client = isProduction ? row.refused : REFUSAL.test(clientSays(row));
    const served = REFUSAL.test(server[i]);
    if (client !== row.refused || served !== row.refused) wrong.push(`${row.label}: client ${client ? 'refused' : 'allowed'}, server ${served ? 'refused' : 'allowed'}`);
  }
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
});

test('production renders every row without throwing — the check is development-only', { skip: !isProduction && 'production only' }, () => {
  for (const row of ROWS) assert.doesNotThrow(() => renderInto(T(row), document.createElement('div')), row.label);
});

test('the message carries no value — it is rebuilt from the statics', { skip: isProduction && 'a development check' }, () => {
  const secret = { label: 'secret', strings: ['<p data-', '="1">t</p>'], values: () => ['s3cr3t-value'], refused: true };
  assert.doesNotMatch(clientSays(secret), /s3cr3t/);
});

test('a refused template is refused on its second render too — nothing half-built is cached', { skip: isProduction && 'a development check' }, () => {
  const row = ROWS[1];
  assert.match(clientSays(row), REFUSAL);
  assert.match(clientSays(row), REFUSAL);
});

test('hydration refuses it cleanly: the error escapes, and no bounds are left in the container', { skip: isProduction && 'a development check' }, () => {
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = '<p>t</p>';
  assert.throws(() => hydrateInto(T(ROWS[1]), host), REFUSAL);
  assert.equal(host.innerHTML, '<p>t</p>', 'the server markup is untouched — no markers added');
  assert.throws(() => hydrateInto(T(ROWS[1]), host), REFUSAL, 'and again');
  assert.equal(host.innerHTML, '<p>t</p>');
});
