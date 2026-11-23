/**
 * **A `<template>`'s markup is its content, never its children**, on the server as in the engines (2026-11-23). The
 * server DOM kept a parsed template's interior as its CHILDREN and had no `content`: `template.children.length` was 1
 * where engines give 0, `template.querySelector('p')` found what no engine finds, and `template.content.cloneNode(true)`
 * — how a component stamps a template — threw. Each row runs the same code against jsdom and the server DOM and
 * compares the answers (the instrument CLAUDE.md names for the shim; jsdom and the engines agree on template content).
 * CONTROL rows: an ordinary element's children, and a query that never reaches a template, read the same before and after.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/** Captured before the shim installs its globals. */
const real = new JSDOM('<!doctype html><body></body>').window.document;
await import('@verajs/ssr');
const shim = globalThis.document;

const PARSED = "const d = doc.createElement('div'); d.innerHTML = '<template id=\"t\" class=\"k\"><p class=\"x\">a</p><!--c--><b>c</b></template><i>z</i>'; const t = d.firstChild;";
const ROWS = [
  ['CONTROL: an ordinary element keeps its children', "const d = doc.createElement('div'); d.innerHTML = '<section><p>a</p></section>'; return d.firstChild.children.length + ' ' + d.querySelectorAll('p').length;"],
  ['CONTROL: a query beside a template', `${PARSED} return d.querySelectorAll('i').length + ' ' + d.children.length;`],
  ['children and childNodes are empty', `${PARSED} return t.children.length + ' ' + t.childNodes.length + ' ' + String(t.firstChild);`],
  ['content holds the parsed markup', `${PARSED} return t.content.nodeType + ' ' + t.content.childNodes.length + ' ' + t.content.children.length + ' ' + t.content.firstChild.className;`],
  ['a query on the template finds nothing inside it', `${PARSED} return String(t.querySelector('p')) + ' ' + t.querySelectorAll('*').length;`],
  ['a query from above finds nothing inside it', `${PARSED} return d.querySelectorAll('p').length + ' ' + d.querySelectorAll('*').length;`],
  ['a query on the content finds it', `${PARSED} return t.content.querySelector('b').textContent + ' ' + t.content.querySelectorAll('*').length;`],
  ['textContent is empty', `${PARSED} return JSON.stringify(t.textContent);`],
  ['innerHTML and outerHTML serialize the content', `${PARSED} return t.innerHTML + ' | ' + t.outerHTML;`],
  ['the parent round-trips', `${PARSED} return d.innerHTML;`],
  ['a deep clone copies the content', `${PARSED} const c = t.cloneNode(true); return c.childNodes.length + ' ' + c.content.childNodes.length + ' ' + c.outerHTML;`],
  ['a shallow clone has empty content', `${PARSED} const c = t.cloneNode(false); return c.content.childNodes.length + ' ' + c.outerHTML;`],
  ['content.cloneNode(true) stamps it', `${PARSED} const f = t.content.cloneNode(true); d.appendChild(f); return f.childNodes.length + ' ' + d.querySelectorAll('p').length + ' ' + t.content.childNodes.length + ' ' + d.innerHTML;`],
  ['a shallow content clone is empty', `${PARSED} return t.content.cloneNode(false).childNodes.length + ' ' + t.content.cloneNode().nodeType;`],
  ['innerHTML set writes the content', "const t = doc.createElement('template'); t.innerHTML = '<p>q</p><p>r</p>'; return t.childNodes.length + ' ' + t.content.childNodes.length + ' ' + t.outerHTML;"],
  ['a node appended to the template is its child, not serialized', "const t = doc.createElement('template'); t.innerHTML = '<p>q</p>'; t.appendChild(doc.createElement('span')); return t.childNodes.length + ' ' + t.content.childNodes.length + ' ' + JSON.stringify(t.innerHTML) + ' ' + t.outerHTML;"],
  ['a node appended to the content is serialized', "const t = doc.createElement('template'); t.content.appendChild(doc.createElement('em')); return t.childNodes.length + ' ' + t.outerHTML;"],
  ['a nested template has its own content', "const d = doc.createElement('div'); d.innerHTML = '<template><template><p>n</p></template><b>o</b></template>'; const inner = d.firstChild.content.firstChild; return inner.localName + ' ' + inner.childNodes.length + ' ' + inner.content.childNodes.length + ' ' + d.innerHTML;"],
  ['created content is a fragment', "const t = doc.createElement('template'); return t.content.nodeType + ' ' + t.content.childNodes.length + ' ' + t.outerHTML;"],
];

test('a template answers as jsdom does, row by row', () => {
  /** A floor on the corpus: a row list that lost its rows would pass with nothing compared. */
  assert.equal(ROWS.length, 19);
  const diffs = [];
  for (const [label, body] of ROWS) {
    const run = (doc) => {
      try { return String(new Function('doc', body)(doc)); } catch (error) { return `THREW ${error?.name}: ${error?.message}`; }
    };
    const want = run(real);
    const got = run(shim);
    if (want.startsWith('THREW')) diffs.push(`${label}: jsdom threw (${want})`);
    else if (got !== want) diffs.push(`${label}\n  jsdom:  ${want}\n  server: ${got}`);
  }
  assert.deepEqual(diffs, []);
});

/**
 * **Declarative shadow DOM markup assigned with `innerHTML`, against an ENGINE.** jsdom is never the oracle for a served
 * shadow root (it parses one as a `<template>` everywhere), so these values are Chromium 159's, measured 2026-11-23
 * (Playwright 1.65): fragment parsing keeps the `<template shadowrootmode>` as the host's child, its markup as `content`,
 * and attaches nothing (the document parser and `setHTMLUnsafe` attach it; the server DOM has neither). The plain
 * template is the control: the same in every engine and every parse.
 */
test('a declarative shadow root assigned with innerHTML stays a template with content, as in Chromium', () => {
  const read = (markup) => {
    const root = shim.createElement('div');
    root.innerHTML = markup;
    const h = root.firstChild;
    const t = [...h.childNodes].find((n) => n.localName === 'template') ?? null;
    return JSON.stringify({
      shadowRoot: h.shadowRoot ? h.shadowRoot.innerHTML : null,
      hostChildren: [...h.children].map((c) => c.localName).join(','),
      template: t ? { children: t.children.length, content: t.content ? t.content.childNodes.length : 'none', mode: t.shadowRootMode ?? 'none' } : null,
      hostFindsP: !!h.querySelector('p'),
      rootPs: root.querySelectorAll('p').length,
      html: root.innerHTML,
    });
  };
  assert.equal(
    read('<div id="h"><template shadowrootmode="open"><p class="in">x</p><slot></slot></template><i>light</i></div>'),
    '{"shadowRoot":null,"hostChildren":"template,i","template":{"children":0,"content":2,"mode":"open"},"hostFindsP":false,"rootPs":0,"html":"<div id=\\"h\\"><template shadowrootmode=\\"open\\"><p class=\\"in\\">x</p><slot></slot></template><i>light</i></div>"}',
  );
  assert.equal(
    read('<div id="h"><template><p class="in">x</p></template><i>light</i></div>'),
    '{"shadowRoot":null,"hostChildren":"template,i","template":{"children":0,"content":1,"mode":""},"hostFindsP":false,"rootPs":0,"html":"<div id=\\"h\\"><template><p class=\\"in\\">x</p></template><i>light</i></div>"}',
  );
  assert.equal(typeof shim.createElement('div').setHTMLUnsafe, 'undefined');
});
