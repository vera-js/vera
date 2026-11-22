/**
 * **A `<script>` takes no property binding** (Brian, 2026-11-22: a JSON data block's included). Its properties include
 * its code — `textContent`, `innerHTML`, `innerText`, `text`, `outerHTML`, `outerText`: the server served
 * `<script .textContent=${v}>` and it ran on load, and a page saved from the DOM runs what the client wrote; a JSON
 * block's `.textContent` was served with `<!--` and `<script` raw. So every `.`/`!` binding on a script is refused (one
 * test, not a list: each property has an attribute form), everywhere a binding is written: core's renderer and `spread`
 * (the binding is ignored), `@verajs/lite` (nothing written), `@verajs/static` (no `.`/`!` binding is ever written) and
 * `@verajs/ssr` (never served). Development, and the server in every build, say so with one code, `script-property`; a
 * URL keeps its own, more specific reason (`script-source`). The data door, a JSON block's text hole, is untouched.
 * Every row runs on both builds; the words are development's.
 *
 * Planted red, one place at a time: each place's rows go red by name. Static has two independent layers
 * (`attributeValue` never encodes a `.`/`!` value, and the attribute is removed by its sigil): either alone keeps its
 * rows green, so its plant takes both.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parse } from 'parse5';
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

/** Breaks out of a script, a comment and a JSON block, and runs as code where it stays: each marker is looked for. */
const MARK = 'alert(61)';
const VALUE = `${MARK}//</script><img id=pwn src=x onerror="${MARK}"><!--<script>${MARK}</script>`;
/**
 * The content setters, then properties that are not: a reflected one, a hidden one, a URL-free string one, an expando,
 * and the three a form control's serializer writes (`value`, `checked`, `selected`), which on a script are refused too.
 */
const PROPS = ['textContent', 'innerHTML', 'innerText', 'text', 'outerHTML', 'outerText', 'type', 'nonce', 'integrity', 'config', 'value', 'checked', 'selected'];
const SIGILS = ['.', '!'];
/** The three script hosts: an HTML script, an HTML JSON data block, an SVG script (each its own template shape). */
const HOSTS = ['script', 'json', 'svg'];
/** One template per host, sigil and property, written with the binding as a template's static name. */
const written = (h, host, binding) => {
  const strings = host === 'script' ? [`<script ${binding}=`, '></script>'] : host === 'json' ? [`<script type="application/json" ${binding}=`, '></script>'] : [`<svg><script ${binding}=`, '></script></svg>'];
  return h(Object.assign([...strings], { raw: [...strings] }), VALUE);
};
const CELLS = HOSTS.flatMap((host) => SIGILS.flatMap((sigil) => PROPS.map((prop) => [host, sigil, prop])));
let seq = 0;
const tag = (name) => `t-script-property-${name}-${seq++}`;

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
const WORDS = /on a <script>, which takes no property binding \(its content is code\) — refused, a JSON data block's too\. Bind its attribute instead/;
/** One refusal said, with `code`, and nothing else; production says nothing at all. */
const saidOnly = (lines, code, label) => {
  if (isProduction) return assert.deepEqual(lines, [], `${label}: production says nothing`);
  assert.equal(lines.length, 1, `${label}: one line (${JSON.stringify(lines)})`);
  assert.ok(lines[0].startsWith('[vera] ') && lines[0].includes(`(${code})`), `${label}: ${lines[0]}`);
  if (code === 'script-property') assert.match(lines[0], WORDS, label);
};
/** The script is there, still the host's, holds nothing, and nothing of the value's exists. */
const clean = (root, label, prop) => {
  const script = root.querySelector('script');
  if (prop !== undefined) assert.notEqual(script?.[prop], VALUE, `${label}: the property holds nothing of the value's`);
  assert.ok(script, `CONTROL ${label}: the script was rendered`);
  assert.equal(script.textContent, '', `${label}: the script holds nothing`);
  assert.equal(root.querySelector('#pwn'), null, `${label}: nothing of the value's markup exists`);
  assert.equal(root.querySelectorAll('script').length, 1, `${label}: no script of the value's`);
  assert.ok(!root.innerHTML.includes(MARK), `${label}: the value appears nowhere (${root.innerHTML})`);
  return script;
};

test(`CONTROL: ${HOSTS.length} hosts × ${SIGILS.length} sigils × ${PROPS.length} properties`, () => {
  assert.equal(CELLS.length, 78);
});

test("core's renderer: a script's property binding is ignored, on every host, for both sigils", () => {
  let cells = 0;
  for (const [host, sigil, prop] of CELLS) {
    const label = `${host} ${sigil}${prop}`;
    const root = document.createElement('div');
    const lines = said(() => renderInto(written(core.html, host, sigil + prop), root));
    clean(root, label, prop);
    saidOnly(lines, 'script-property', label);
    cells++;
  }
  assert.equal(cells, 78);
});

test("CONTROL, core's renderer: content properties on a div and a style, and a JSON block's text hole, are written", () => {
  const root = document.createElement('div');
  const lines = said(() => renderInto(core.html`<div .textContent=${'a'}></div><style .textContent=${'p{}'}></style><b .innerHTML=${'<i>x</i>'}></b><script type="application/json">${'{"k":1}'}</script>`, root));
  assert.equal(root.querySelector('div').textContent, 'a');
  assert.equal(root.querySelector('style').textContent, 'p{}');
  assert.equal(root.querySelector('b i').textContent, 'x');
  assert.equal(root.querySelector('script').textContent, '{"k":1}');
  assert.deepEqual(lines, []);
  /** The attribute forms the refusal points to work on a script, on the client and the server alike. */
  const forms = document.createElement('div');
  const quiet = said(() => renderInto(core.html`<script type=${'module'} ?async=${true} nonce=${'n1'} integrity=${'sha384-x'}></script>`, forms));
  const script = forms.querySelector('script');
  assert.deepEqual([script.getAttribute('type'), script.hasAttribute('async'), script.getAttribute('nonce'), script.getAttribute('integrity')], ['module', true, 'n1', 'sha384-x']);
  assert.deepEqual(quiet, []);
});

test('spread: a property key on a script is ignored, on every host, for both sigils; the bag applies its other keys', () => {
  let cells = 0;
  for (const [host, sigil, prop] of CELLS) {
    const label = `spread ${host} ${sigil}${prop}`;
    const bag = { [sigil + prop]: VALUE, id: 's' };
    const draw = host === 'script' ? core.html`<script ${spread(bag)}></script>` : host === 'json' ? core.html`<script type="application/json" ${spread(bag)}></script>` : core.html`<svg><script ${spread(bag)}></script></svg>`;
    const root = document.createElement('div');
    const lines = said(() => renderInto(draw, root));
    assert.equal(clean(root, label, prop).id, 's', `CONTROL ${label}: the bag applied its other keys`);
    /** `.innerHTML`/`.outerHTML` keys are refused on every element before the element is known (`spread-inner-html`). */
    saidOnly(lines, prop === 'innerHTML' || prop === 'outerHTML' ? 'spread-inner-html' : 'script-property', label);
    cells++;
  }
  assert.equal(cells, 78);
  const root = document.createElement('div');
  said(() => renderInto(core.html`<script ${spread({ textContent: 'x' })}></script><div ${spread({ '.textContent': 'a' })}></div>`, root));
  assert.equal(root.querySelector('script').getAttribute('textcontent'), 'x', 'CONTROL: an attribute key (no sigil) is an attribute');
  assert.equal(root.querySelector('script').textContent, '');
  assert.equal(root.querySelector('div').textContent, 'a', 'CONTROL: a div takes its content key');
});

test("lite: a script's property binding is never written, on every host, for both sigils", () => {
  let cells = 0;
  for (const [host, sigil, prop] of CELLS) {
    const label = `lite ${host} ${sigil}${prop}`;
    const name = tag('lite');
    lite.define(name, () => () => written(lite.html, host, sigil + prop));
    let el;
    const lines = said(() => (el = document.body.appendChild(document.createElement(name))));
    clean(el, label, prop);
    saidOnly(lines, 'script-property', label);
    el.remove();
    cells++;
  }
  assert.equal(cells, 78);
  const name = tag('lite-ok');
  lite.define(name, () => () => lite.html`<div .textContent=${'a'}></div><script type="application/json">${'{"k":1}'}</script>`);
  const el = document.body.appendChild(document.createElement(name));
  assert.equal(el.querySelector('div').textContent, 'a', 'CONTROL: a div takes its content property');
  assert.equal(el.querySelector('script').textContent, '{"k":1}', "CONTROL: a JSON block's text hole");
  el.remove();
});

test("static: a script's property binding is never written (no `.`/`!` binding is), on every host", () => {
  let cells = 0;
  const all = [];
  for (const [host, sigil, prop] of CELLS) {
    const label = `static ${host} ${sigil}${prop}`;
    const Class = st.define(tag('static'), () => () => written(st.html, host, sigil + prop));
    const element = new Class();
    /** A throw names its cell: a render that fails is a red here, never an anonymous one. */
    try {
      all.push(...said(() => element.connectedCallback()));
    } catch (error) {
      assert.fail(`${label}: the render threw ${error?.name}: ${error?.message}`);
    }
    const script = clean(element, label, prop);
    assert.equal(script.attributes.length, host === 'json' ? 1 : 0, `${label}: the binding's attribute is gone`);
    cells++;
  }
  assert.equal(cells, 78);
  /** Gone as every binding static does not have is gone: development names each binding once (`static-needs-renderer`). */
  if (isProduction) assert.deepEqual(all, []);
  else {
    assert.equal(all.length, SIGILS.length * PROPS.length, JSON.stringify(all));
    for (const line of all) assert.ok(line.startsWith('[vera] static: ') && line.includes('(static-needs-renderer)'), line);
  }
});

/** `.src` (an SVG script's `.href`) is a URL a script runs from: its own reason, `script-source`, wins, in every place. */
test('a URL property on a script keeps its own reason (script-source), in the renderer, spread and lite', () => {
  const URL = 'https://elsewhere.example/x.js';
  const rows = [
    ['renderer .src', () => renderInto(core.html`<script .src=${URL}></script>`, document.createElement('div'))],
    ['renderer !src', () => renderInto(core.html`<script !src=${URL}></script>`, document.createElement('div'))],
    ['renderer SVG .href', () => renderInto(core.html`<svg><script .href=${URL}></script></svg>`, document.createElement('div'))],
    ['spread .src', () => renderInto(core.html`<script ${spread({ '.src': URL })}></script>`, document.createElement('div'))],
    ['spread SVG !href', () => renderInto(core.html`<svg><script ${spread({ '!href': URL })}></script></svg>`, document.createElement('div'))],
    ['lite .src', () => {
      const name = tag('lite-src');
      lite.define(name, () => () => lite.html`<script .src=${URL}></script>`);
      document.body.appendChild(document.createElement(name)).remove();
    }],
  ];
  for (const [label, run] of rows) saidOnly(said(run), 'script-source', label);
  assert.equal(rows.length, 6);
});

/** What a browser would run or build from the served page: parse5, scripting on, as the oracle. */
const JS = /^(?:|module|(?:application|text)\/(?:x-)?(?:java|ecma)script|text\/javascript1\.[0-5]|text\/(?:jscript|livescript))$/;
const finds = (page) => {
  const found = [];
  const walk = (node) => {
    for (const child of node.childNodes ?? []) {
      for (const a of child.attrs ?? []) if ((a.name === 'id' && a.value === 'pwn') || a.value.includes(MARK)) found.push(`attr ${a.name}`);
      if (child.nodeName === 'script') {
        const type = child.attrs.find((a) => a.name === 'type');
        const text = child.childNodes.map((n) => n.value ?? '').join('');
        if (text.includes(MARK)) found.push(`script type=${type?.value} ${JSON.stringify(text)}`);
        if (type === undefined || JS.test(type.value.trim().toLowerCase())) if (text.includes(MARK)) found.push('runs');
      }
      if (child.nodeName === '#comment' && child.data.includes(MARK)) found.push('comment');
      walk(child);
      if (child.content) walk(child.content);
    }
  };
  walk(parse(`<!doctype html><body>${page}`, { scriptingEnabled: true }));
  return found;
};

/** Last, and imported here: the server installs its own DOM globals over jsdom's. */
test('the server: a script property is never served, on every host, for both sigils; the client agrees', async () => {
  const { serializeTemplate } = await import('@verajs/ssr');
  assert.ok(finds(`<script>${MARK}</script>`).length > 0, 'CONTROL: the oracle finds a served script');
  assert.ok(finds(`<script type="application/json">${MARK}</script>`).length > 0, 'CONTROL: the oracle finds a served JSON block');
  assert.ok(finds(`<!--${MARK}-->`).length > 0, 'CONTROL: the oracle finds a comment');
  let cells = 0;
  const warned = [];
  for (const [host, sigil, prop] of CELLS) {
    const label = `server ${host} ${sigil}${prop}`;
    let page;
    warned.push(...said(() => (page = serializeTemplate(written(core.html, host, sigil + prop)))));
    assert.deepEqual(finds(page), [], `${label}: ${page}`);
    assert.ok(page.includes('<script') && page.includes('></script>'), `CONTROL ${label}: the empty script is served (${page})`);
    /** Hydration agreement: the client writes nothing there either (the renderer rows above), so the script is empty on both. */
    const served = parse(`<!doctype html><body>${page}`).childNodes[1].childNodes[1];
    const script = host === 'svg' ? served.childNodes[0].childNodes[0] : served.childNodes[0];
    assert.equal(script.nodeName, 'script', `CONTROL ${label}`);
    assert.deepEqual(script.childNodes, [], `${label}: served empty`);
    cells++;
  }
  assert.equal(cells, 78);
  /** Said once per binding, in every build (the server has one build), and never the value. */
  assert.equal(warned.length, SIGILS.length * PROPS.length, JSON.stringify(warned));
  for (const line of warned) {
    assert.ok(line.startsWith('[vera] ') && line.includes('(script-property)'), line);
    assert.match(line, WORDS, line);
    assert.ok(!line.includes(MARK), `the value is never printed: ${line}`);
  }
  for (const [label, draw] of [
    ['spread .textContent', (h) => h`<script ${spread({ '.textContent': VALUE })}></script>`],
    ['spread .innerHTML on a JSON block', (h) => h`<script type="application/json" ${spread({ '.innerHTML': VALUE })}></script>`],
    ['spread .text on an SVG script', (h) => h`<svg><script ${spread({ '.text': VALUE })}></script></svg>`],
  ]) {
    const page = serializeTemplate(draw(core.html));
    assert.deepEqual(finds(page), [], `${label}: ${page}`);
    assert.ok(page.includes('<script'), `CONTROL ${label}`);
  }
  assert.equal(serializeTemplate(core.html`<div .textContent=${'a'}></div>`), '<div>a</div>', 'CONTROL: a div serves its content property');
  const url = said(() => assert.equal(serializeTemplate(core.html`<script .src=${'https://elsewhere.example/x.js'}></script>`), '<script></script>', 'a URL property: never served'));
  assert.deepEqual(url, [], 'a URL property is the client\'s script-source: dropped silently here, as the attribute is');
  assert.equal(serializeTemplate(core.html`<script type=${'module'} ?async=${true} nonce=${'n1'}></script>`), '<script type="module" async="" nonce="n1"></script>', 'CONTROL: the attribute forms are served');
  assert.equal(serializeTemplate(core.html`<style .textContent=${'p{}'}></style>`), '<style>p{}</style>', 'CONTROL: a style serves its content property');
  assert.equal(serializeTemplate(core.html`<script type="application/json">${'{"k":1}'}</script>`), '<script type="application/json">{"k":1}</script>', "CONTROL: a JSON block's text hole");
});
