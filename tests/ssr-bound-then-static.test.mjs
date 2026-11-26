/**
 * **A static attribute after a binding of its own name is served exactly as the client renders it** (2026-11-26).
 *
 * The client parses a template once, and the HTML tokenizer keeps the FIRST attribute of a name (any case, foreign
 * content too): in `<p title=${v} title=x>` the bound `title` is kept and the static one is gone before any value
 * exists. So the client has `title` from `v`, or no `title` at all when `v` is nullish. The server wrote both, and
 * when the binding wrote nothing the browser's parse of the served tag kept the static: `title="x"` served where the
 * client has none. Each row renders one template both ways and compares the element's attribute SET (order is not a
 * difference here) and its text; the reverse order and a tag with no binding are the controls that already agreed.
 *
 * The server runs in its own process (its DOM shim and jsdom cannot share one), as in ssr-attribute-parity.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

/** Each row: a label, the template's strings, and the values its holes take, one render per value. */
const ROWS = [
  ['case: TITLE=${v} title=x', ['<p TITLE=', ' title=x>t</p>'], ['y', null]],
  ['svg: viewBox=${v} viewbox=…', ['<svg viewBox=', ' viewbox="0 0 1 1"></svg>'], ['0 0 2 2', null]],
  ['two holes: title=${v} class=${v} title=x', ['<p title=', ' class=', ' title=x>t</p>'], ['y', null]],
  ['a static between: title=${v} id=y title=x', ['<p title=', ' id=y title=x>t</p>'], ['y', null]],
  ['a quoted static holding the name and a >', ['<p title=', ' data-x="title=y>" title=x>t</p>'], ['y', null]],
  ['two holes in one value: title="${v}-${v}" title=x', ['<p title="', '-', '" title=x>t</p>'], ['y', null]],
  ['boolean: ?hidden=${v} hidden', ['<p ?hidden=', ' hidden>t</p>'], [true, false]],
  ['class: class=${v} class=x', ['<p class=', ' class=x>t</p>'], ['y', null]],
  ['a different element keeps its own: <p title=${v}><i title=x>', ['<p title=', '><i title=x>t</i></p>'], ['y', null]],
  ['CONTROL reverse order: title=x title=${v}', ['<p title=x title=', '>t</p>'], ['y', null]],
  ['CONTROL no binding: title=x title=z', ['<p title=x title=z>', '</p>'], ['y']],
];
const CASES = ROWS.flatMap(([label, strings, values]) =>
  values.map((value) => ({ label: `${label} · ${JSON.stringify(value)}`, strings, values: Array(strings.length - 1).fill(value) }))
);

/* ── server, in its own process ─────────────────────────────────────────────────────────────── */
const serverScript = `
import { serializeTemplate } from '@verajs/ssr';
const cases = JSON.parse(process.argv[1]);
const template = ({ strings, values }) => ({ _$litType$: 1, strings: Object.freeze(Object.assign([...strings], { raw: [...strings] })), values });
process.stdout.write(JSON.stringify(cases.map((c) => serializeTemplate(template(c)))));
`;
const served = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', serverScript, JSON.stringify(CASES)], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })
);

/* ── client ─────────────────────────────────────────────────────────────────────────────────── */
const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
const { renderInto } = await load('renderer');
const template = ({ strings, values }) => ({
  _$litType$: 1,
  strings: Object.freeze(Object.assign([...strings], { raw: [...strings] })),
  values,
});

/** Every element as `name{sorted attributes}`, then the text. */
const shapeOf = (root) =>
  [...root.querySelectorAll('*')]
    .map((el) => `${el.localName}${JSON.stringify([...el.attributes].map((a) => [a.name, a.value]).sort(([a], [b]) => (a < b ? -1 : 1)))}`)
    .join(' ') + ` | ${JSON.stringify(root.textContent)}`;

test('the table is exercised: every row, every value, both sides', () => {
  assert.equal(CASES.length, 21);
  assert.equal(served.length, CASES.length, 'the server rendered every case');
});

test('a static after a binding of its own name: the served markup parses to the client DOM', () => {
  const wrong = [];
  CASES.forEach((c, i) => {
    const host = document.createElement('div');
    renderInto(template(c), host);
    const parsed = document.createElement('div');
    parsed.innerHTML = served[i];
    /** The comparison must see an element on both sides, or it compares two empty lists. */
    assert.ok(host.firstElementChild && parsed.firstElementChild, `no element for ${c.label}`);
    const client = shapeOf(host);
    const server = shapeOf(parsed);
    if (client !== server) wrong.push(`${c.label}\n      client ${client}\n      server ${server}\n      served ${served[i]}`);
  });
  assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
});

test('the bytes the parser keeps are unchanged: a static of another name, and the binding when it writes', () => {
  const at = (label) => served[CASES.findIndex((c) => c.label === label)];
  assert.match(at('a quoted static holding the name and a > · "y"'), /data-x="title=y&gt;"|data-x="title=y>"/);
  assert.match(at('a static between: title=${v} id=y title=x · null'), /id=("?)y\1/);
  assert.match(at('a different element keeps its own: <p title=${v}><i title=x> · null'), /<i title=("?)x\1>/);
});
