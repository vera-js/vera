/**
 * A Map-driven component through the whole pipeline: server-rendered (the 'collection' insert
 * wired in the SERVER process — reading a Map's methods inside a store is exactly what it gates),
 * hydrated by adoption, and LIVE afterwards — a `set` and a `delete` must render, on the adopted
 * nodes, because a component that hydrates and then ignores its Map passes every static read.
 * The lifecycle-parity harness wires collections on neither side, which is why this is a file
 * rather than a one-line case there (run-11 matrix cell).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const serverHtml = execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', `
  import { renderToString } from '@verajs/ssr';
  import { wire } from '@verajs/core';
  const { collections } = await import('@verajs/reactivity/collections');
  wire([collections]);
  process.stdout.write((await renderToString(new URL('./tests/fixtures/ssr/map-driven-ssr.js', 'file://' + process.cwd() + '/'))).html);
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Comment', 'Text',
  'DocumentFragment', 'MutationObserver', 'customElements', 'CSSStyleSheet', 'Event', 'CustomEvent',
  'requestAnimationFrame', 'cancelAnimationFrame']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = (fn) => dom.window.setTimeout(() => fn(0), 0);
const frame = () => new Promise((resolve) => dom.window.setTimeout(resolve, 10));

const core = await load('core');
const { renderer } = await load('renderer/hydrate');
const { collections } = await load('reactivity/collections');
core.wire([renderer, collections]);

test('a Map-driven component serializes, hydrates by adoption, and stays live', async () => {
  assert.ok(serverHtml.includes('a=1') && serverHtml.includes('b=2'), 'CONTROL: the server rendered the rows at all');
  const doc = dom.window.document;
  doc.getElementById('root').innerHTML = serverHtml;
  await import(new URL('./fixtures/ssr/map-driven-ssr.js', import.meta.url));
  const el = doc.querySelector('map-driven-ssr');
  const serverLi = el.querySelector('li');
  await frame();
  assert.equal(el.querySelector('li'), serverLi, 'hydration adopted the server node');
  assert.equal(el.textContent.replace(/\s+/g, ''), 'a=1b=2');

  el.store.rows.set('c', 3);
  await frame();
  assert.ok(el.textContent.includes('c=3'), 'a Map set renders after hydration');
  assert.equal(el.querySelector('li'), serverLi, 'without disturbing the adopted rows');

  el.store.rows.delete('a');
  await frame();
  assert.ok(!el.textContent.includes('a=1') && el.textContent.includes('b=2'), 'a delete renders too');
});
