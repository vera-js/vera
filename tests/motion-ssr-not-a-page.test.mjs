/**
 * **`renderMotion` refuses a document that is not a page** (2026-11-27). It takes the rendered page as a full document
 * (jsdom's, over a render's output). The server DOM's global `document` is not that page — a render returns a string —
 * and its `head` only hoists styles; an XML document's `head` is null. The document sheet goes into `head`'s children,
 * so both threw `TypeError: … is not iterable` once a motion element was found. Now each is refused with a code, in
 * `problems`, as every other page-level problem is reported.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const { renderMotion } = await load('motion/ssr');
const MOTION = '<div data-vd-motion="{ keyframes: { opacity: \'0% 0, 100% 1\' } }">a</div>';
const codes = (report) => report.problems.map((problem) => problem.code);

/**
 * Each refusal names the guard, so a run without it reads as the TypeError it brings back rather than as a bare throw.
 */
const refused = (doc, what) => {
  let report;
  assert.doesNotThrow(() => (report = renderMotion(doc)), `${what}: without the entry guard this throws a TypeError`);
  assert.deepEqual(codes(report), ['motion-ssr-not-a-page'], `${what}: refused with its code`);
  assert.equal(report.rendered, 0, `${what}: nothing rendered`);
};

test('a full page still renders (the control: the guard refuses only what is not a page)', () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${MOTION}</body></html>`);
  const report = renderMotion(dom.window.document);
  assert.deepEqual(codes(report), []);
  assert.equal(report.rendered, 1);
  assert.equal(dom.window.document.head.querySelectorAll('style[data-vm-sheet]').length, 1, 'the document sheet is in <head>');
});

test('an XML document (no head) is refused with a code', () => {
  const xml = new JSDOM(`<r xmlns:h="http://www.w3.org/1999/xhtml"><h:div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' } }"/></r>`, { contentType: 'application/xml' }).window.document;
  assert.equal(xml.head, null, 'CONTROL: an XML document has no head');
  assert.equal(xml.querySelectorAll('[data-vd-motion]').length, 1, 'CONTROL: it holds a motion element');
  refused(xml, 'an XML document');
});

test("the server DOM's global document is refused with a code, with or without motion in its body", async () => {
  await import('@verajs/ssr');
  const doc = globalThis.document;
  refused(doc, "the server DOM's document, empty");
  const warn = console.warn;
  console.warn = () => {};
  try {
    doc.body.innerHTML = MOTION;
  } finally {
    console.warn = warn;
  }
  refused(doc, "the server DOM's document, a motion element in its body");
});
