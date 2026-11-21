/**
 * **An HTML element is HTML whichever window made it** (CODE-PRINCIPLES #2). `parseMotion` refuses an element it cannot
 * measure (`motion-not-html`: an SVG or MathML element has no `offsetTop`), and it decided that with `instanceof`: first
 * against the module global's `HTMLElement`, which refused every element of a second document, then against the class of
 * the node's own window, which still refused one ADOPTED from another window (adoption moves `ownerDocument` and keeps the
 * prototype). It reads the namespace now. A second JSDOM is a second realm; each row checks its node really is foreign.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver',
  'CSSStyleSheet', 'getComputedStyle']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { parseMotion } = await load('motion/internal');
const other = new JSDOM('<!doctype html><body></body>').window.document;
const SVG = 'http://www.w3.org/2000/svg';

/** The refusal codes `parseMotion` gave this node, `[]` when it parsed. */
const refusals = (node) => {
  const dropped = [];
  const parsed = parseMotion(node, `{ keyframes: { opacity: '0, 1' } }`, { dropped });
  const codes = dropped.flatMap((d) => d.rejected ?? []).map((r) => r.code);
  if (parsed === null && codes.length === 0) throw new Error('CONTROL: parsed nothing and reported nothing');
  return codes;
};

test('CONTROL: this window — an HTML element parses, an SVG element is refused as not HTML', () => {
  assert.deepEqual(refusals(document.createElement('div')), []);
  assert.deepEqual(refusals(document.createElementNS(SVG, 'rect')), ['motion-not-html'], 'the reason the check exists');
});

test('an HTML element of another window parses, in its own document (emit-anywhere) and adopted into this one', () => {
  const own = other.createElement('div');
  other.body.append(own);
  assert.equal(own instanceof dom.window.HTMLElement, false, 'CONTROL: the element really is from another realm');
  assert.deepEqual(refusals(own), [], 'in its own document');
  const adopted = other.createElement('div');
  document.body.append(adopted);
  assert.equal(adopted.ownerDocument === document && !(adopted instanceof dom.window.HTMLElement), true, "CONTROL: adopted: this document, the other realm's prototype");
  assert.deepEqual(refusals(adopted), [], 'adopted into this document');
  adopted.remove();
});

test('an SVG element of another window is still refused, adopted or not', () => {
  const rect = other.createElementNS(SVG, 'rect');
  assert.deepEqual(refusals(rect), ['motion-not-html'], 'in its own document');
  document.body.append(rect);
  assert.deepEqual(refusals(rect), ['motion-not-html'], 'adopted into this document');
  rect.remove();
});

test('a document with no window (createHTMLDocument): its SVG element is refused too, its HTML element parses', () => {
  /** The old guard skipped the check when the node's document had no window, so an SVG element there went on to NaN. */
  const bare = document.implementation.createHTMLDocument('');
  assert.equal(bare.defaultView, null, 'CONTROL: the document really has no window');
  assert.deepEqual(refusals(bare.createElementNS(SVG, 'rect')), ['motion-not-html']);
  assert.deepEqual(refusals(bare.createElement('div')), []);
});
