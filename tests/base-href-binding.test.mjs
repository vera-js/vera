/**
 * **A `<base>`'s URL is never bound** (2026-11-23). Every relative and path-absolute URL after a `<base href>` resolves
 * against it — a module script's `src="/assets/app.js"` included — so a value there chooses where the page's code loads
 * from: measured in Chromium, Firefox and WebKit, as the server serves a bound base and as the renderer writes one into
 * `<head>` (BROWSER-LEDGER, 2026-11-23). Refused everywhere a binding is written, as a script's own URL is
 * (`script-source-binding.test.mjs`): core's renderer and `spread` ignore it, `@verajs/lite`, `@verajs/static` and
 * `@verajs/ssr` never write it. Development says so with one code, `base-href`; a base written in the template is the
 * author's own, and `<base target>` still binds. Every row runs on both builds; the words are development's. Hosts are
 * detached where the place allows, so a control's written base never rebases the test document.
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

const URL = 'https://elsewhere.example/';
let seq = 0;
const tag = (name) => `t-base-href-${name}-${seq++}`;

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
/** Every `base-href` line said, and nothing else said: production says nothing at all. */
const saidOnly = (lines, count, label) => {
  if (isProduction) return assert.deepEqual(lines, [], `${label}: production says nothing`);
  assert.equal(lines.filter((line) => line.includes('(base-href)')).length, count, `${label}: ${JSON.stringify(lines)}`);
  assert.equal(lines.length, count, `${label}: nothing else said (${JSON.stringify(lines)})`);
  for (const line of lines) assert.match(line, /^\[vera\] .*on a <base>, which every later relative and path-absolute URL on the page resolves against, its scripts' included — refused\./, label);
};

/** The refused shapes, one template each: what is checked is the base's attributes after the render. */
const REFUSED = [
  ['href', (h) => h`<base href=${URL}>`],
  ['HREF, any case', (h) => h`<base HREF=${URL}>`],
  ['href with statics around the value', (h) => h`<base href="${URL}x/${1}/">`],
];
/** The base carries no URL of the value's, attribute or property. */
const clean = (root, label) => {
  const base = root.querySelector('base');
  assert.ok(base, `CONTROL: the base was rendered (${label})`);
  assert.ok(!(base.getAttribute('href') ?? '').includes('elsewhere'), `${label}: href=${base.getAttribute('href')}`);
  assert.ok(!String(base.href ?? '').includes('elsewhere'), `${label}: the property holds no URL of the value's (${base.href})`);
  return base;
};

test("core's renderer: a bound base href is ignored, in every spelling; the property and live property too", () => {
  for (const [label, draw] of [...REFUSED, ['.href', (h) => h`<base .href=${URL}>`], ['!href', (h) => h`<base !href=${URL}>`]]) {
    const host = document.createElement('div');
    const lines = said(() => renderInto(draw(core.html), host));
    clean(host, label);
    saidOnly(lines, 1, label);
  }
});

test("CONTROL, core's renderer: a written base href, a bound base target and a bound link href are untouched", () => {
  const host = document.createElement('div');
  const lines = said(() => renderInto(core.html`<base href="/mine/" target=${'_blank'}><a href=${URL}>x</a>`, host));
  assert.equal(host.querySelector('base').getAttribute('href'), '/mine/');
  assert.equal(host.querySelector('base').getAttribute('target'), '_blank');
  assert.equal(host.querySelector('a').getAttribute('href'), URL);
  assert.deepEqual(lines, []);
});

test('spread: a base href key is ignored for every sigil, and the bag applies its other keys', () => {
  const keys = ['href', '.href', '!href', 'HREF'];
  for (const key of keys) {
    const host = document.createElement('div');
    const lines = said(() => renderInto(core.html`<base ${spread({ [key]: URL, target: '_top' })}>`, host));
    const base = clean(host, key);
    assert.equal(base.getAttribute('target'), '_top', `CONTROL: the bag applied its other keys (${key})`);
    saidOnly(lines, 1, key);
  }
  const host = document.createElement('div');
  said(() => renderInto(core.html`<base href="/mine/" ${spread({ href: URL })}><a ${spread({ href: URL })}>x</a>`, host));
  assert.equal(host.querySelector('base').getAttribute('href'), '/mine/', 'the written href stays');
  assert.equal(host.querySelector('a').getAttribute('href'), URL, 'CONTROL: a link takes its href');
});

test('lite: a bound base href is never written, the property too', () => {
  for (const [label, draw] of [...REFUSED, ['.href', (h) => h`<base .href=${URL}>`], ['!href', (h) => h`<base !href=${URL}>`]]) {
    const name = tag('lite');
    lite.define(name, () => () => draw(lite.html));
    let el;
    const lines = said(() => (el = document.body.appendChild(document.createElement(name))));
    clean(el, label);
    saidOnly(lines, 1, label);
    el.remove();
  }
  const name = tag('lite-ok');
  lite.define(name, () => () => lite.html`<base target=${'_blank'}><a href=${URL}>x</a>`);
  const el = document.body.appendChild(document.createElement(name));
  assert.equal(el.querySelector('base').getAttribute('target'), '_blank', 'CONTROL: a bound base target');
  assert.equal(el.querySelector('a').getAttribute('href'), URL, 'CONTROL: a bound link href');
  el.remove();
});

test('static: a bound base href is not written, the rest of the template is', () => {
  for (const [label, draw] of REFUSED) {
    const Class = st.define(tag('static'), () => () => draw(st.html));
    const element = new Class();
    const lines = said(() => element.connectedCallback());
    clean(element, label);
    saidOnly(lines, 1, label);
  }
  const Class = st.define(tag('static-ok'), () => () => st.html`<base href="/mine/" target=${'_blank'}><a href=${URL}>x</a>`);
  const element = new Class();
  element.connectedCallback();
  assert.equal(element.querySelector('base').getAttribute('href'), '/mine/', 'CONTROL: a written href');
  assert.equal(element.querySelector('base').getAttribute('target'), '_blank', 'CONTROL: a bound target');
  assert.equal(element.querySelector('a').getAttribute('href'), URL, 'CONTROL: a bound link href');
});

/** Last, and imported here: the server installs its own DOM globals over jsdom's. */
test('the server: a bound base href is never served, from a template or a spread; a written one stays', async () => {
  const { serializeTemplate } = await import('@verajs/ssr');
  const serve = (draw) => serializeTemplate(draw(core.html));
  for (const [label, draw] of [
    ...REFUSED,
    ['spread href', (h) => h`<base ${spread({ href: URL })}>`],
    ['spread HREF', (h) => h`<base ${spread({ HREF: URL })}>`],
  ]) {
    const page = serve(draw);
    assert.ok(page.includes('<base') && !page.includes('elsewhere'), `${label}: ${page}`);
  }
  assert.equal(serve((h) => h`<base href="/mine/" ${spread({ href: URL })}>`), '<base href="/mine/">', 'a written href beside a spread one');
  assert.equal(serve((h) => h`<base target=${'_blank'}>`), '<base target="_blank">', 'CONTROL: a bound target');
  assert.equal(serve((h) => h`<a href=${URL}>x</a>`), `<a href="${URL}">x</a>`, 'CONTROL: a link takes its href');
  assert.equal(serve((h) => h`<base href="/mine/">`), '<base href="/mine/">', 'CONTROL: a written href');
});
