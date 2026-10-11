/**
 * **Hydrating light slots without `hydrateSlots` wired** — the guard. A served light host (`data-vm-light`) is the
 * server's output of a light-DOM slots component, and only `@verajs/renderer/hydrate-slots` reads it. Without that piece
 * hydration throws a coded `hydration-slots` error BEFORE touching anything, so the server's markup stands exactly as
 * served — never cleared, never half-adopted. These rows pin that, and how far the throw reaches (vera-5a's condition):
 * a page's OTHER components must still hydrate and work.
 */
import { load } from './dist.mjs';
import { execFileSync } from 'node:child_process';
import { JSDOM, VirtualConsole } from 'jsdom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { serve } from './served.mjs';

/** Server output of the slots card fixture, its light children supplied. */
const served = execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', `
  import { renderToString } from '@verajs/ssr'; import { wire } from '@verajs/core';
  const { slots } = await import('@verajs/renderer/slots'); wire([slots]);
  process.stdout.write((await renderToString(new URL('./tests/fixtures/ssr/slot-card-ssr.js', 'file://' + process.cwd() + '/'), { children: '<h2 slot="header">H</h2>body<b>B</b><i slot="nope">N</i>' })).html);
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });

/** Errors the page reports (an exception in a custom element reaction is reported, as a browser reports it). */
const reported = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (error) => reported.push(error));
const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true, virtualConsole });
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Comment', 'Text', 'DocumentFragment', 'MutationObserver', 'customElements', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MouseEvent'])
  globalThis[k] = dom.window[k];
const settle = () => new Promise((r) => dom.window.setTimeout(r, 0));
const { wire, init, html } = await load('core');
const { renderInto, renderer } = await load('renderer');
const { hydration } = await load('renderer/hydration');
const { slots } = await load('renderer/slots');
/** `hydrateSlots` deliberately NOT wired until the control at the end. */
wire([renderer, hydration, slots]);
const root = dom.window.document.getElementById('root');
const card = () => html`<article><header><slot name="header"><em>fallback header</em></slot></header><main><slot>default fallback</slot></main></article>`;
const host = (markup) => {
  const wrap = dom.window.document.createElement('div');
  wrap.innerHTML = markup;
  return root.appendChild(wrap.firstElementChild);
};
const watch = (node) => {
  const records = [];
  const observer = new dom.window.MutationObserver((r) => records.push(...r));
  observer.observe(node, { childList: true, subtree: true, attributes: true, characterData: true });
  return () => (records.push(...observer.takeRecords()), observer.disconnect(), records);
};
const thrown = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
};

test('without slots or hydrateSlots: refused before anything is touched — the markup stands, byte for byte', async () => {
  assert.match(served, /data-vm-light="1:/, 'CONTROL: a served light host');
  const h = host(served);
  const done = watch(h);
  const error = thrown(() => renderInto(card(), h));
  await settle();
  assert.match(String(error?.message), /hydration-slots/, `coded: ${error?.message}`);
  assert.equal(done().length, 0, 'no DOM mutation');
  assert.equal(h.outerHTML, served, 'the markup exactly as served');
  h.remove();
});

/**
 * **The realistic page: three server-rendered components, the middle one a light-slots host, defined after the markup
 * parsed** (each upgrades and hydrates in its own `connectedCallback`). An exception in a custom element reaction is
 * REPORTED by the platform, never thrown to the code that caused it — so the guard's throw stays with its host.
 */
test('a page of three components, the middle one served with slots: the others hydrate and work, it stands, one report', async () => {
  const clicked = [];
  /** As a server with slots wired writes EVERY component host: a statement, here of no light content (`1:`). */
  const plain = (tag) => `<${tag} data-vm-light="1:"><button>${tag}</button></${tag}>`;
  root.innerHTML = plain('blast-a') + served.replace(/slot-card-ssr/g, 'blast-b') + plain('blast-c');
  const [a, b, c] = [...root.children];
  const buttons = [a.querySelector('button'), c.querySelector('button')];
  const bMarkup = b.outerHTML;
  /** Core contains a component's throw and reports it (`reportUncaught`): `reportError` in a browser, the console here. */
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  const before = reported.length;
  for (const tag of ['blast-a', 'blast-c'])
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() {
        init(this, () => {
          return () => html`<button @click=${() => clicked.push(tag)}>${tag}</button>`;
        });
      }
    });
  customElements.define('blast-b', class extends HTMLElement {
    connectedCallback() {
      init(this, () => {
        const view = card;
        return typeof view === 'function' ? view : () => view;
      });
    }
  });
  await settle();
  await new Promise((r) => dom.window.requestAnimationFrame(r));
  console.error = original;
  assert.equal(a.querySelector('button'), buttons[0], 'the first component adopted its server button — a statement of no light content needs no hydrateSlots');
  assert.equal(a.hasAttribute('data-vm-light'), false, 'and its statement is consumed, as the piece consumes one');
  assert.equal(c.querySelector('button'), buttons[1], 'and the third');
  buttons[0].click();
  buttons[1].click();
  assert.deepEqual(clicked, ['blast-a', 'blast-c'], 'both are interactive');
  assert.equal(b.outerHTML, bMarkup, 'the light-slots host stands exactly as served');
  const reports = [...errors, ...reported.slice(before).map((e) => String(e.message ?? e))].filter((m) => /hydration-slots/.test(m));
  assert.equal(reports.length, 1, `reported once: ${reports.join(' | ')}`);
  root.replaceChildren();
});

/**
 * **Re-entrant: the served host is hydrated from inside ANOTHER container's commit** — a setter on that container's
 * element calls `renderInto` itself, with no component boundary between. The guard's throw then travels as any exception
 * user code throws during a render does (`hydration.ts`: "User code that THROWS while the queue runs leaves the container
 * partly committed"): the outer container stops where the setter threw. The served host still stands as served. Pinned so
 * a change to how far it reaches is a decision: inside a core component (the row above) the boundary contains it.
 */
test('re-entrant from a setter in another container\'s commit: thrown to that render, the served host untouched', async () => {
  const outer = dom.window.document.createElement('section');
  outer.innerHTML = serve({ outer: "html`<p .hook=${1}></p><button @click=${() => {}}>go</button>`" }).outer;
  root.appendChild(outer);
  const b = host(served.replace(/slot-card-ssr/g, 'blast-r'));
  const bMarkup = b.outerHTML;
  const p = outer.querySelector('p');
  Object.defineProperty(p, 'hook', {
    set() {
      renderInto(card(), b);
    },
    configurable: true,
  });
  const clicked = [];
  const error = thrown(() => renderInto(html`<p .hook=${1}></p><button @click=${() => clicked.push('go')}>go</button>`, outer));
  await settle();
  outer.querySelector('button').click();
  assert.match(String(error?.message), /hydration-slots/, 'the outer render receives the coded error');
  assert.deepEqual(clicked, [], 'and is left where it threw: its later listener is not attached');
  assert.equal(b.outerHTML, bMarkup, 'the light-slots host stands exactly as served');
  root.replaceChildren();
});

test('CONTROL: with hydrateSlots wired the same host adopts', async () => {
  const { hydrateSlots } = await load('renderer/hydrate-slots');
  wire([hydrateSlots]);
  const h = host(served);
  const kept = h.querySelector('h2');
  assert.equal(thrown(() => renderInto(card(), h)), null);
  await settle();
  assert.equal(h.querySelector('h2'), kept, 'adopted in place');
  assert.equal(h.hasAttribute('data-vm-light'), false, 'and read');
  h.remove();
});

/**
 * **A served host that is a CORE component: slots' `init` capture waits for the adoption.** `init` runs before the
 * component's first render; capturing there would take the server's whole render for light content. With hydration
 * wired, slots leaves a served host (`data-vm-light`) to the adoption, which captures exactly the light children.
 */
test('a served CORE component: slots defers its init capture to the adoption — in place, no warning', async () => {
  const { slotted } = await load('renderer/slots');
  const markup = served.replace(/slot-card-ssr/g, 'served-core');
  root.innerHTML = markup;
  const h = root.firstElementChild;
  const h2 = h.querySelector('h2');
  const said = [];
  const [warn, error] = [console.warn, console.error];
  console.warn = console.error = (...args) => said.push(args.map(String).join(' '));
  try {
    customElements.define('served-core', class extends HTMLElement {
      connectedCallback() {
        init(this, () => {
          const view = card;
          return typeof view === 'function' ? view : () => view;
        });
      }
    });
    await settle();
    await new Promise((r) => dom.window.requestAnimationFrame(r));
  } finally {
    [console.warn, console.error] = [warn, error];
  }
  assert.deepEqual(said, [], 'adopted, nothing said');
  assert.equal(h.querySelector('h2'), h2, 'the light node in place, by identity');
  assert.deepEqual(slotted(h, 'header'), [h2], 'and it is the header slot\'s, alone');
  assert.equal(h.querySelectorAll('article').length, 1, 'the server render was not taken for light content');
  root.replaceChildren();
});
