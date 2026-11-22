/**
 * **A `<script>`'s URL is never bound** (Brian, 2026-11-22). `src` (and an SVG script's `href` or `xlink:href`) chooses
 * the code the script runs, so a value there is code arriving as data, as a value in the script's text is
 * (`script-hole`). The server served `<script src=${u}>` and it ran on load; an SVG `<script href=${u}>` rendered from a
 * template ran in WebKit. Refused everywhere a binding is written, the way each place already refuses `srcdoc`: core's
 * renderer and `spread` (the binding is ignored), `@verajs/lite`, `@verajs/static` and `@verajs/ssr` (the attribute is
 * never written). Development says so with one code, `script-source`; a URL written in the template is the author's own
 * and untouched. Every row runs on both builds; the words are development's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer, renderInto } = await load('renderer');
const { spread } = await load('renderer/spread');
core.wire([renderer]);
const lite = await load('lite');
const st = await load('static');

const URL = 'https://elsewhere.example/x.js';
let seq = 0;
const tag = (name) => `t-script-source-${name}-${seq++}`;

/** Console lines printed while `fn` runs. */
const said = (fn) => {
  const lines = [];
  const saved = console.warn;
  console.warn = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.warn = saved;
  }
  return lines;
};
/** Every `script-source` line said, and nothing else said: production says nothing at all. */
const saidOnly = (lines, count, label) => {
  if (isProduction) return assert.deepEqual(lines, [], `${label}: production says nothing`);
  assert.equal(lines.filter((line) => line.includes('(script-source)')).length, count, `${label}: ${JSON.stringify(lines)}`);
  assert.equal(lines.length, count, `${label}: nothing else said (${JSON.stringify(lines)})`);
  for (const line of lines) assert.match(line, /^\[vera\] .*on a <script>, whose URL chooses the code it runs — refused\./, label);
};

/** The refused shapes, as one template each: what is checked is the script's attributes after the render. */
const REFUSED = [
  ['src', (h) => h`<script src=${URL}></script>`],
  ['SRC, any case', (h) => h`<script SRC=${URL}></script>`],
  ['src with statics around the value', (h) => h`<script src="${URL}?v=${1}"></script>`],
  ['an SVG script href', (h) => h`<svg><script href=${URL}></script></svg>`],
  ['an SVG script xlink:href', (h) => h`<svg><script xlink:href=${URL}></script></svg>`],
];
/** The script carries no URL of the value's: no `src`, `href` or `xlink:href` holding it. */
const clean = (root) => {
  const script = root.querySelector('script');
  assert.ok(script, 'CONTROL: the script was rendered');
  for (const name of ['src', 'href', 'xlink:href']) assert.ok(!(script.getAttribute(name) ?? '').includes('elsewhere'), `${name}=${script.getAttribute(name)}`);
  return script;
};

test("core's renderer: a bound script URL is ignored, in every spelling; the property too", () => {
  for (const [label, draw] of [...REFUSED, ['.src', (h) => h`<script .src=${URL}></script>`], ['!src', (h) => h`<script !src=${URL}></script>`]]) {
    const host = document.createElement('div');
    const lines = said(() => renderInto(draw(core.html), host));
    clean(host);
    assert.equal(host.querySelector('script').src ?? '', '', `${label}: the property holds nothing (an SVG script has none)`);
    saidOnly(lines, label === 'src with statics around the value' ? 1 : 1, label);
  }
});

test("CONTROL, core's renderer: a written script URL, a bound image src, an event and a boolean on a script are untouched", () => {
  const host = document.createElement('div');
  const lines = said(() => renderInto(core.html`<script src="/mine.js" ?async=${true} @load=${() => {}}></script><img src=${URL}>`, host));
  assert.equal(host.querySelector('script').getAttribute('src'), '/mine.js');
  assert.equal(host.querySelector('script').hasAttribute('async'), true);
  assert.equal(host.querySelector('img').getAttribute('src'), URL);
  assert.deepEqual(lines, []);
});

test('spread: a script URL key is ignored in every spelling, and a written src beside it stays', () => {
  for (const [label, draw] of [
    ['src', (h) => h`<script ${spread({ src: URL })}></script>`],
    ['SRC', (h) => h`<script ${spread({ SRC: URL })}></script>`],
    ['.src', (h) => h`<script ${spread({ '.src': URL })}></script>`],
    ['an SVG script xlink:href', (h) => h`<svg><script ${spread({ 'xlink:href': URL })}></script></svg>`],
    ['an SVG script href', (h) => h`<svg><script ${spread({ href: URL })}></script></svg>`],
  ]) {
    const host = document.createElement('div');
    const lines = said(() => renderInto(draw(core.html), host));
    clean(host);
    saidOnly(lines, 1, label);
  }
  const host = document.createElement('div');
  said(() => renderInto(core.html`<script src="/mine.js" ${spread({ src: URL, type: 'module' })}></script><img ${spread({ src: URL })}>`, host));
  assert.equal(host.querySelector('script').getAttribute('src'), '/mine.js', 'the written src stays');
  assert.equal(host.querySelector('script').getAttribute('type'), 'module', 'CONTROL: the bag applied its other keys');
  assert.equal(host.querySelector('img').getAttribute('src'), URL, 'CONTROL: an image takes its src');
});

test('lite: a bound script URL is never written, the property too', () => {
  for (const [label, draw] of [...REFUSED, ['.src', (h) => h`<script .src=${URL}></script>`]]) {
    const name = tag('lite');
    lite.define(name, () => () => draw(lite.html));
    let el;
    const lines = said(() => (el = document.body.appendChild(document.createElement(name))));
    clean(el);
    assert.equal(el.querySelector('script').src ?? '', '', `${label}: the property holds nothing (an SVG script has none)`);
    saidOnly(lines, 1, label);
    el.remove();
  }
  const name = tag('lite-ok');
  lite.define(name, () => () => lite.html`<script src="/mine.js"></script><img src=${URL}>`);
  const el = document.body.appendChild(document.createElement(name));
  assert.equal(el.querySelector('script').getAttribute('src'), '/mine.js', 'CONTROL: a written src');
  assert.equal(el.querySelector('img').getAttribute('src'), URL, 'CONTROL: a bound image src');
  el.remove();
});

test('static: a bound script URL is not written, the rest of the template is', () => {
  for (const [label, draw] of REFUSED) {
    const Class = st.define(tag('static'), () => () => draw(st.html));
    const element = new Class();
    const lines = said(() => element.connectedCallback());
    clean(element);
    saidOnly(lines, 1, label);
  }
  const Class = st.define(tag('static-ok'), () => () => st.html`<script src="/mine.js"></script><img src=${URL}>`);
  const element = new Class();
  element.connectedCallback();
  assert.equal(element.querySelector('script').getAttribute('src'), '/mine.js', 'CONTROL: a written src');
  assert.equal(element.querySelector('img').getAttribute('src'), URL, 'CONTROL: a bound image src');
});

/** Last, and imported here: the server installs its own DOM globals over jsdom's. */
test('the server: a bound script URL is never served, from a template or a spread; a written src stays', async () => {
  const { serializeTemplate } = await import('@verajs/ssr');
  const serve = (draw) => serializeTemplate(draw(core.html));
  for (const [label, draw] of [
    ...REFUSED,
    ['spread src', (h) => h`<script ${spread({ src: URL })}></script>`],
    ['spread SRC', (h) => h`<script ${spread({ SRC: URL })}></script>`],
    ['spread xlink:href on an SVG script', (h) => h`<svg><script ${spread({ 'xlink:href': URL })}></script></svg>`],
  ]) {
    const page = serve(draw);
    assert.ok(page.includes('<script') && !page.includes('elsewhere'), `${label}: ${page}`);
  }
  assert.equal(serve((h) => h`<script src="/mine.js" ${spread({ src: URL })}></script>`), '<script src="/mine.js"></script>', 'a written src beside a spread one');
  assert.equal(serve((h) => h`<img src=${URL}>`), `<img src="${URL}">`, 'CONTROL: an image takes its src');
  assert.equal(serve((h) => h`<script src="/mine.js"></script>`), '<script src="/mine.js"></script>', 'CONTROL: a written src');
});
