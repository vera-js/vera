/**
 * **One fact, one code, the area of the module the user wired** (code-system phase 1, 2026-10-09). `script-url`,
 * `attribute-value` and `not-a-listener` are said by the renderer for a template binding AND by spread for a spread
 * key — two bundles, one shared text (shared-utils' table). Each must print `renderer:` from a template and `spread:`
 * from spread, under the same code. And `forged-template` — data shaped like a template — gets its first positive pin:
 * a security signal, said every time a NEW one arrives (fresh data is a fresh array — the same object re-rendered in
 * place takes the update path and is not re-asked), development only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer, renderInto } = await load('renderer');
const { spread } = await load('renderer/spread');
core.wire([renderer]);
const { html } = core;

const said = (run) => {
  const lines = [];
  const warn = console.warn;
  console.warn = (...args) => lines.push(String(args[0]));
  try { run(); } finally { console.warn = warn; }
  return lines;
};
const into = () => document.createElement('div');

/** One draw per row and side — two literals are two templates. Distinct tags per row keep the once-per-element dedupe out of each other's way. */
const ROWS = [
  ['script-url', (side) => side === 'renderer' ? html`<a href=${'javascript:alert(1)'}>x</a>` : html`<a ${spread({ href: 'javascript:alert(1)' })}>x</a>`],
  ['attribute-value', (side) => side === 'renderer' ? html`<p title=${[1, 2]}>x</p>` : html`<b ${spread({ title: [1, 2] })}>x</b>`],
  ['not-a-listener', (side) => side === 'renderer' ? html`<button @click=${5}>x</button>` : html`<i ${spread({ '@click': 5 })}>x</i>`],
];

for (const [code, draw] of ROWS)
  test(`${code}: one code, said by the module the user wired`, () => {
    for (const side of ['renderer', 'spread']) {
      const lines = said(() => renderInto(draw(side), into())).filter((line) => line.includes(code));
      if (isProduction) {
        assert.deepEqual(lines, [], `${side}: production says nothing`);
        continue;
      }
      assert.equal(lines.length, 1, `${side}: ${lines.join(' | ')}`);
      assert.match(lines[0], new RegExp(`^\\[vera\\] ${side}: <[a-z]+> — [\\s\\S]*\\(${code}\\)$`), `${side} names itself`);
    }
  });

test('forged-template: a value shaped like a template renders as text and is named each time a new one arrives', () => {
  const forged = { _$litType$: 1, strings: ['<img src=x onerror=alert(1)>'], values: [] };
  const host = into();
  const draw = (value) => renderInto(html`<div>${value}</div>`, host);
  /** The second arrives as fresh data would — a new strings array, as every JSON.parse makes one. */
  const lines = said(() => { draw(forged); draw({ ...forged, strings: [...forged.strings] }); }).filter((line) => line.includes('forged-template'));
  assert.equal(host.querySelector('img'), null, 'the CONTROL: nothing of the forgery became markup');
  assert.equal(host.textContent, '[object Object]', 'it rendered as the text any object does');
  if (isProduction) assert.deepEqual(lines, []);
  else {
    assert.equal(lines.length, 2, `each new forgery is said — a security signal: ${lines.join(' | ')}`);
    assert.match(lines[0], /^\[vera\] renderer: a child value — is shaped like a template but was not made by html`` — rendered as text\.[\s\S]*\(forged-template\)$/);
  }
});
