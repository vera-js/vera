/**
 * **Every insertion path places nodes the same way** (`_place` in nodes.ts). `appendChild` alone knew that a fragment
 * hands over its children and is left empty; `insertBefore`, `replaceChild` — and `before`/`replaceWith`, which route
 * through them — inserted a fragment as its markup, so the children never arrived and the fragment still had them.
 * None of them noticed markup text arriving after the container was parsed. And `toggleAttribute` told
 * `attributeChangedCallback` the old value AFTER deleting it. jsdom is the reference.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const jsdom = new JSDOM('<!doctype html><body></body>').window;
const { renderToString } = await import('@verajs/ssr');

const answers = (doc) => {
  const label = (n) => (n.nodeType === 1 ? `${n.localName}${n.id ? `#${n.id}` : ''}` : `"${n.data}"`);
  const fragment = () => {
    const f = doc.createDocumentFragment();
    const i = doc.createElement('i');
    i.id = 'f';
    f.append(i, doc.createTextNode('t'));
    return f;
  };
  const parent = () => {
    const p = doc.createElement('div');
    for (const id of ['x', 'y']) {
      const b = doc.createElement('b');
      b.id = id;
      p.append(b);
    }
    return p;
  };
  const out = {};
  for (const op of ['insertBefore', 'replaceChild', 'before', 'after', 'replaceWith', 'prepend', 'append', 'appendChild']) {
    const p = parent();
    const f = fragment();
    const y = p.lastChild;
    if (op === 'insertBefore') p.insertBefore(f, y);
    else if (op === 'replaceChild') p.replaceChild(f, y);
    else if (op === 'prepend' || op === 'append' || op === 'appendChild') p[op](f);
    else y[op](f);
    out[op] = `${[...p.childNodes].map(label)} | fragment keeps ${f.childNodes.length} | finds ${p.querySelectorAll('#f').length}`;
  }
  return out;
};

test('a fragment hands over its children and is left empty, through every insertion path', () => {
  const expected = answers(jsdom.document);
  assert.match(expected.insertBefore, /i#f/, 'the reference itself must show the fragment arriving');
  assert.deepEqual(answers(globalThis.document), expected);
});

test('markup that arrives after a container was parsed is seen by the next query', () => {
  const doc = globalThis.document;
  const host = doc.createElement('div');
  host.innerHTML = '<b id="first"></b>';
  assert.equal(host.querySelectorAll('b').length, 1, 'parsed once');
  const later = doc.createDocumentFragment();
  later.innerHTML = '<b id="second"></b>';
  host.insertBefore(later, host.firstChild);
  assert.deepEqual([...host.querySelectorAll('b')].map((b) => b.id), ['second', 'first']);
});

test('toggleAttribute tells attributeChangedCallback the value it had', async () => {
  const seen = [];
  class Probe extends jsdom.HTMLElement {
    static observedAttributes = ['hidden'];
    attributeChangedCallback(name, old, value) {
      seen.push(`${old}->${value}`);
    }
  }
  jsdom.customElements.define('toggle-probe', Probe);
  const el = jsdom.document.createElement('toggle-probe');
  jsdom.document.body.append(el);
  el.setAttribute('hidden', 'was');
  el.toggleAttribute('hidden');
  el.toggleAttribute('hidden');
  assert.deepEqual(seen, ['null->was', 'was->null', 'null->']);
  globalThis.__toggleSeen = [];
  await renderToString(new URL('./fixtures/ssr/toggle-attribute-ssr.js', import.meta.url), {});
  assert.deepEqual(globalThis.__toggleSeen, seen);
});
