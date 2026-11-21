/**
 * **<vera-icon>'s behavior, as a page meets it** (sheets/icon.md): decorative by default, named by `label`, the user's
 * own `<svg>` kept byte-identical, `src` rendered as `<svg><use href>` in the SVG namespace, and `src` an ALLOW-list
 * (relative or same-origin http(s); everything else refused, with development saying why). Runs against both builds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://app.example/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver'])
  globalThis[key] = dom.window[key];
const said = [];
console.warn = (...args) => said.push(String(args[0]));
const { flush, wire } = await load('core');
wire([(await load('renderer')).renderer]);
await load('vera-components/icon');

const SVG = 'http://www.w3.org/2000/svg';
/** Mount markup, let the scheduler and the effects run, and hand back the first icon. */
const mount = async (markup) => {
  said.length = 0;
  document.body.innerHTML = markup;
  flush();
  await Promise.resolve();
  flush();
  return document.querySelector('vera-icon');
};
const settle = async () => {
  flush();
  await Promise.resolve();
  flush();
};
const codes = () => said.map((line) => /\(([a-z-]+)\)\s*$/.exec(line)?.[1] ?? line);

test('decorative by default: aria-hidden on the host, no role', async () => {
  const icon = await mount('<vera-icon><svg viewBox="0 0 20 20"><path d="M0 0h20"/></svg></vera-icon>');
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.equal(icon.hasAttribute('role'), false);
  assert.equal(icon.hasAttribute('aria-label'), false);
});

test('label names it (role="img"), and taking label away leaves nothing stale, both ways', async () => {
  const icon = await mount('<vera-icon label="Saved"><svg viewBox="0 0 20 20"></svg></vera-icon>');
  assert.deepEqual([icon.getAttribute('role'), icon.getAttribute('aria-label'), icon.hasAttribute('aria-hidden')], ['img', 'Saved', false]);
  icon.removeAttribute('label');
  await settle();
  assert.deepEqual([icon.hasAttribute('role'), icon.hasAttribute('aria-label'), icon.getAttribute('aria-hidden')], [false, false, 'true']);
  icon.setAttribute('label', 'Done');
  await settle();
  assert.deepEqual([icon.getAttribute('role'), icon.getAttribute('aria-label'), icon.hasAttribute('aria-hidden')], ['img', 'Done', false]);
});

test("the user's own <svg> stays byte-identical through renders and label changes", async () => {
  const markup = '<svg viewBox="0 0 20 20" class="mine" data-x="1"><path d="M1 1L19 19"></path></svg>';
  const icon = await mount(`<vera-icon>${markup}</vera-icon>`);
  const svg = icon.querySelector('svg');
  icon.setAttribute('label', 'Close');
  await settle();
  assert.equal(icon.querySelector('svg'), svg, 'the same node');
  assert.equal(svg.outerHTML, markup, 'byte-identical');
  assert.equal(icon.querySelectorAll('svg').length, 1, 'no second svg');
});

test('src renders <svg><use href> in the SVG namespace, decorative itself', async () => {
  const icon = await mount('<vera-icon src="/sprite.svg#check"></vera-icon>');
  const svg = icon.querySelector('svg[data-vera-part="svg"]');
  const use = svg?.querySelector('use');
  assert.ok(use, icon.innerHTML);
  assert.equal(svg.namespaceURI, SVG);
  assert.equal(use.namespaceURI, SVG);
  assert.equal(use.getAttribute('href'), '/sprite.svg#check');
  assert.equal(svg.getAttribute('aria-hidden'), 'true');
  assert.equal(svg.getAttribute('focusable'), 'false');
});

test('src allow-list: relative and same-origin render; every other scheme and origin is refused', async () => {
  const rendered = async (src) => !!(await mount(`<vera-icon src="${src}"></vera-icon>`)).querySelector('use');
  for (const src of ['#check', '/sprite.svg#check', 'icons/sprite.svg#a', 'https://app.example/sprite.svg#a'])
    assert.equal(await rendered(src), true, `${src} renders`);
  for (const src of ['javascript:alert(1)', 'data:image/svg+xml,%3Csvg%3E', 'blob:https://app.example/x', 'ftp://app.example/s.svg', 'http://app.example/s.svg#a', 'https://evil.example/s.svg#a', 'JaVaScRiPt:alert(1)'])
    assert.equal(await rendered(src), false, `${src} is refused`);
});

/**
 * **Same-origin means the DOCUMENT's origin, not the base URL's.** A relative src under `<base href>` on another
 * origin resolves to that origin, and the platform renders `<use>` only from the page's own origin, so it would show
 * nothing: it is refused, and development says icon-cross-origin. A `<base>` on the page's own origin still renders.
 */
test('a relative src under a <base> on another origin is refused as cross-origin; a same-origin <base> renders', async () => {
  const base = document.createElement('base');
  document.head.append(base);
  try {
    base.href = 'https://app.example/assets/';
    const own = await mount('<vera-icon src="sprite.svg#a"></vera-icon>');
    assert.equal(own.querySelector('use')?.getAttribute('href'), 'sprite.svg#a', 'CONTROL: a same-origin <base> renders the relative src');
    assert.deepEqual(said, []);
    base.href = 'https://cdn.example/';
    const other = await mount('<vera-icon src="sprite.svg#a"></vera-icon>');
    assert.equal(other.querySelector('use'), null, 'resolved to https://cdn.example/sprite.svg#a, another origin');
    assert.deepEqual(codes(), isProduction ? [] : ['icon-cross-origin']);
  } finally {
    base.remove();
  }
});

/** The README's promise: the child is looked for when the icon renders (connect, a src change), not observed. */
test('a child <svg> added after the first render takes over at the next src change', async () => {
  const icon = await mount('<vera-icon src="/sprite.svg#a"></vera-icon>');
  assert.ok(icon.querySelector('svg[data-vera-part="svg"] > use'), 'CONTROL: src renders first');
  const own = document.createElementNS(SVG, 'svg');
  icon.append(own);
  await settle();
  assert.ok(icon.querySelector('svg[data-vera-part="svg"]'), 'not observed: the src icon stays until src changes');
  icon.setAttribute('src', '/sprite.svg#b');
  await settle();
  assert.equal(icon.querySelector('svg[data-vera-part="svg"]'), null, 'at the src change the child wins');
  assert.ok(own.isConnected && own.parentNode === icon, 'the child is kept');
  assert.deepEqual(codes(), isProduction ? [] : ['icon-two-sources']);
});

test('development says why a src is not shown; production says nothing', async () => {
  await mount('<vera-icon src="javascript:alert(1)"></vera-icon>');
  assert.deepEqual(codes(), isProduction ? [] : ['icon-scheme']);
  await mount('<vera-icon src="https://evil.example/s.svg#a"></vera-icon>');
  assert.deepEqual(codes(), isProduction ? [] : ['icon-cross-origin']);
  await mount('<vera-icon src="/s.svg#a"><svg></svg></vera-icon>');
  assert.deepEqual(codes(), isProduction ? [] : ['icon-two-sources']);
  if (!isProduction) for (const line of said) assert.match(line, /^\[vera\] /);
  await mount('<vera-icon src="/s.svg#a"></vera-icon>');
  assert.deepEqual(said, [], 'a valid src says nothing (CONTROL: the warnings above are not noise)');
});

test('hostile strings through src and label create nothing beyond <svg><use>', async () => {
  const hostile = ['"><img src=x onerror=alert(1)>', '<script>alert(1)</script>', '#a" onload="alert(1)', '{label}{count}', '\u0000‮#x'];
  for (const value of hostile) {
    const icon = await mount('<vera-icon></vera-icon>');
    icon.setAttribute('src', value);
    icon.setAttribute('label', value);
    await settle();
    const tags = [...icon.querySelectorAll('*')].map((el) => el.localName);
    assert.ok(tags.every((tag) => tag === 'svg' || tag === 'use'), `${JSON.stringify(value)} → ${tags}`);
    assert.equal(document.querySelectorAll('img, script').length, 0);
    for (const el of icon.querySelectorAll('*')) for (const { name } of el.attributes) assert.ok(!/^on/i.test(name), `${name} on ${el.localName}`);
    assert.equal(icon.getAttribute('aria-label'), value, 'label is text, set as an attribute value');
  }
});
