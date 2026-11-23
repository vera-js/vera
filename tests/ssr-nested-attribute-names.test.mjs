/**
 * **A nested component is rebuilt from the open tag this package wrote, so the rebuild's grammar
 * must accept every name the writer can emit.**
 *
 * `index.js` re-parses that open tag to reconstruct the child instance. It kept its own attribute
 * grammar with a `[\w:-]+` name charset, narrower than what a start tag may carry — and a narrower
 * charset does not REJECT a name it cannot spell, it MIS-PARSES it: `data-a.b="v"` came back as
 * `data-a=""` plus `b="v"`, so the child was rebuilt with attributes nobody wrote and read `null`
 * for the one that was. Server-side only, silently (arc-2 run 2).
 *
 * Every name here is one real engines accept — the repo's conventions record that `a(b)`, `a|b`
 * and `a?b` are all valid and that only `a b`, `a>b`, `a=b` and `a/b` are refused. The grammar now
 * comes from `parse.js`, which owns it; this is the test that keeps the two spellings one fact.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { renderToString } from '@verajs/ssr';

const dir = new URL('./fixtures/ssr/generated-attr-names/', import.meta.url);
mkdirSync(dir, { recursive: true });

const NAMES = ['data-a.b', 'data-a(b)', 'data-a|b', 'data-a?b', 'data-plain', 'data-a:b', 'data-a-b'];

test('every attribute name an engine accepts survives the nested-component rebuild', async () => {
  for (const [i, name] of NAMES.entries()) {
    const child = new URL(`child-${i}.js`, dir);
    const parent = new URL(`parent-${i}.js`, dir);
    writeFileSync(child, `
import { init, html } from '@verajs/core';
customElements.define('attr-child-${i}', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html\`<i>\${this.getAttribute(${JSON.stringify(name)}) ?? 'MISSING'}</i>\`); }
});
`);
    writeFileSync(parent, `
import { init, html } from '@verajs/core';
import './child-${i}.js';
export default class P extends HTMLElement {
  connectedCallback() { init(this, () => () => html\`<div><attr-child-${i} ${name}="VALUE"></attr-child-${i}></div>\`); }
}
customElements.define('attr-parent-${i}', P);
`);
    const { html: markup } = await renderToString(parent);
    assert.ok(markup.includes('>VALUE<'), `${name}: the child read its own attribute (got ${markup})`);
    assert.ok(!markup.includes('MISSING'), `${name}: the child saw the attribute at all`);
    assert.ok(markup.includes(`${name}="VALUE"`), `${name}: the name reached the markup unsplit`);
  }
});

/**
 * **Whitespace around `=` is part of the grammar** (2026-11-23): `<x title = "a b">` is the one attribute `title` with
 * the value `a b` to every parser. The rebuild allowed none, so the child got `title=""`, `a=""` and `b=""`.
 */
const SPACED = [
  ['title = "a b"', 'a b'],
  ["title= 'a b'", 'a b'],
  ['title =ab', 'ab'],
  ['title\t=\n"a b"', 'a b'],
  ['title="a b"', 'a b'],
];

test('an attribute with whitespace around = reaches the nested component as one attribute', async () => {
  for (const [i, [written, value]] of SPACED.entries()) {
    const child = new URL(`spaced-child-${i}.js`, dir);
    const parent = new URL(`spaced-parent-${i}.js`, dir);
    writeFileSync(child, `
import { init, html } from '@verajs/core';
customElements.define('spaced-child-${i}', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html\`<i>\${this.getAttributeNames().join(',')}=\${this.getAttribute('title')}</i>\`); }
});
`);
    writeFileSync(parent, `
import { init, html } from '@verajs/core';
import './spaced-child-${i}.js';
export default class P extends HTMLElement {
  connectedCallback() { init(this, () => () => html\`<div><spaced-child-${i} ${written}></spaced-child-${i}></div>\`); }
}
customElements.define('spaced-parent-${i}', P);
`);
    const { html: markup } = await renderToString(parent);
    assert.ok(markup.includes(`<i>title=${value}</i>`), `${JSON.stringify(written)}: the child holds title alone (got ${markup})`);
  }
});

/**
 * **The fast regex reads what the full one reads wherever it is asked** — on open-tag text with no whitespace beside an
 * `=` — and the full one is asked for everything else. Run on the shapes an open tag takes; the control is that the
 * two regexes differ at all, so the comparison is not of one regex with itself.
 */
test('the tight attribute regex answers as the full grammar on text with no whitespace beside =', async () => {
  const { ATTRIBUTE, ATTRIBUTE_TIGHT, spacedEquals } = await import('../packages/ssr/dist/vera/scan.js');
  assert.notEqual(ATTRIBUTE_TIGHT.source, ATTRIBUTE.source, 'CONTROL: two regexes');
  /** Every capture, `undefined` kept apart from `''`, so a value moving between captures shows. */
  const read = (re, text) => [...text.matchAll(re)].map((m) => JSON.stringify(m.slice(1)));
  const SHAPES = [
    'title="a b"', "title='a b'", 'title=ab', 'hidden', 'a b c', 'data-a.b="v" x=1 y', 'a="x = y"', "t='=' u", 'a= ',
    'label="Row 1" data-k=3 open', 'a="1"b="2"', 'v=a=b', 'a"b c<d=1 =e', 'x=""', "y=''", 'z=', '  lead  trail  ',
  ];
  let tight = 0;
  for (const text of SHAPES) {
    if (spacedEquals(text)) continue;
    tight++;
    assert.deepEqual(read(ATTRIBUTE_TIGHT, text), read(ATTRIBUTE, text), text);
  }
  assert.ok(tight >= 12, `CONTROL: the fast regex was compared on ${tight} shapes`);
  assert.ok(spacedEquals('title = "a b"') && spacedEquals('a="x = y"') && spacedEquals('a\n=b') && spacedEquals('a=\tb'), 'CONTROL: spaced shapes take the full grammar');
});

/**
 * **A quote, `<` or a leading `=` belongs to the name** (2026-11-23): HTML's tokenizer ends a name only at whitespace,
 * `/`, `>` or a later `=`, so Chromium, Firefox, WebKit and parse5 read `<x a"b="v">` as the one attribute `a"b`. The
 * shared grammar stopped names at those characters, and the rebuild, which steps over what it cannot match, gave the
 * child `a=""` plus a `b="v"` nobody wrote. A name led by `=` is the gap between the parser, which keeps it (a
 * client-built child holds `=title`), and `setAttribute`, which refuses it and is the rebuild's only way in: the rebuild
 * skips it, so neither the server's child nor the served tag carries it — and nothing after it is read as a name.
 */
const ODD = [
  ['x"title="v"', ['x"title']],
  ["x'title='v'", ["x'title"]],
  ['x<title="v"', ['x<title']],
  ['=title="v"', []],
  ['a="x"=y', ['a']],
  ['a"b c<d', ['a"b', 'c<d']],
];

test('a name with a quote, < or a leading = reaches the nested component whole, with no attribute added', async () => {
  const { JSDOM } = await import('jsdom');
  const real = new JSDOM('<!doctype html><body></body>').window.document;
  for (const [i, [written, names]] of ODD.entries()) {
    const holder = real.createElement('div');
    holder.innerHTML = `<odd-kid ${written}></odd-kid>`;
    const parsed = holder.firstChild.getAttributeNames();
    assert.ok(parsed.length > 0, `CONTROL: the parser read ${written}`);
    assert.deepEqual(parsed.filter((n) => n[0] !== '='), names, `the row states the parser's names for ${written}`);
    const child = new URL(`odd-child-${i}.js`, dir);
    const parent = new URL(`odd-parent-${i}.js`, dir);
    writeFileSync(child, `
import { init, html } from '@verajs/core';
customElements.define('odd-child-${i}', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html\`<i>[\${this.getAttributeNames().join('|')}]</i>\`); }
});
`);
    writeFileSync(parent, `
import { init, html } from '@verajs/core';
import './odd-child-${i}.js';
export default class P extends HTMLElement {
  connectedCallback() { init(this, () => () => html\`<div><odd-child-${i} ${written}></odd-child-${i}></div>\`); }
}
customElements.define('odd-parent-${i}', P);
`);
    const { html: markup } = await renderToString(parent);
    const served = real.createElement('div');
    served.innerHTML = markup;
    assert.equal(served.querySelector('i')?.textContent, `[${names.join('|')}]`, `${written}: the child's names (${markup})`);
    assert.deepEqual(served.querySelector(`odd-child-${i}`)?.getAttributeNames(), names, `${written}: served as the child holds it (${markup})`);
    assert.ok(!parsed.includes('title'), 'CONTROL: no row has a title of its own to serve');
  }
});

test('assigned markup reads a name with a quote or < whole, as the parser does', async () => {
  const { JSDOM } = await import('jsdom');
  const real = new JSDOM('<!doctype html><body></body>').window.document;
  for (const markup of ['<p x"title="v">t</p>', '<p x<title="v">t</p>', '<p a"b c<d=1>t</p>']) {
    const names = (doc) => {
      const host = doc.createElement('div');
      host.innerHTML = markup;
      const p = host.querySelector('p');
      return p && [p.getAttributeNames(), p.getAttribute('title'), host.innerHTML];
    };
    const theirs = names(real);
    assert.ok(theirs && theirs[0].length > 0, `CONTROL: the parser read ${markup}`);
    assert.deepEqual(names(globalThis.document)?.slice(0, 2), theirs.slice(0, 2), markup);
  }
  /** A name led by `=` is declined, never a throw from `setAttribute`: the bytes stay as assigned. */
  const host = globalThis.document.createElement('div');
  host.innerHTML = '<p =title="v">t</p>';
  assert.doesNotThrow(() => host.querySelector('p'), 'a leading = declines');
  assert.equal(host.innerHTML, '<p =title="v">t</p>');
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
