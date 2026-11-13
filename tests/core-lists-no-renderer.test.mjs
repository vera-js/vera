/**
 * **Automatic lists wired beside a bare render descriptor say so, once, in development** (D28, 2026-11-12). `lists`
 * commits its rows through the full renderer's 'value' insert; with only `{ on: 'render', fn: renderInto }` wired the
 * renderer never connects, every row's change re-renders the parent, and a 100-row update was held a frame per row — with
 * a correct DOM and no warning, so a benchmark measured that misconfiguration for weeks. The full renderer marks core's
 * registry when it connects (`$rn`); core's `mapped` reads it at an automatic list whose rows are templates.
 *
 * Exact counts, each case in a FRESH process (the warning is once per page, and wiring is process-wide): legacy 1; two
 * lists under legacy 1; `wire([renderer, lists])` 0; `wire([lists, renderer])` 0; a server render of shared setup that
 * wires `lists` ALONE 0, with the control that it built Lists inside a server turn; production 0 everywhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isProduction } from './dist.mjs';

const here = fileURLToPath(import.meta.url);
const condition = process.execArgv.join(' ').match(/--conditions[= ](\S+)/);
const child = (name) => {
  const r = spawnSync(process.execPath, [...(condition ? ['--conditions', condition[1]] : []), here], {
    env: { ...process.env, D28_CASE: name }, cwd: new URL('..', import.meta.url), timeout: 60000, killSignal: 'SIGKILL', encoding: 'utf8',
  });
  assert.equal(r.status, 0, `${name}: ${r.stderr.slice(-1500)}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
};

if (process.env.D28_CASE) {
  const name = process.env.D28_CASE;
  const said = [];
  console.warn = (...a) => said.push(a.map(String).join(' '));
  const count = () => said.filter((line) => line.includes('lists-no-renderer')).length;
  if (name === 'ssr') {
    const { renderToString } = await import('@verajs/ssr');
    const out = await renderToString(new URL('./fixtures/ssr/automatic-list-ssr-counted.js', import.meta.url), { tag: 'automatic-list-counted' });
    console.log(JSON.stringify({ warned: count(), rows: /<li>a<\/li><li>b<\/li>/.test(out.html), ...globalThis.__LISTS__ }));
  } else {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<body></body>', { pretendToBeVisual: true });
    for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Comment', 'Text', 'DocumentFragment', 'customElements', 'CSSStyleSheet', 'MutationObserver'])
      globalThis[k] = dom.window[k];
    const { load } = await import('./dist.mjs');
    const core = await load('core');
    const { renderer, renderInto } = await load('renderer');
    const { lists } = await load('renderer/keyed');
    const legacy = { on: 'render', fn: renderInto, priority: 50 };
    core.wire(name === 'app' ? [renderer, lists] : name === 'reversed' ? [lists, renderer] : [legacy, lists]);
    const state = core.createStore({ rows: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }] });
    customElements.define('x-d28', class extends HTMLElement {
      connectedCallback() {
        core.init(this, () => () => name === 'two'
          ? core.html`<ul>${state.rows.map((r) => core.html`<li>${r.label}</li>`)}</ul><ol>${state.rows.map((r) => core.html`<li>${r.id}</li>`)}</ol>`
          : core.html`<ul>${state.rows.map((r) => core.html`<li>${r.label}</li>`)}</ul>`);
      }
    });
    document.body.appendChild(document.createElement('x-d28'));
    await new Promise((r) => setTimeout(r, 0)); core.flush?.();
    state.rows[0].label = 'z';
    await new Promise((r) => setTimeout(r, 0)); core.flush?.();
    const host = document.querySelector('x-d28');
    const text = (host.shadowRoot ?? host).textContent;
    console.log(JSON.stringify({ warned: count(), rendered: text.startsWith('zb') }));
  }
  process.exit(0);
}

const expect = (n) => (isProduction ? 0 : n);

test(`a bare render descriptor beside lists: ${expect(1)} warning`, () => {
  const r = child('legacy');
  assert.ok(r.rendered, 'CONTROL: the list rendered and updated');
  assert.equal(r.warned, expect(1));
});

test(`two automatic lists under it: still ${expect(1)}`, () => {
  const r = child('two');
  assert.ok(r.rendered);
  assert.equal(r.warned, expect(1));
});

test('wire([renderer, lists]): 0', () => {
  const r = child('app');
  assert.ok(r.rendered);
  assert.equal(r.warned, 0);
});

test('wire([lists, renderer]), the other order: 0', () => {
  const r = child('reversed');
  assert.ok(r.rendered);
  assert.equal(r.warned, 0);
});

test('a server render of shared setup wiring lists ALONE: 0, and it DID build Lists inside the server turn', () => {
  const r = child('ssr');
  assert.ok(r.rows, 'the rows rendered');
  assert.ok(r.built >= 1 && r.inTurn === r.built, `CONTROL: ${r.built} Lists built, ${r.inTurn} of them in a server turn`);
  assert.equal(r.warned, 0);
});
