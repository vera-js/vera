/**
 * **A server-rendered component written in R1's one form hydrates and ADOPTS** (vera-5a's pin 4): `init(host, setup)`
 * commits after the window closes, so hydration's queue-then-run must still adopt the server's markup in place — the
 * server's elements kept by identity, no fallback — with the setup called once and the render once.
 */
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const served = execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', `
  import { renderToString } from '@verajs/ssr';
  process.stdout.write((await renderToString(new URL('./tests/fixtures/ssr/setup-form-ssr.js', 'file://' + process.cwd() + '/'), { tag: 'setup-form-ssr' })).html);
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Comment', 'Text', 'DocumentFragment', 'MutationObserver', 'customElements', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
  globalThis[k] = dom.window[k];
const { wire, html, init, createStore } = await load('core');
const { renderer } = await load('renderer');
const { hydration } = await load('renderer/hydration');
wire([renderer, hydration]);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('an SSR\'d one-form component adopts the server markup: identity kept, no fallback, setup ×1 and render ×1', async () => {
  assert.match(served, /<setup-form-ssr[^>]*><p>count 1<\/p><button>go<\/button><\/setup-form-ssr>/, `CONTROL: the server rendered it: ${served}`);
  const root = dom.window.document.getElementById('root');
  root.innerHTML = served;
  const host = root.firstElementChild;
  const serverP = host.querySelector('p');
  const serverButton = host.querySelector('button');
  let setups = 0;
  let renders = 0;
  const warned = [];
  const warn = console.warn;
  console.warn = (...args) => warned.push(args.map(String).join(' '));
  try {
    customElements.define('setup-form-ssr', class extends HTMLElement {
      connectedCallback() {
        init(this, () => {
          setups++;
          const state = createStore({ n: 1 });
          return () => { renders++; return html`<p>count ${state.n}</p><button>go</button>`; };
        });
      }
    });
    await tick();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warned, [], 'no hydration fallback');
  assert.ok(host.querySelector('p') === serverP && host.querySelector('button') === serverButton, 'the server elements were adopted, not rebuilt');
  assert.deepEqual([setups, renders], [1, 1], 'one setup, one render');
});
