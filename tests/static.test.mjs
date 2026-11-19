/**
 * **`@verajs/static`**: `define` and `html` / `svg` / `mathml`, rendered ONCE into markup by one `innerHTML` write, with
 * no reactivity, and no value ever becoming code (2026-11-18). Both builds. Held here:
 *
 * 1. What `define` does: the call shapes, props copied per element, a value set before the definition kept, attributes
 *    read once as camel props, methods on the prototype, a shadow root (the existing one reused), a moved component not
 *    rendered again, a setup returning the result itself, and an own `__proto__` key skipped.
 * 2. **The injection corpus**: every attack refused (coded `static-hole`) or neutralized (rendered inert), each read back
 *    from the DOM a real parser built, with the controls that must render as written — over-refusing is allowed,
 *    injecting is not. Then the forged-template corpus every renderer reads (`fixtures/forged-cases.mjs`).
 * 3. Parity: static's tags and core's and lite's give one template-result shape; a value in an attribute is written as
 *    core writes it; shared component sources render the same content in static, lite and core.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';
import { FORGED_CASES, readCase } from './fixtures/forged-cases.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];

const st = await load('static');
const lite = await load('lite');
const core = await load('core');
const { renderer } = await load('renderer');
core.wire([renderer]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
let seq = 0;
const tag = (name) => `t-static-${name}-${seq++}`;
/**
 * Renders `draw(html)` in a fresh static component and answers its element, or the refusal it threw: `connectedCallback`
 * is called directly (static renders on it, connected or not), so a refusal reaches this caller, not the window's error.
 */
const renderStatic = (draw) => {
  const Class = st.define(tag('r'), () => () => draw(st.html, st.svg, st.mathml));
  const element = new Class();
  try {
    element.connectedCallback();
    return { element };
  } catch (error) {
    return { error };
  }
};
/** What a real parser builds from the markup static wrote (not the DOM static's own write made: they are the same parse). */
const reparsed = (element) => new JSDOM(`<!doctype html><body>${element.innerHTML}</body>`).window.document.body;

/* ── 1. define ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

test('static: renders once, through both call shapes, with props copied per element and attributes read once', async () => {
  st.define(tag('plain'), () => () => st.html`<p>plain</p>`);
  const Card = st.define({ tag: tag('card'), props: { tags: ['a'], heading: 'H' }, attributes: ['data-tone'], methods: { label() { return `${this.heading}!`; } } }, (host) => () =>
    st.html`<h2 class="${host.dataTone}">${host.heading}</h2><ul>${host.tags.map((t) => st.html`<li>${t}</li>`)}</ul>`);
  const [a, b] = [new Card(), new Card()];
  b.heading = 'set before connect';
  a.setAttribute('data-tone', 'warm');
  document.body.append(a, b);
  assert.equal(a.querySelector('h2').className, 'warm', 'an attribute, read once as its camel prop');
  assert.equal(a.querySelector('h2').textContent, 'H');
  assert.equal(b.querySelector('h2').textContent, 'set before connect', 'a value set before the first connect is kept');
  assert.notEqual(a.tags, b.tags, 'an array default is copied per element');
  assert.equal(a.label(), 'H!', 'methods are on the prototype, `this` the element');
  a.heading = 'changed';
  await settle();
  assert.equal(a.querySelector('h2').textContent, 'H', 'no reactivity: a later write changes nothing');
  const before = a.querySelector('h2');
  document.body.append(a);
  assert.equal(a.querySelector('h2'), before, 'a moved component keeps its markup: not rendered again');
  a.remove();
  b.remove();
});

test('static: a method never replaces what the class owns — methods.connectedCallback does not disable the render (core\'s order)', () => {
  const { warn } = console;
  console.warn = () => {};
  try {
    const Class = st.define({ tag: tag('meth'), methods: { connectedCallback() { this.dataset.mine = '1'; }, label() { return 'ok'; } } }, () => () => st.html`<b>rendered</b>`);
    const element = document.body.appendChild(new Class());
    assert.equal(element.querySelector('b')?.textContent, 'rendered', 'the render ran');
    assert.equal(element.dataset.mine, undefined, 'the method was not installed, as the development check says');
    assert.equal(element.label(), 'ok', 'CONTROL: an ordinary method is installed');
    element.remove();
  } finally {
    console.warn = warn;
  }
});

test('static: in an XHTML (XML) document the render is refused — it throws, nothing is written (static is for HTML documents)', () => {
  const xml = document.implementation.createDocument('http://www.w3.org/1999/xhtml', 'html');
  const Class = st.define(tag('xhtml'), () => () => st.html`<p>${'a < b'}</p><style>.a{--x:${'</style><img src=x onerror=1>'}}</style>`);
  /** Adopted, not appended: appending would run the connect (and its throw) as a reaction, reported, not to this caller. */
  const element = xml.adoptNode(new Class());
  assert.throws(() => element.connectedCallback(), /disallowed|invalid|syntax/i);
  assert.equal(element.childNodes.length, 0, 'nothing written');
});

test('static: a shadow root (an existing one reused), a setup returning the result itself, an own __proto__ key skipped', () => {
  const name = tag('shadow');
  const early = document.createElement(name);
  const served = early.attachShadow({ mode: 'open' });
  document.body.append(early);
  st.define({ tag: name, shadow: 'open' }, () => st.html`<b>in</b>`);
  assert.equal(early.shadowRoot, served, 'the existing root is the one rendered into');
  assert.equal(served.querySelector('b').textContent, 'in', 'a setup may return the result itself');
  const props = JSON.parse('{"__proto__": {"polluted": 1}, "n": 1}');
  const methods = JSON.parse('{"__proto__": {"polluted": 1}}');
  const Class = st.define({ tag: tag('proto'), props, methods }, (host) => () => st.html`${host.n}`);
  const element = document.body.appendChild(new Class());
  assert.equal(element.textContent, '1', 'CONTROL: the ordinary prop rendered');
  assert.equal(element.polluted, undefined);
  assert.equal(Object.getPrototypeOf(Class.prototype), HTMLElement.prototype);
  early.remove();
  element.remove();
});

/* ── 2. the injection corpus ───────────────────────────────────────────────────────────────────────────────────────── */

const handled = (body) => [...body.querySelectorAll('*')].some((element) => [...element.attributes].some((a) => /^on/i.test(a.name) && /alert|evil/.test(a.value)));
/** [name, draw, bad(body)]: `bad` says whether the attack worked in the DOM a real parser built from static's output. */
const ATTACKS = [
  ['markup in a text value', (h) => h`<p>${'<img src=x onerror=alert(1)>'}</p>`, (b) => !!b.querySelector('img')],
  ['breaking out of a quoted attribute', (h) => h`<a title="${'"><img src=x onerror=alert(1)>'}">x</a>`, (b) => !!b.querySelector('img')],
  ['an attribute injected through an unquoted one', (h) => h`<a href=${'# onclick=alert(1)'}>x</a>`, (b) => handled(b)],
  ['a name position', (h) => h`<div ${'onclick=alert(1)'}>x</div>`, (b) => handled(b)],
  ['a quote inside an unquoted static value', (h) => h`<a title=x"y ${'onclick=alert(1)'}>x</a>`, (b) => handled(b)],
  ['an inline handler body', (h) => h`<button onclick="go(${'1);alert(1);('})">x</button>`, (b) => handled(b)],
  ['an unquoted inline handler', (h) => h`<button onclick=${'alert(1)'}>x</button>`, (b) => handled(b)],
  ['a javascript: URL', (h) => h`<a href=${'javascript:alert(1)'}>x</a>`, (b) => /script:/i.test(b.querySelector('a')?.getAttribute('href') ?? '')],
  ['an obfuscated javascript: URL', (h) => h`<a href="${' \tjava\nscript:alert(1)'}">x</a>`, (b) => /script:/i.test(b.querySelector('a')?.getAttribute('href') ?? '')],
  ['a javascript: URL split across two holes', (h) => h`<a href="${' \t'}${'javascript:alert(1)'}">x</a>`, (b) => /script/i.test(b.querySelector('a')?.getAttribute('href') ?? '')],
  ['a javascript: item in an href (every URL name is checked item by item, where core checks href whole)', (h) => h`<a href="${'a;javascript:alert(1)'}">x</a>`, (b) => /javascript/.test(b.querySelector('a')?.getAttribute('href') ?? '')],
  ['an SVG animation values list', (h) => h`<svg><a><animate attributeName="href" values="${'#a;javascript:alert(1)'}"></animate></a></svg>`, (b) => (b.querySelector('animate')?.getAttribute('values') ?? '').includes('javascript')],
  ['an SVG xlink:href', (h) => h`<svg><a xlink:href=${'javascript:alert(1)'}><text>x</text></a></svg>`, (b) => /javascript/.test(b.querySelector('a')?.getAttribute('xlink:href') ?? '')],
  ['srcdoc', (h) => h`<iframe srcdoc="${'<script>alert(1)</script>'}"></iframe>`, (b) => (b.querySelector('iframe')?.getAttribute('srcdoc') ?? '').includes('<script')],
  ['a value in a <script>', (h) => h`<script>var a = ${'alert(1)'}</script>`, (b) => (b.querySelector('script')?.textContent ?? '').includes('alert')],
  ['a value in an SVG <script>', (h, svg) => h`<svg>${svg`<script>${'alert(1)'}</script>`}</svg>`, (b) => (b.querySelector('script')?.textContent ?? '').includes('alert')],
  ['a value in a <style>, as markup', (h) => h`<style>p{color:${'red}</style><img src=x onerror=alert(1)>'}}</style>`, (b) => !!b.querySelector('img')],
  ['a value in a JSON data block, as markup', (h) => h`<script type="application/json">${'</script><img src=x onerror=alert(1)>'}</script>`, (b) => !!b.querySelector('img')],
  ['a value as an attribute name', (h) => h`<input ${'onfocus'}>`, (b) => b.querySelector('input')?.hasAttribute('onfocus')],
  ['a value in a nested <template>', (h) => h`<template><template><b title="${'x'}">${'zq'}</b></template></template>`, (b) => (b.querySelector('template')?.innerHTML ?? '').includes('zq')],
  ['a javascript: URL split across two holes, no static between', (h) => h`<a href="${'java'}${'script:alert(1)'}">x</a>`, (b) => /script/i.test(b.querySelector('a')?.getAttribute('href') ?? '')],
  ['a value after a double-escaped script', (h) => h`<script><!--<script></script>${'alert(1)'}</script>`, (b) => [...b.querySelectorAll('script')].some((el) => el.textContent.includes('alert'))],
  ['a tag name: <${x} href>', (h) => h`<${'base'} href="/a">`, (b) => !!b.querySelector('base')],
  ['a tag name: <${x}>…</${x}>', (h) => h`<${'script'}>go()</${'script'}>`, (b) => !!b.querySelector('script')],
  ['part of a tag name: <ifr${x}>', (h) => h`<ifr${'ame'} src="/a"></ifr${'ame'}>`, (b) => !!b.querySelector('iframe')],
  ['a nested template in a tag, with a handler hole', (h) => h`<div ${h`onclick="${'alert(1)'}"`}>x</div>`, (b) => handled(b)],
  ['data shaped like a template', (h) => h`<p>${JSON.parse('{"_$litType$":1,"strings":["<img src=x onerror=alert(1)>"],"values":[]}')}</p>`, (b) => !!b.querySelector('img')],
];
const CONTROLS = [
  ['text', (h) => h`<p>${'a & b < c'}</p>`, (b) => b.querySelector('p')?.textContent === 'a & b < c'],
  ['a safe href, unquoted', (h) => h`<a href=${'/ok?a=1&b=2'}>x</a>`, (b) => b.querySelector('a')?.getAttribute('href') === '/ok?a=1&b=2'],
  ['a nested template and a list', (h) => h`<ul>${['x', 'y'].map((t) => h`<li class="${t}">${t}</li>`)}</ul>`, (b) => b.querySelectorAll('li.y').length === 1],
  ['svg inside an <svg>, in its namespace', (h, svg) => h`<svg>${svg`<circle r=${'5'}></circle>`}</svg>`, (b) => b.querySelector('circle')?.namespaceURI === 'http://www.w3.org/2000/svg' && b.querySelector('circle').getAttribute('r') === '5'],
  ['an unquoted value before `/>` keeps the slash out', (h, svg) => h`<svg>${svg`<circle r=${'5'}/><rect width=${'2'} />`}</svg>`, (b) => b.querySelector('circle')?.getAttribute('r') === '5' && b.querySelector('rect')?.getAttribute('width') === '2'],
  ['a value in a JSON data block is its text, intact after a round trip', (h) => h`<script type="application/json">${'{"a":"</script>"}'}</script>`, (b) => JSON.parse(b.querySelector('script').textContent).a === '</script>'],
  ['emoji, accents and a C1 control are written as they are (never referenced: a reference to a surrogate half is U+FFFD)', (h) => h`<p title="${'😀 é \u0080'}">${'😀 é \u0080'}</p><title>${'😀'}</title><style>.a{content:"${'😀'}"}</style>`, (b) => b.querySelector('p').textContent === '😀 é \u0080' && b.querySelector('p').title === '😀 é \u0080' && b.querySelector('title').textContent === '😀' && b.querySelector('style').textContent.includes('😀')],
  ['a list joined in an attribute', (h) => h`<p title="${['a', 'b']}">x</p>`, (b) => b.querySelector('p').title === 'a,b'],
  ['a value in a <style> is CSS text (Brian, 2026-11-17)', (h) => h`<style>p{color:${'red'}}</style>`, (b) => b.querySelector('style')?.textContent === 'p{color:red}'],
  ['a value the parser duplicates (adoption agency) is text, every copy clean', (h) => h`<b><p>${'v<i>'}</b>`, (b) => !b.innerHTML.includes('\u0001') && !b.querySelector('i') && b.textContent.includes('v<i>')],
];

for (const [name, draw, bad] of ATTACKS)
  test(`static, attack: ${name} — refused or rendered inert`, () => {
    const { element, error } = renderStatic(draw);
    if (error) return assert.match(String(error.message), /(?:\(|\/e\/)static-hole\)?$/, 'refused, coded');
    assert.equal(bad(reparsed(element)), false, `rendered as: ${element.innerHTML}`);
  });
for (const [name, draw, good] of CONTROLS)
  test(`static, control: ${name} — rendered as written`, () => {
    const { element, error } = renderStatic(draw);
    assert.equal(error, undefined, 'not refused');
    assert.equal(good(reparsed(element)), true, `rendered as: ${element.innerHTML}`);
  });

test('static: an attack corpus that measures something — each attack WORKS when the same markup is written by hand', () => {
  let worked = 0;
  for (const [, draw, bad] of ATTACKS) {
    /** The same template, its values spliced in unescaped: what plain string concatenation would serve. */
    const result = draw((strings, ...values) => ({ strings, values }), (strings, ...values) => ({ strings, values }));
    const splice = (r) => r.strings.reduce((out, s, i) => out + (i ? (r.values[i - 1]?.strings ? splice(r.values[i - 1]) : Array.isArray(r.values[i - 1]) ? r.values[i - 1].map(splice).join('') : r.values[i - 1]?.strings === undefined && r.values[i - 1]?._$litType$ ? r.values[i - 1].strings.join('') : r.values[i - 1]) : '') + s, '');
    if (bad(new JSDOM(`<!doctype html><body>${splice(result)}</body>`).window.document.body)) worked++;
  }
  assert.ok(worked >= ATTACKS.length - 2, `only ${worked} of ${ATTACKS.length} attacks work unescaped: the corpus would be measuring little`);
});

/** A value in an attribute is TEXT, written as core writes it (2026-11-18): a template stringified, a list joined. */
test('static: a template or a list in an attribute value is written as core writes it — text, never markup', async () => {
  const draw = (h) => h`<a href="${h`${'javascript:alert(1)'}`}">x</a><p title="${['a', 'b']}">y</p>`;
  const { element } = renderStatic(draw);
  core.define('p-static-attr', () => () => draw(core.html));
  const theirs = document.body.appendChild(document.createElement('p-static-attr'));
  core.flush();
  await settle();
  assert.equal(element.querySelector('a').getAttribute('href'), theirs.querySelector('a').getAttribute('href'));
  assert.equal(element.querySelector('a').getAttribute('href'), '[object Object]');
  assert.equal(element.querySelector('p').title, theirs.querySelector('p').title);
  theirs.remove();
});

test('forged templates: static renders every case of the shared corpus as the rule says', () => {
  assert.ok(FORGED_CASES.length >= 8, 'the corpus is loaded');
  const { warn } = console;
  console.warn = () => {};
  try {
    for (const c of FORGED_CASES) {
      const { element, error } = renderStatic((h) => h`<p>${c.make(h)}</p>`);
      assert.equal(error, undefined, c.name);
      assert.equal(readCase(element.querySelector('p')), c.expected, c.name);
    }
  } finally {
    console.warn = warn;
  }
});

/* ── 3. parity ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * **Static's tags, lite's and core's are three copies of one tag set, held to one shape** (2026-11-18): shared, core's
 * create1k measured +3.5% slower, so each package keeps its own. Through ONE call site, each kind gives the same kind,
 * keeps the very strings array, passes the values, and refuses a string in the same words.
 */
test(`static's html, svg and mathml give core's and lite's template result: kind, the strings array itself, the values`, () => {
  for (const [kind, name] of [[1, 'html'], [2, 'svg'], [3, 'mathml']]) {
    const draw = (t) => t`<g class=${'a'}>${2}</g>`;
    const [ours, liteResult, coreResult] = [draw(st[name]), draw(lite[name]), draw(core[name])];
    assert.equal(ours._$litType$, kind, `static: ${name} is kind ${kind}`);
    assert.equal(ours.strings, coreResult.strings);
    assert.equal(ours.strings, liteResult.strings);
    assert.deepEqual(ours.values, ['a', 2]);
    assert.deepEqual(Object.keys(ours).sort(), Object.keys(coreResult).sort());
    if (!isProduction) {
      const refused = (t) => { try { t('<g/>'); } catch (error) { return error.message; } };
      assert.match(refused(st[name]), /\(tag-called\)$/);
      assert.equal(refused(st[name]), refused(core[name]), 'in core\'s words');
    }
  }
});

/** One component source, rendered by static, lite and core: the same content (comments aside: lite's and core's ranges). */
const content = (root) => root.innerHTML.replace(/<!--[\s\S]*?-->/g, '');
const SOURCES = {
  card: ({ html }) => (host) => () => html`<h3 class="t ${host.tone}">${host.heading}</h3><p title=${host.heading}>${[1, 2].map((i) => html`<i>${i}</i>`)}</p>`,
  icon: ({ html, svg }) => (host) => () => html`<svg viewBox="0 0 10 10">${svg`<circle r=${host.size} cx="5"></circle>`}</svg>`,
  escaped: ({ html }) => (host) => () => html`<p data-x="${host.heading}">${host.tone} & ${host.heading}</p>`,
};
for (const [name, source] of Object.entries(SOURCES))
  test(`parity: ${name} renders the same content on static, lite and core`, async () => {
    const options = (prefix) => ({ tag: `${prefix}-par-${name}`, props: { heading: 'A "q" <b>', tone: 'warm', size: 4 } });
    st.define(options('s'), source(st));
    lite.define(options('l'), source(lite));
    core.define(options('c'), source(core));
    const [s, l, c] = ['s', 'l', 'c'].map((p) => document.body.appendChild(document.createElement(`${p}-par-${name}`)));
    core.flush();
    await settle();
    assert.ok(content(c).length > 10, `CONTROL: core rendered (${content(c)})`);
    /** Each element with its attributes sorted: core writes a bound attribute after the static ones, static in place. */
    const read = (root) => {
      const body = reparsed({ innerHTML: content(root) });
      for (const element of body.querySelectorAll('*')) {
        const attributes = [...element.attributes].map((a) => [a.name, a.value]).sort(([x], [y]) => (x < y ? -1 : 1));
        for (const [n] of attributes) element.removeAttribute(n);
        for (const [n, v] of attributes) element.setAttribute(n, v);
      }
      return body.innerHTML;
    };
    assert.equal(read(s), read(c), 'static and core');
    assert.equal(read(l), read(c), 'lite and core');
    for (const element of [s, l, c]) element.remove();
  });

/* ── development ───────────────────────────────────────────────────────────────────────────────────────────────────── */

test('static: a function value renders nothing, and development names what it needs', { skip: isProduction && 'development-only' }, () => {
  const lines = [];
  const { warn } = console;
  console.warn = (line) => lines.push(String(line));
  try {
    const { element } = renderStatic((h) => h`<p>${() => 1}</p>`);
    assert.equal(element.querySelector('p').textContent, '');
    st.define({ tag: tag('opt'), persist: true }, () => () => st.html`x`);
  } finally {
    console.warn = warn;
  }
  assert.equal(lines.filter((line) => /^\[vera\] static: .*\(static-needs-renderer\)$/.test(line)).length, 2, lines.join('\n'));
});

/**
 * **Author-static markup is the author's** (2026-11-18, the parser as judge): a nested template's STATIC text composed into
 * a tag (`<a ${html`href="…"`}>`) is written as the author wrote it — the same as writing it in the parent. Only values
 * are judged: a value in that nested template is refused where it would be code (the corpus' nested-handler row).
 */
test('static: a nested template\'s static text in a tag is the author\'s markup, composed as written', () => {
  const { element, error } = renderStatic((h) => h`<a ${h`class="nested"`}>x</a>`);
  assert.equal(error, undefined);
  assert.equal(reparsed(element).querySelector('a')?.className, 'nested');
});
