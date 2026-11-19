/**
 * **`svg` and `mathml` templates in `@verajs/lite`** (2026-11-18): lite parses an `svg` or `mathml` template inside its
 * root element, as core's renderer does, and keeps everything the parser made (an HTML element written in foreign
 * content breaks out, and stays). Both builds. Three things are held here:
 *
 * 1. **Parity with core**, per ELEMENT: one component source rendered by lite and by core (its renderer wired) gives the
 *    same elements in the same order, each with the same tag, NAMESPACE and attributes, and the same text — first render
 *    and after an update. Comparing markup would not do: `innerHTML` serializes an SVG `<circle>` and an HTML one alike.
 * 2. **Update in place**: a re-render writes into the nodes the first render made.
 * 3. **wrong-namespace** (development): content placed where its namespace does not render is named, as core's renderer
 *    names it (one shared check, `packages/shared-utils/src/namespaces.ts`), and nowhere the content is correct.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';
import { SOURCES, signature } from './fixtures/lite-namespace-sources.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];

const lite = await load('lite');
const core = await load('core');
const { renderer } = await load('renderer');
core.wire([renderer]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const SVG = 'http://www.w3.org/2000/svg';
const MATHML = 'http://www.w3.org/1998/Math/MathML';
const XHTML = 'http://www.w3.org/1999/xhtml';


/** A host per renderer, rendered with `v`, after both renderers have flushed. */
const pair = async (name, source, v, round = 'ns') => {
  const options = (prefix) => ({ tag: `${prefix}-${round}-${Object.keys(SOURCES).indexOf(name)}`, props: { v } });
  lite.define(options('t'), source(lite));
  core.define(options('p'), source(core));
  const t = document.body.appendChild(document.createElement(options('t').tag));
  const p = document.body.appendChild(document.createElement(options('p').tag));
  core.flush();
  await settle();
  return [t, p];
};

const { warn } = console;
const said = [];

for (const [name, source] of Object.entries(SOURCES))
  test(`svg/mathml parity: ${name} — the same elements, namespaces, attributes and text as core, first render and after an update`, async () => {
    console.warn = (line) => said.push(String(line));
    try {
      const [t, p] = await pair(name, source, 'a');
      const [first, theirs] = [signature(t), signature(p)];
      assert.ok(theirs.rows.length > 0, `CONTROL: core rendered elements (${p.innerHTML})`);
      assert.ok(theirs.rows.some((row) => !row.startsWith(XHTML)), `CONTROL: core's render holds a foreign element (${theirs.rows.join('; ')})`);
      assert.deepEqual(first, theirs);
      /** The update: every element the first render made is still there, in place, and the values moved. */
      const before = [...t.querySelectorAll('*')];
      t.v = p.v = 'b';
      core.flush();
      await settle();
      assert.deepEqual(signature(t), signature(p));
      assert.notDeepEqual(signature(t), first, 'CONTROL: the update changed what is shown');
      const after = [...t.querySelectorAll('*')];
      assert.deepEqual(after, before, 'the same nodes: updated in place, not rebuilt');
      t.remove();
      p.remove();
    } finally {
      console.warn = warn;
    }
  });

test('svg/mathml parity: the corpus made foreign elements of each namespace, and an HTML breakout', async () => {
  const seen = new Set();
  for (const [name, source] of Object.entries(SOURCES)) {
    const [t, p] = await pair(name, source, 'a', 'all');
    for (const row of signature(t).rows) seen.add(row.split(' ')[0]);
    if (name === 'html breaking out of svg content') assert.equal(t.querySelector('section > div')?.namespaceURI, XHTML, 'the <div> broke out, and was kept');
    t.remove();
    p.remove();
  }
  assert.deepEqual([...seen].sort(), [MATHML, SVG, XHTML].sort());
});

/**
 * **A template given to an SVG `<title>` is refused in lite** (`template-in-text`, 2026-11-18). Lite holds `title`,
 * `textarea` and `style` as text in any namespace (Brian, 2026-11-17), and a template in a text-only element is refused
 * on every tier, as the server refuses it in HTML's (`ssr-template-in-text`); it showed the template's text before.
 * Core's renderer places the elements, as the server does for SVG's (an integration point): lite refuses what core
 * renders — the tier rule (render what core renders, or refuse with its code). A row of its own.
 */
test('an svg <title> given a template is refused in lite, coded (core places the elements)', async () => {
  const source = ({ html, svg }) => () => () => html`<svg>${svg`<title>${html`<b>bold</b> x`}</title>`}</svg>`;
  lite.define('t-ns-title', source(lite));
  core.define('p-ns-title', source(core));
  let error;
  const listener = (event) => {
    error = event.error;
    event.preventDefault();
  };
  dom.window.addEventListener('error', listener);
  const t = document.body.appendChild(document.createElement('t-ns-title'));
  dom.window.removeEventListener('error', listener);
  const p = document.body.appendChild(document.createElement('p-ns-title'));
  core.flush();
  await settle();
  assert.equal(p.querySelector('title')?.querySelector('b')?.textContent, 'bold', 'CONTROL: core placed the <b>');
  assert.match(String(error?.message), /(?:\(|\/e\/)template-in-text\)?$/, 'lite refused, coded');
  assert.equal(t.querySelector('b'), null, 'nothing placed in lite');
  t.remove();
  p.remove();
});

/** Lite's tags and core's, through ONE call site: the same kind, the strings array itself, the values (`html`'s row is lite.test.mjs's). */
test(`lite's svg and mathml give core's template result: kind, the strings array itself, the values`, () => {
  for (const [kind, name] of [[2, 'svg'], [3, 'mathml']]) {
    const draw = (tag) => tag`<g class=${'a'}>${2}</g>`;
    const [ours, theirs] = [draw(lite[name]), draw(core[name])];
    assert.equal(ours._$litType$, kind, `lite: ${name} is kind ${kind}`);
    assert.equal(theirs._$litType$, kind, `core: ${name} is kind ${kind}`);
    assert.equal(ours.strings, theirs.strings);
    assert.deepEqual(ours.values, ['a', 2]);
    assert.deepEqual(Object.keys(ours).sort(), Object.keys(theirs).sort());
    if (!isProduction) {
      const refused = (tag) => { try { tag('<g/>'); } catch (error) { return error.message; } };
      assert.match(refused(lite[name]), /\(tag-called\)$/, `lite refuses a string given to ${name}, coded`);
      assert.equal(refused(lite[name]), refused(core[name]), 'in the same words');
    }
  }
});

/**
 * **The cache key is the strings array, as core's** — recorded, not changed: one call site rendered through two different
 * tags (a `draw(tag)` helper) is prepared ONCE, by the first kind it met, in both renderers. Never written that way in
 * practice; if it changes in one, it changes in both.
 */
test('one call site through two tags keeps the first kind it was prepared as, in lite as in core', async () => {
  const draw = (tag) => tag`<circle/>`;
  const source = ({ html, svg }) => () => () => html`<svg>${draw(svg)}</svg><svg>${draw(html)}</svg>`;
  lite.define('t-ns-key', source(lite));
  core.define('p-ns-key', source(core));
  const t = document.body.appendChild(document.createElement('t-ns-key'));
  const p = document.body.appendChild(document.createElement('p-ns-key'));
  core.flush();
  await settle();
  const kinds = (root) => [...root.querySelectorAll('circle')].map((c) => c.namespaceURI);
  assert.deepEqual(kinds(p), [SVG, SVG], 'CONTROL: core prepares the call site once, as svg');
  assert.deepEqual(kinds(t), kinds(p));
  t.remove();
  p.remove();
});

/**
 * **wrong-namespace, in lite** (development only): the same check core's renderer makes, at each insert — a single value
 * and a list's batch alike. Each case renders `inner` into `outer`; `code` is whether it must be said.
 */
const WRONG = [
  { name: 'an html <circle> into an <svg>', make: ({ html }) => html`<svg>${html`<circle/>`}</svg>`, says: '<circle> was built as HTML and placed inside <svg>' },
  { name: 'a list of html <rect>s into a <g>', make: ({ html }) => html`<svg><g>${[1, 2].map(() => html`<rect/>`)}</g></svg>`, says: '<rect> was built as HTML and placed inside <g>' },
  { name: 'an html <mi> into <math>', make: ({ html }) => html`<math>${html`<mi>x</mi>`}</math>`, says: '<mi> was built as HTML and placed inside <math>' },
  { name: 'an svg root straight into <math>', make: ({ html, svg }) => html`<math>${svg`<svg></svg>`}</math>`, says: '<svg> was built as SVG and placed inside <math>' },
];
const RIGHT = [
  { name: 'svg content into an <svg>', make: ({ html, svg }) => html`<svg>${svg`<circle/>`}</svg>` },
  { name: 'html into <foreignObject>', make: ({ html }) => html`<svg><foreignObject>${html`<p>x</p>`}</foreignObject></svg>` },
  { name: 'html into an svg <desc> and <title>', make: ({ html }) => html`<svg><desc>${html`<b>d</b>`}</desc></svg>` },
  { name: 'html into a MathML token element', make: ({ html }) => html`<math><mtext>${html`<b>x</b>`}</mtext></math>` },
  { name: 'html into an html-encoded annotation-xml', make: ({ html }) => html`<math><annotation-xml encoding="text/html">${html`<p>x</p>`}</annotation-xml></math>` },
  { name: 'an html <style> into an <svg>', make: ({ html }) => html`<svg>${html`<style>.a{}</style>`}</svg>` },
  { name: 'html into html', make: ({ html }) => html`<div>${html`<p>x</p>`}</div>` },
];

const capture = async (make, tag) => {
  const lines = [];
  console.warn = (line) => lines.push(String(line));
  try {
    lite.define(tag, () => () => make(lite));
    document.body.appendChild(document.createElement(tag)).remove();
    await settle();
  } finally {
    console.warn = warn;
  }
  return lines.filter((line) => line.includes('(wrong-namespace)'));
};

for (const [i, c] of WRONG.entries())
  test(`wrong-namespace in lite: ${c.name} is said${isProduction ? ' (production: by its code alone)' : ''}`, async () => {
    const lines = await capture(c.make, `t-wrong-${i}`);
    if (isProduction) return assert.deepEqual(lines, [], 'production: development-only, never said');
    assert.equal(lines.length, 1, lines.join('\n'));
    assert.match(lines[0], /^\[vera\] lite: /);
    assert.ok(lines[0].includes(c.says), lines[0]);
  });

for (const [i, c] of RIGHT.entries())
  test(`wrong-namespace in lite: ${c.name} is silent`, async () => {
    const lines = await capture(c.make, `t-right-${i}`);
    assert.deepEqual(lines, []);
  });

test(`wrong-namespace: lite says it in core's words, but for how to fix it`, { skip: isProduction && 'development-only' }, async () => {
  const make = ({ html }) => html`<svg><g>${html`<line/>`}</g></svg>`;
  const [ours] = await capture(make, 't-wrong-words');
  const lines = [];
  console.warn = (line) => lines.push(String(line));
  try {
    core.define('p-wrong-words', () => () => make(core));
    document.body.appendChild(document.createElement('p-wrong-words')).remove();
    core.flush();
    await settle();
  } finally {
    console.warn = warn;
  }
  const [theirs] = lines.filter((line) => line.includes('(wrong-namespace)'));
  assert.ok(ours && theirs, `CONTROL: both said it (${ours} / ${theirs})`);
  const strip = (line) => line.replace(/^\[vera\] \w+: /, '').replace(/ \(lite parses a template by its tag alone\)| — or wire @verajs\/renderer\/namespaces[^.]*\. A template built before it was wired keeps the namespace it was first built in/, '');
  assert.equal(strip(ours), strip(theirs));
  assert.ok(theirs.includes('@verajs/renderer/namespaces') && !ours.includes('@verajs/renderer/namespaces'), 'lite does not point at a module it cannot wire');
});
