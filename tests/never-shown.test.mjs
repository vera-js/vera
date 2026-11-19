/**
 * **A value inside an element whose content is never shown renders, as text that can never become markup** (Brian,
 * 2026-11-18: "what if someone wants to render an iframe or noscript?"). `<iframe>`, `<noscript>` and the obsolete
 * raw-text four (`xmp`, `noembed`, `noframes`, `plaintext`) hold text in core: the renderer writes each VALUE fully
 * encoded (every ASCII non-word character as a character reference), so a page saved from the
 * DOM and parsed again holds no value that ends the element or adds an attribute — with scripting on (raw text: no `<`
 * survives) or off (markup: `&#32;` decodes INTO an attribute value, never ends it). An analytics pixel in a
 * `<noscript>` keeps working. `@verajs/lite` and `@verajs/static` REFUSE a value there, their tier rule (Brian, 2026-11-19:
 * a noscript they render can never show — they run only with scripting on — and an iframe's content is fallback no
 * engine shows; an iframe's attributes, a noscript with no value, work on both). A TEMPLATE there is refused on every side (`template-in-text`, `ssr-template-in-text`): the
 * content is text. The server writes these values escaped and quoted, so its bytes differ from the client's (accepted:
 * hydration rewrites them). jsdom runs with scripting OFF, so it parses a `<noscript>` as markup — the scripting-on half
 * of the round trip is `tests/browser/never-shown.test.js`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM, VirtualConsole } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const core = await load('core');
const { renderer, renderInto } = await load('renderer');
core.wire([renderer]);
const staticTier = await load('static');
const lite = await load('lite');

const IMG = '<img src=x onerror=zq()>';
const PIXEL = 'https://px.example/a?b=1&c=2';
/** A saved page parsed again (jsdom: scripting off, so a noscript is markup — the harder half for attributes). */
const reparsed = (markup) => new JSDOM(`<!doctype html><body>${markup}</body>`, { virtualConsole: new VirtualConsole() }).window.document.body;
/** Every element in a tree, template content included, carrying an inline handler. */
const handlers = (root) => [...root.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name)));
const literal = (pieces) => Object.assign([...pieces], { raw: [...pieces] });

const SHAPES = {
  'iframe, a closer in the value': [['<iframe src="/a">', '</iframe>'], [`</iframe>${IMG}`], 'iframe'],
  'noscript, a closer in the value': [['<noscript>', '</noscript>'], [`</noscript>${IMG}`], 'noscript'],
  'noscript, an unquoted attribute value': [['<noscript><img src=', '></noscript>'], ['x onerror=zq()'], 'noscript'],
  'noscript, a quoted attribute value': [['<noscript><img src="', '"></noscript>'], ['x" onerror="zq()'], 'noscript'],
  'xmp': [['<xmp>', '</xmp>'], [`</xmp>${IMG}`], 'xmp'],
  'noembed': [['<noembed>', '</noembed>'], [`</noembed>${IMG}`], 'noembed'],
  'noframes': [['<noframes>', '</noframes>'], [`</noframes>${IMG}`], 'noframes'],
};

/** Core draws the shape (renderInto); the two small tiers refuse it (below). */
const SIDES = {
  core: (strings, values) => {
    const host = document.createElement('div');
    renderInto(core.html(literal(strings), ...values), host);
    return host;
  },
};
/** A small tier's component, connected: the error its render reported (a custom element reaction reports to the window), or its light DOM. */
const mount = (tier, strings, values) => {
  const tag = `ns-${tier === lite ? 'lite' : 'static'}-${seq++}`;
  const shape = literal(strings);
  tier.define(tag, () => () => tier.html(shape, ...values));
  let error;
  const listener = (event) => { error = event.error; event.preventDefault(); };
  dom.window.addEventListener('error', listener);
  const host = document.body.appendChild(document.createElement('div'));
  try { host.append(document.createElement(tag)); } finally { dom.window.removeEventListener('error', listener); host.remove(); }
  return error ?? host.firstElementChild;
};
let seq = 0;

for (const [side, draw] of Object.entries(SIDES))
  test(`${side}: a value in a never-shown element renders as text, and never becomes markup — live or after a save and reload`, () => {
    for (const [name, [strings, values, tag]] of Object.entries(SHAPES)) {
      const host = draw(strings, values);
      const element = host.querySelector(tag);
      assert.ok(element, `${name}: CONTROL: the element rendered`);
      assert.equal(host.querySelector('img'), null, `${name}: no element live`);
      assert.deepEqual(handlers(host), [], `${name}: no handler live`);
      const back = reparsed(host.innerHTML);
      assert.deepEqual(handlers(back), [], `${name}: no handler after a round trip: ${host.innerHTML}`);
      assert.equal(back.querySelectorAll(tag).length, 1, `${name}: the element ended where it should`);
    }
  });

/**
 * The pixel's TEXT, as written (jsdom has scripting off, so it serializes a noscript's text escaped and cannot show the
 * saved page; the round trip with scripting on, then parsed with scripting off, is the browser row's).
 */
for (const [side, draw] of Object.entries(SIDES))
  test(`${side}: an analytics pixel in a <noscript> is written as its text with the URL encoded`, () => {
    const host = draw(['<noscript><img src=', ' alt=""></noscript>'], [PIXEL]);
    const text = host.querySelector('noscript').textContent;
    assert.ok(text.startsWith('<img src='), `the author's markup, as text: ${text}`);
    assert.equal(text.includes(PIXEL), false, 'the value is encoded, not raw');
    assert.ok(text.includes('https&#58;&#47;&#47;px&#46;example'), text);
  });

test('lite and static refuse a value in a never-shown element, in every build (tier-hole-position, static-hole); its attributes and value-free content render', () => {
  const TIERS = [[lite, /tier-hole-position/], [staticTier, /static-hole/]];
  const refused = [...Object.values(SHAPES).map(([strings, values]) => [strings, values]), [['<iframe src="/a">', '</iframe>'], ['fallback']], [['<noscript>', '</noscript>'], ['Enable JS']]];
  for (const [tier, code] of TIERS) {
    for (const [strings, values] of refused) {
      const out = mount(tier, strings, values);
      assert.ok(out instanceof Error && code.test(out.message), `${strings.join('${…}')}: ${out?.message ?? out?.outerHTML}`);
    }
    /** CONTROLS: what a small tier's author writes instead renders. */
    const frame = mount(tier, ['<iframe src=', ' title=', '></iframe>'], ['https://video.example/embed?id=7&t=3', 'A video']);
    assert.ok(!(frame instanceof Error), String(frame?.message));
    assert.equal(frame.querySelector('iframe').getAttribute('src'), 'https://video.example/embed?id=7&t=3');
    const fixed = mount(tier, ['<noscript><img src="https://px.example/a" alt=""></noscript><p>', '</p>'], ['x']);
    assert.ok(!(fixed instanceof Error), String(fixed?.message));
    assert.ok(fixed.querySelector('noscript') && fixed.querySelector('p').textContent === 'x');
  }
});

test('core: a template inside a never-shown element is refused (template-in-text), at any depth', () => {
  const shapes = [
    (h) => h`<noscript>${h`<img src=${PIXEL}>`}</noscript>`,
    (h) => h`<noscript><div>${h`<b>x</b>`}</div></noscript>`,
    (h) => h`<iframe>${[h`<b>x</b>`]}</iframe>`,
  ];
  for (const [i, draw] of shapes.entries()) {
    assert.throws(() => renderInto(draw(core.html), document.createElement('div')), /template-in-text/, `core #${i}`);
  }
});

/** The server's half, in a child process (`@verajs/ssr` installs its DOM's globals for the process). */
const served = JSON.parse(
  execFileSync(process.execPath, [...process.execArgv, '--input-type=module', '-e', `
import { serializeTemplate } from '@verajs/ssr';
const literal = (p) => Object.assign([...p], { raw: [...p] });
const t = (s, ...v) => ({ strings: literal(s), values: v });
const inner = t(['<img src="', '">'], 'x');
const out = {};
const run = (k, f) => { try { out[k] = { html: f() }; } catch (e) { out[k] = { error: String(e.message) }; } };
run('pixel', () => serializeTemplate(t(['<noscript><img src=', ' alt=""></noscript>'], ${JSON.stringify(PIXEL)})));
run('attack', () => serializeTemplate(t(['<noscript><img src=', '></noscript>'], 'x onerror=zq()')));
run('template', () => serializeTemplate(t(['<noscript>', '</noscript>'], inner)));
run('nested', () => serializeTemplate(t(['<noscript><div>', '</div></noscript>'], inner)));
run('iframe', () => serializeTemplate(t(['<iframe>', '</iframe>'], inner)));
process.stdout.write(JSON.stringify(out));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: process.env }),
);

test('the server: a noscript attribute is served QUOTED (the scripting-off parse adds no attribute); a template inside is refused', () => {
  assert.match(served.pixel.html, /src="https:\/\/px\.example\/a\?b=1&#38;c=2"/, served.pixel.html);
  assert.equal(reparsed(served.pixel.html).querySelector('noscript img')?.getAttribute('src'), PIXEL);
  const attack = reparsed(served.attack.html);
  assert.ok(attack.querySelector('noscript img'), `CONTROL: the img parsed: ${served.attack.html}`);
  assert.deepEqual(handlers(attack), [], served.attack.html);
  for (const key of ['template', 'nested', 'iframe']) assert.match(String(served[key].error), /ssr-template-in-text/, `${key}: ${JSON.stringify(served[key])}`);
});
