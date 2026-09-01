/**
 * Server -> client round trip: REAL @verajs/ssr/vera markup (produced in a subprocess, since its
 * shims own globals) adopted by the REAL renderer build in jsdom. Assertions center on IDENTITY —
 * hydration means the server DOM survives, listeners attach, and updates mutate adopted nodes.
 */
import { load } from './dist.mjs';
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
    <output ?hidden=\${state.count === 0}>count: \${state.count}</output>
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
const { renderInto } = await load('renderer/hydrate');
const { keyed } = await load('renderer/keyed');
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

renderInto(template(state), container);

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
renderInto(template(state), container);
assert.equal(container.querySelector('h1'), serverH1, 'h1 still the same node after update');
assert.equal(serverH1.textContent, 'updated', 'adopted text updated in place');
assert.ok(container.querySelector('output').hasAttribute('hidden'), '?bool toggles on adopted element');
assert.equal(container.querySelectorAll('li')[0], serverLi2, 'keyed reorder MOVED the adopted node');

// 4. mismatched server markup falls back to a clean render
const bad = dom.window.document.createElement('div');
bad.innerHTML = '<p>stale unrelated markup</p>';
renderInto(html`<span>${'fresh'}</span>`, bad);
assert.equal(bad.textContent, 'fresh', 'mismatch fell back to clean render');
assert.equal(bad.querySelectorAll('p').length, 0, 'stale markup cleared');

// 5. a value the server cannot have rendered mismatches — it never throws out of renderInto()
//    Adoption used to spread whatever reached this branch, so a plain object raised
//    `TypeError: value is not iterable` and escaped the MISMATCH guard, taking the page down where
//    every other disagreement with the server degrades quietly.
const opaque = dom.window.document.createElement('div');
opaque.innerHTML = '<p>server</p>';
renderInto(html`<p>${{ a: 1 }}</p>`, opaque);
assert.equal(opaque.textContent, '[object Object]', 'an opaque object fell back instead of throwing');

// 6. a client-only DOM node adopts WITHOUT giving up hydration
//    The server rendered nothing for it (it has no document to build one), so there is nothing to
//    claim — the node is inserted and the surrounding server DOM is still adopted in place.
const withNode = dom.window.document.createElement('div');
withNode.innerHTML = '<p>server</p>';
const serverP = withNode.querySelector('p');
const clientOnly = dom.window.document.createElement('span');
clientOnly.textContent = 'client';
renderInto(html`<p>server${clientOnly}</p>`, withNode);
assert.equal(withNode.querySelector('p'), serverP, 'server <p> still adopted alongside a client node');
assert.equal(withNode.querySelector('span'), clientOnly, 'the client node was inserted');
assert.equal(withNode.textContent, 'serverclient');

console.log('hydrate ok — markerless adoption, identity preserved, fallback safe');

/* ── a comment in the template must not cost hydration ─────────────────────────────────────────
 * `html`<p>a<!-- note -->b</p>`` compiles with the comment in its statics and the server emits it,
 * so the adopted DOM is text / comment / text where the walk wanted one run of text. Bailing on that
 * meant **every template containing an HTML comment lost hydration**: the server's markup thrown
 * away and re-rendered, for markup the client had itself produced.
 *
 * Nothing failed, because the page stays correct either way — that is the point of the fallback and
 * also why this went unnoticed. The cost was the first paint the server render was paid for.
 *
 * Found by hydrating the markup shapes this package emits, rather than the shapes the suite already
 * had fixtures for.
 */
{
  const complaints = [];
  const originalWarn = console.warn;
  console.warn = (...args) => complaints.push(args.join(' '));
  try {
    const shapes = [
      ['a comment between text', '<p>a<!-- note -->b</p>', html`<p>a<!-- note -->b</p>`],
      ['a comment before text', '<p><!-- lead -->tail</p>', html`<p><!-- lead -->tail</p>`],
      ['a comment after text', '<p>lead<!-- tail --></p>', html`<p>lead<!-- tail --></p>`],
      ['two comments', '<p>a<!--x-->b<!--y-->c</p>', html`<p>a<!--x-->b<!--y-->c</p>`],
      ['a comment before an element', '<p><!--x--><b>y</b></p>', html`<p><!--x--><b>y</b></p>`],
      ['a comment between elements', '<p><b>y</b><!--x--><i>z</i></p>', html`<p><b>y</b><!--x--><i>z</i></p>`],
    ];
    for (const [label, markup, result] of shapes) {
      complaints.length = 0;
      const host = dom.window.document.createElement('div');
      host.innerHTML = markup;
      const adopted = host.querySelector('p');
      renderInto(result, host);
      assert.deepEqual(
        complaints.filter((line) => /fell back/.test(line)),
        [],
        `${label}: hydration fell back for markup the client itself produces`
      );
      assert.equal(host.querySelector('p'), adopted, `${label}: the server's element was not adopted`);
      assert.equal(host.textContent, adopted.textContent, `${label}: the text changed`);
    }
  } finally {
    console.warn = originalWarn;
  }
}
