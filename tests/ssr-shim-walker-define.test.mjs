/**
 * **Four shim surfaces, each against jsdom:** `createTreeWalker` (now the DOM standard's own algorithms), `define`'s
 * refusals, `getElementsByName`, and what `document.head.appendChild` hoists. The walker half is a seeded fuzz: the
 * same random trees, filters and step sequences on both, every answer compared — it used to climb above its root, give
 * up on a filtered sibling, and never prune a rejected subtree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extendSeeds } from './fuzz-seeds.mjs';

const jsdom = new JSDOM('<!doctype html><body></body>').window;
const { renderToString } = await import('@verajs/ssr');
void renderToString;
const shim = globalThis;

const lcg = (seed) => () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x80000000);
/** One tree, built the same way in either document, its nodes labeled so answers compare across the two. */
const build = (doc, random) => {
  let count = 0;
  const grow = (parent, depth) => {
    const kids = Math.floor(random() * 4);
    for (let k = 0; k < kids; k++) {
      const kind = random();
      const label = `n${count++}`;
      if (kind < 0.6 && depth < 4) {
        const el = doc.createElement('b');
        el.setAttribute('data-l', label);
        parent.appendChild(el);
        grow(el, depth + 1);
      } else if (kind < 0.85) parent.appendChild(doc.createTextNode(label));
      else parent.appendChild(doc.createComment(label));
    }
  };
  const root = doc.createElement('div');
  root.setAttribute('data-l', 'root');
  grow(root, 0);
  return root;
};
const labelOf = (node) => (node === null ? null : node.nodeType === 1 ? node.getAttribute('data-l') : node.data);
const STEPS = ['nextNode', 'previousNode', 'parentNode', 'firstChild', 'lastChild', 'nextSibling', 'previousSibling'];
const SHOWS = [0xffffffff, 0x1, 0x5, 0x80 | 0x1];

test('the tree walker answers every step exactly as jsdom does, over seeded trees and filters', () => {
  let compared = 0;
  for (const seed of extendSeeds([5, 23, 404, 9001, 77777])) {
    for (let n = 0; n < 60; n++) {
      const run = (doc) => {
        const random = lcg(seed * 1000 + n);
        const root = build(doc, random);
        const show = SHOWS[Math.floor(random() * SHOWS.length)];
        const verdicts = new Map();
        const filter = (node) => {
          const key = labelOf(node);
          if (!verdicts.has(key)) verdicts.set(key, 1 + Math.floor(random() * 3));
          return verdicts.get(key);
        };
        const walker = doc.createTreeWalker(root, show, random() < 0.2 ? null : filter);
        const out = [];
        for (let s = 0; s < 25; s++) {
          const step = STEPS[Math.floor(random() * STEPS.length)];
          out.push(`${step}:${labelOf(walker[step]())}@${labelOf(walker.currentNode)}`);
        }
        return out;
      };
      assert.deepEqual(run(shim.document), run(jsdom.document), `seed ${seed} case ${n}`);
      compared++;
    }
  }
  assert.ok(compared >= 300);
});

test('controls: the walker finds nodes at all, and stays inside its root', () => {
  const doc = shim.document;
  const outside = doc.createElement('section');
  const root = doc.createElement('div');
  root.appendChild(doc.createElement('b'));
  outside.appendChild(root);
  const walker = doc.createTreeWalker(root);
  assert.equal(walker.nextNode()?.localName, 'b');
  assert.equal(walker.parentNode()?.localName, 'div');
  assert.equal(walker.parentNode(), null, 'never above its root');
});

test('define refuses a non-constructor and a class already defined, as the platform does', () => {
  for (const win of [jsdom, shim]) {
    const outcome = (fn) => {
      try {
        fn();
        return 'accepted';
      } catch (error) {
        return error.name;
      }
    };
    class Once extends win.HTMLElement {}
    win.customElements.define(`once-${win === jsdom ? 'j' : 's'}`, Once);
    assert.equal(outcome(() => win.customElements.define(`twice-${win === jsdom ? 'j' : 's'}`, Once)), 'NotSupportedError');
    assert.equal(outcome(() => win.customElements.define(`arrow-${win === jsdom ? 'j' : 's'}`, () => {})), 'TypeError');
  }
});

test('getElementsByName compares the name exactly, backslashes and quotes included', () => {
  for (const win of [jsdom, shim]) {
    const doc = win.document;
    for (const name of ['a\\b', 'q"u', 'plain']) {
      const input = doc.createElement('input');
      input.setAttribute('name', name);
      doc.body.appendChild(input);
    }
    const count = (name) => doc.getElementsByName(name).length;
    assert.deepEqual([count('a\\b'), count('q"u'), count('plain'), count('nope')], [1, 1, 1, 0], win === jsdom ? 'jsdom' : 'shim');
  }
});

test('document.head.appendChild hoists a <style>, never a <script>', async () => {
  const { renderToString: render } = await import('@verajs/ssr');
  const { styles } = await render(new URL('./fixtures/ssr/head-append-ssr.js', import.meta.url), {});
  assert.ok(styles.includes('.from-head'), styles);
  assert.ok(!styles.includes('alert('), styles);
});
