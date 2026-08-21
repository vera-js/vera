/**
 * Server -> client round trip: REAL @verajs/ssr/vera markup (produced in a subprocess, since its
 * shims own globals) adopted by the REAL renderer build in jsdom. Assertions center on IDENTITY —
 * hydration means the server DOM survives, listeners attach, and updates mutate adopted nodes.
 */
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const serverScript = `
import { serializeTemplate } from '@verajs/ssr/vera';
const { html } = await import('@verajs/core');
const rows = [
  { id: 1, label: 'alpha' },
  { id: 2, label: 'beta <x>' },
];
const template = (state) => html\`
  <section class="wrap">
    <h1>\${state.title}</h1>
    <output \?hidden=\${state.count === 0}>count: \${state.count}</output>
    <input .value=\${state.title} @input=\${() => {}} />
    <ul>\${state.rows.map((row) => html\`<li data-id=\${row.id}>\${row.label}</li>\`)}</ul>
  </section>\`;
process.stdout.write(serializeTemplate(template({ title: 'hello ssr', count: 3, rows })));
`;
const serverHtml = execFileSync(process.execPath, ['--input-type=module', '-e', serverScript], {
  cwd: new URL('..', import.meta.url), encoding: 'utf8',
});
assert.ok(serverHtml.includes('hello ssr') && !serverHtml.includes('<!--'), 'server markup is comment-free');

// ---- client: same template call sites, adopted over the server DOM ----
const dom = new JSDOM('<div id="root"></div>');
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
const { render, keyed } = await import('../packages/renderer/dist/development/vera-renderer-hydrate.js');
const html = (strings, ...values) => ({ strings, values });

const container = dom.window.document.getElementById('root');
container.innerHTML = serverHtml;

const template = (state) => html`
  <section class="wrap">
    <h1>${state.title}</h1>
    <output ?hidden=${state.count === 0}>count: ${state.count}</output>
    <input .value=${state.title} @input=${state.onInput} />
    <ul>${state.rows.map((row) => keyed(row.id, html`<li data-id=${row.id}>${row.label}</li>`))}</ul>
  </section>`;

let inputs = 0;
const state = {
  title: 'hello ssr', count: 3, onInput: () => inputs++,
  rows: [ { id: 1, label: 'alpha' }, { id: 2, label: 'beta <x>' } ],
};

// identity probes BEFORE hydration
const serverH1 = container.querySelector('h1');
const serverInput = container.querySelector('input');
const serverLi2 = container.querySelectorAll('li')[1];
serverInput.dataset.probe = 'survived';

render(template(state), container);

// 1. adoption preserved the server DOM
assert.equal(container.querySelector('h1'), serverH1, 'h1 identity preserved');
assert.equal(container.querySelector('input'), serverInput, 'input identity preserved');
assert.equal(serverInput.dataset.probe, 'survived', 'out-of-band state on adopted nodes survives');
assert.equal(container.querySelectorAll('li')[1], serverLi2, 'list item identity preserved');
assert.equal(serverLi2.textContent, 'beta <x>', 'escaped server text decoded to the real value');

// 2. behavior attached to adopted nodes
serverInput.dispatchEvent(new dom.window.Event('input'));
assert.equal(inputs, 1, 'listener attached to the adopted input');

// 3. updates mutate adopted nodes in place
state.title = 'updated';
state.count = 0;
state.rows = [ { id: 2, label: 'beta <x>' }, { id: 1, label: 'ALPHA' } ];
render(template(state), container);
assert.equal(container.querySelector('h1'), serverH1, 'h1 still the same node after update');
assert.equal(serverH1.textContent, 'updated', 'adopted text updated in place');
assert.ok(container.querySelector('output').hasAttribute('hidden'), '?bool toggles on adopted element');
assert.equal(container.querySelectorAll('li')[0], serverLi2, 'keyed reorder MOVED the adopted node');

// 4. mismatched server markup falls back to a clean render
const bad = dom.window.document.createElement('div');
bad.innerHTML = '<p>stale unrelated markup</p>';
render(html`<span>${'fresh'}</span>`, bad);
assert.equal(bad.textContent, 'fresh', 'mismatch fell back to clean render');
assert.equal(bad.querySelectorAll('p').length, 0, 'stale markup cleared');

console.log('hydrate ok — markerless adoption, identity preserved, fallback safe');
