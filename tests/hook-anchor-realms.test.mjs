/**
 * **anchor hears the scrollers of every shadow root up the target's chain, whichever realm made the root**
 * (CODE-PRINCIPLES #2). A root is told by its structure (node type 11 with a `host`), not by `instanceof` the target
 * window's `ShadowRoot`: a host built in another window (an iframe, a second jsdom) and adopted keeps that window's
 * prototype, and the class test skipped its root, so a scroller inside it moved the target and left the layer behind.
 * jsdom has no layout; the rows read which roots `open()` listens to.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
const other = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver'])
  globalThis[key] = dom.window[key];
const { anchor } = await load('vera-hooks/anchor');
const { document } = dom.window;

/** A host whose open root holds `target`, made in `doc`, then placed in this document; the root records its listeners. */
const hostedIn = (doc) => {
  const host = doc.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const target = doc.createElement('button');
  root.append(target);
  const heard = [];
  const add = root.addEventListener;
  root.addEventListener = function (type, ...rest) {
    heard.push(type);
    return add.call(this, type, ...rest);
  };
  document.body.append(doc === document ? host : document.adoptNode(host));
  return { host, root, target, heard };
};

const listened = (doc) => {
  const { host, root, target, heard } = hostedIn(doc);
  const layer = document.createElement('div');
  document.body.append(layer);
  const { warn } = console;
  console.warn = () => {};
  const placed = anchor(layer, target);
  try {
    placed.open();
  } finally {
    console.warn = warn;
  }
  placed.close();
  host.remove();
  layer.remove();
  return { root, heard };
};

test("a shadow root of the target's own window is listened to (CONTROL: the spy sees the listener)", () => {
  const { heard } = listened(document);
  assert.deepEqual(heard, ['scroll']);
});

test('a shadow root made in another window and adopted is listened to as well', () => {
  const { root, heard } = listened(other.window.document);
  assert.equal(root instanceof dom.window.ShadowRoot, false, "CONTROL: the adopted root kept the other window's prototype");
  assert.equal(root.ownerDocument, document, 'CONTROL: and it is in this document');
  assert.deepEqual(heard, ['scroll']);
});
