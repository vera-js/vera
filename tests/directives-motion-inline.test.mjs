/**
 * INLINE delivery — `hoist: false` / `renderMotion({ inline: true })`, the cache-escape hatch.
 *
 * The contract, all four corners: (1) SSR inline emits each element's rules as its OWN style
 * child and writes NO document sheet (a cached fragment is complete); (2) re-rendering rendered
 * markup is idempotent (the fragment-cache flow itself); (3) a client wired `hoist: false`
 * delivers the same shape and REWRITES the child on attribute edit; (4) client-over-SSR takes
 * the existing child over in place — same hash, zero rewrites, no duplicates.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<body></body>', { pretendToBeVisual: true, url: 'https://x.test/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet',
  'location', 'history', 'getComputedStyle']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { renderMotion } = await load('directives/motion');

const VALUE = "{ keyframes: { opacity: '0% 0, 100% 1' }, scroll: '100%, 0%' }";
const child = (el) => [...el.children].find((c) =>
  c.localName === 'style' && c.getAttribute('data-vm-sheet') === 'inline');

test('SSR inline: rules travel with the element, the head stays empty, re-render is idempotent', () => {
  const page = new JSDOM(`<body><div id="a" data-vd-motion="${VALUE}">x</div></body>`,
    { url: 'https://x.test/' });
  const doc = page.window.document;
  const report = renderMotion(doc, { inline: true });
  assert.equal(report.rendered, 1, 'the CONTROL: something rendered');
  const el = doc.getElementById('a');
  const style = child(el);
  assert.ok(style, 'the element carries its own style child');
  assert.match(style.textContent, /@keyframes vm-/, 'keyframes ride inside');
  assert.match(style.textContent, /prefers-reduced-motion/, 'the neutraliser tail rides too');
  assert.equal(style.getAttribute('data-vm-for'), el.getAttribute('data-vm-motion'));
  assert.equal(doc.head.querySelector('style'), null, 'NO document sheet — the fragment is complete');
  assert.doesNotMatch(style.textContent, /@property/, '@property never rides inline (document-global)');

  const before = doc.body.innerHTML;
  renderMotion(doc, { inline: true });
  assert.equal(doc.body.innerHTML, before, 'rendering rendered markup changes nothing');
});

test('client hoist:false delivers the child, and an attribute edit rewrites it', async () => {
  const { wireDirectives, motion, settled } = await load('directives');
  wireDirectives([motion({ inertia: 0, hoist: false })]);
  const host = document.createElement('div');
  host.innerHTML = `<div id="b" data-vd-motion="${VALUE}">x</div>`;
  const el = host.querySelector('#b');
  Object.defineProperty(el, 'offsetTop', { value: 300, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: 100, configurable: true });
  document.body.appendChild(host);
  await settled();
  await new Promise((r) => setTimeout(r, 60));

  const style = child(el);
  assert.ok(style, 'delivered as a child');
  const firstHash = style.getAttribute('data-vm-for');
  assert.equal(firstHash, el.getAttribute('data-vm-motion'));

  el.setAttribute('data-vd-motion', "{ keyframes: { opacity: '0% 0.5, 100% 1' }, scroll: '100%, 0%' }");
  await settled();
  await new Promise((r) => setTimeout(r, 60));
  const rewritten = child(el);
  assert.ok(rewritten, 'still one child');
  assert.notEqual(rewritten.getAttribute('data-vm-for'), firstHash, 'rebuild-on-edit rewrote it');
  assert.equal([...el.children].filter((c) => c.localName === 'style').length, 1, 'never duplicated');

  host.remove();
  await settled();
});

test('client over SSR-inline markup: the child is taken over in place, not rewritten', async () => {
  const { settled } = await load('directives');
  /** Server half: real renderMotion output, inline mode, injected as arrived markup. */
  const page = new JSDOM(`<body><div id="c" data-vd-motion="${VALUE}">x</div></body>`,
    { url: 'https://x.test/' });
  renderMotion(page.window.document, { inline: true });
  const host = document.createElement('div');
  host.innerHTML = page.window.document.body.innerHTML;
  const el = host.querySelector('#c');
  Object.defineProperty(el, 'offsetTop', { value: 300, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: 100, configurable: true });
  const serverChild = child(el);
  assert.ok(serverChild, 'the CONTROL: the server child arrived');
  document.body.appendChild(host);
  await settled();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(child(el), serverChild, 'the SAME node — taken over, not replaced');
  assert.equal([...el.children].filter((c) => c.localName === 'style').length, 1, 'no duplicate');
  host.remove();
  await settled();
});
