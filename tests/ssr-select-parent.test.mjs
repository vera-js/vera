/**
 * **A selector's combinators walk ELEMENT parents only** — `parentElement`, never `parentNode`. The SSR shim's `>` and
 * descendant combinators walked onto a shadow root or fragment above an element and tested it as one: `* > i`
 * matched a shadow root's top-level child (the root passed `*`), and `.a b` / `.a > p` THREW reading an element
 * property off the root. jsdom is the oracle here — selector matching is not something it emulates loosely — and
 * the controls hold that ordinary trees still match exactly as before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const jsdomDocument = new JSDOM('<!doctype html><body></body>').window.document;
await import('@verajs/ssr');
const shimDocument = globalThis.document;

const build = (doc) => {
  const host = doc.createElement('div');
  host.className = 'a';
  const root = host.attachShadow({ mode: 'open' });
  const p = doc.createElement('p');
  p.className = 'p';
  const b = doc.createElement('b');
  p.appendChild(b);
  root.appendChild(p);
  const top = doc.createElement('i');
  root.appendChild(top);
  /** An ordinary light tree beside it — the controls. */
  const light = doc.createElement('section');
  light.className = 'x';
  const inner = doc.createElement('div');
  const leaf = doc.createElement('b');
  inner.appendChild(leaf);
  light.appendChild(inner);
  light.appendChild(doc.createElement('b'));
  doc.body.appendChild(host);
  doc.body.appendChild(light);
  const frag = doc.createDocumentFragment();
  frag.appendChild(doc.createElement('em'));
  return { root, p, b, top, light, leaf, frag };
};
const answers = (doc) => {
  const n = build(doc);
  const q = (fn) => {
    try {
      return fn();
    } catch (error) {
      return `THROWS ${error.constructor.name}`;
    }
  };
  return {
    'shadow root: * > i': q(() => n.root.querySelectorAll('* > i').length),
    'shadow root: .a b': q(() => n.root.querySelectorAll('.a b').length),
    'shadow root: .a > p': q(() => n.root.querySelectorAll('.a > p').length),
    'top-level child matches * > i': q(() => n.top.matches('* > i')),
    'fragment: * > em': q(() => n.frag.querySelectorAll('* > em').length),
    'shadow root: p > b': q(() => n.root.querySelectorAll('p > b').length),
    'closest across the root': q(() => n.b.closest('.a')?.localName ?? null),
    'control: .x > b': q(() => n.light.parentNode.querySelectorAll('.x > b').length),
    'control: .x b': q(() => n.light.parentNode.querySelectorAll('.x b').length),
    'control: section div > b': q(() => n.leaf.matches('section div > b')),
  };
};

test('combinators stop at the first parent that is not an element, exactly as the browser does', () => {
  const expected = answers(jsdomDocument);
  /** The controls must find something, or a matcher that finds nothing would pass every row. */
  assert.equal(expected['control: .x > b'], 1);
  assert.equal(expected['control: .x b'], 2);
  assert.equal(expected['control: section div > b'], true);
  assert.equal(expected['shadow root: p > b'], 1);
  assert.deepEqual(answers(shimDocument), expected);
});
