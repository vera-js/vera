/**
 * **A claim's `create`, `mount` and `unmount` follow the ref rule** (Brian, 2026-10-09): a throw is caught at its call
 * site, reported to the app's `'error'` chain with the component it belongs to (else as uncaught — `reportError`,
 * the console), and the render, the other claims and the teardown carry on. Before, `mount` propagated and every
 * later claim's mount in that template was skipped, and a throwing `create` ran mid-commit — the same shape that once
 * left a ref's component root empty for good.
 *
 * The policy, asserted below: a claim whose `create` threw is DROPPED for that instance (half made — it never mounts
 * or unmounts) and its element stays as the template built it, since a claim inserts nothing; every throw is
 * reported, as a ref's is (a callback runs once per instance, so "a claim that always throws" reports once per
 * instance); an `'error'` handler that writes a store QUEUES the update — it never re-enters the commit.
 *
 * The no-chain fallback runs in its own process: an `'error'` handler, once wired, cannot be unwired.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment',
  'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer, renderInto } = await load('renderer');
const { elements } = await load('renderer/elements');
const { html } = core;

const log = [];
/** `data-claim="create|mount|unmount|ok"` — which callback throws, or none. Every callback logs before it throws. */
const behavior = (mode) => ({
  create(element) { log.push(`create ${element.id}`); if (mode === 'create') throw new Error(`create ${element.id}`); },
  mount(element) { log.push(`mount ${element.id}`); if (mode === 'mount') throw new Error(`mount ${element.id}`); return `kept-${element.id}`; },
  unmount(kept, element) { log.push(`unmount ${element.id}`); if (mode === 'unmount') throw new Error(`unmount ${element.id}`); },
});
const claim = (el) => (el.hasAttribute('data-claim') ? behavior(el.getAttribute('data-claim')) : undefined);

if (process.env.VERA_THROWING_CLAIMS === 'no-chain') {
  core.wire([renderer, elements, { on: 'element', fn: claim, priority: 40 }]);
  const said = [];
  console.error = (...args) => said.push(String(args[0]));
  const reported = [];
  globalThis.reportError = (error) => reported.push(error.message);
  const h = document.createElement('div');
  document.body.append(h);
  renderInto(html`<p data-claim="mount" id="m"></p><p data-claim="ok" id="o"></p>`, h);
  process.stdout.write(JSON.stringify({ log, said, reported, ids: [...h.children].map((el) => el.id) }));
} else {
  const seen = [];
  let onError = null;
  core.wire([
    renderer,
    elements,
    { on: 'element', fn: claim, priority: 40 },
    { on: 'error', fn: (error, element) => { seen.push(`${error.message}@${element?.id}`); onError?.(); }, priority: 40 },
  ]);
  const host = (id) => {
    const element = document.createElement('div');
    element.id = id;
    document.body.append(element);
    return element;
  };
  const reset = () => { log.length = 0; seen.length = 0; };

  test('a throwing create is reported with its component, the claim is dropped, the element stays as built, the others run', () => {
    reset();
    const h = host('h1');
    const draw = (on) => html`${on ? html`<section><p data-claim="create" id="c"></p><p data-claim="ok" id="o"></p></section>` : 'off'}`;
    renderInto(draw(true), h);
    assert.deepEqual(seen, ['create c@h1'], 'reported once, to the chain, with the component');
    assert.equal(h.querySelector('section').outerHTML, '<section><p data-claim="create" id="c"></p><p data-claim="ok" id="o"></p></section>',
      'the render completed and the element is exactly what the template built');
    assert.deepEqual(log, ['create c', 'create o', 'mount o'], 'the dropped claim never mounts; the other created AND mounted');
    log.length = 0;
    renderInto(draw(false), h);
    assert.deepEqual(log, ['unmount o'], 'and only the claim that mounted is unmounted');
    h.remove();
  });

  test('a throwing mount is reported, and the claims after it still mount', () => {
    reset();
    const h = host('h2');
    renderInto(html`<p data-claim="mount" id="m"></p><p data-claim="ok" id="o"></p>`, h);
    assert.deepEqual(seen, ['mount m@h2']);
    assert.deepEqual(log, ['create m', 'create o', 'mount m', 'mount o'], 'the later claim mounted — it used to be skipped');
    assert.equal(h.querySelectorAll('p').length, 2, 'the render completed');
    h.remove();
  });

  test('a throwing unmount is reported, and the rest of the teardown runs — the other unmount, the nodes gone', () => {
    reset();
    const h = host('h3');
    const draw = (on) => html`${on ? html`<p data-claim="unmount" id="u"></p><p data-claim="ok" id="o"></p>` : 'off'}`;
    renderInto(draw(true), h);
    assert.deepEqual(log, ['create u', 'create o', 'mount u', 'mount o'], 'CONTROL: both mounted, both kept a value');
    log.length = 0;
    renderInto(draw(false), h);
    assert.deepEqual(seen, ['unmount u@h3']);
    assert.deepEqual(log, ['unmount u', 'unmount o'], 'the second unmount ran after the first threw');
    assert.equal(h.textContent, 'off', 'and the torn-down nodes are gone');
    h.remove();
  });

  test('every throw is reported, as a ref\'s is — one per instance for a claim that always throws', () => {
    reset();
    const a = host('h4a');
    const b = host('h4b');
    const draw = () => html`<p data-claim="mount" id="m"></p>`;
    renderInto(draw(), a);
    renderInto(draw(), b);
    assert.deepEqual(seen, ['mount m@h4a', 'mount m@h4b']);
    a.remove();
    b.remove();
  });

  test('an error handler that writes a store queues the update — it never re-enters the commit', async () => {
    reset();
    const state = core.createStore({ n: 0 });
    customElements.define('x-claims-count', class extends HTMLElement {
      connectedCallback() {
        core.init(this);
        core.render(() => html`<b>${state.n}</b>`);
      }
    });
    const counter = document.createElement('x-claims-count');
    document.body.append(counter);
    await Promise.resolve();
    assert.equal(counter.textContent, '0', 'CONTROL: the counter rendered');
    let during = null;
    onError = () => { state.n++; during = counter.textContent; };
    const h = host('h5');
    try {
      renderInto(html`<p data-claim="mount" id="m"></p><p data-claim="ok" id="o"></p>`, h);
    } finally {
      onError = null;
    }
    assert.equal(during, '0', 'inside the handler, mid-commit, nothing re-rendered');
    assert.deepEqual(log.slice(-1), ['mount o'], 'the commit finished its mounts');
    assert.equal(counter.textContent, '0', 'still queued when the render returns');
    await Promise.resolve();
    assert.equal(counter.textContent, '1', 'and flushed after');
    h.remove();
    counter.remove();
  });

  test('with no error chain, a throwing mount is uncaught — reportError, and development names it — and the render completes', () => {
    const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      encoding: 'utf8',
      env: { ...process.env, VERA_THROWING_CLAIMS: 'no-chain' },
    });
    assert.equal(result.status, 0, result.stderr);
    const { log: ran, said, reported, ids } = JSON.parse(result.stdout);
    assert.deepEqual(reported, ['mount m'], 'reported the way the platform reports an error');
    assert.deepEqual(ran, ['create m', 'create o', 'mount m', 'mount o']);
    assert.deepEqual(ids, ['m', 'o'], 'the render completed');
    if (isProduction) assert.deepEqual(said, [], 'production: reportError alone');
    else assert.deepEqual(said, ["[vera] elements: an element claim — threw in mount; its error is printed beside this line, and the others still mounted. Fix the claim's callback, or wire an 'error' insert to handle what claims throw. (claim-threw)"]);
  });
}
