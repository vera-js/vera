/**
 * **HTML folds case by ASCII only, and so does the server.** The tokenizer, `createElement`, attribute names, `tagName`,
 * enumerated values and a selector's `i` flag all fold A–Z and nothing else. `toLowerCase` folds far more: the Kelvin
 * sign (U+212A) becomes `k`, so a name the browser keeps apart from `key` collapsed into it; `İ` (U+0130) becomes two
 * code units, so an index found in the lowered copy pointed past the real one, and a raw-text element's end tag was
 * looked for in the wrong place; and `toUpperCase` turns `ß` into `SS`. Every row runs the same code on the shim and on
 * jsdom (which folds ASCII only, as the engines do) and compares the answers; the serializer rows parse the server's
 * output with jsdom and compare what the client would hold.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/** Captured before the shim installs its globals. */
const real = new JSDOM('<!doctype html><body></body>').window.document;
const { serializeTemplate } = await import('@verajs/ssr');
const { html } = await import('@verajs/core');
const shim = globalThis.document;

/** [name, body]: `el` is a fresh `<div>`, `d` its document; the body returns a string. */
const OPS = [
  ['createElement keeps a Kelvin sign', "return d.createElement('x-\\u212A').localName === 'x-\\u212A' ? 'kept' : 'folded';"],
  ['createElement keeps a dotted capital I', "return String(d.createElement('x-\\u0130').localName.length);"],
  /** Astral: a Deseret capital (U+10400) lowercases to U+10428 under toLowerCase; its two surrogates must count as non-ASCII. */
  ['createElement keeps an astral capital', "return d.createElement('x-\\u{10400}').localName === 'x-\\u{10400}' ? 'kept' : 'folded';"],
  ['tagName keeps an astral small letter', "return d.createElement('x-\\u{10428}').tagName === 'X-\\u{10428}' ? 'kept' : 'folded';"],
  ['tagName uppercases ASCII only', "return d.createElement('x-\\u00DF').tagName;"],
  ['setAttribute keeps a Kelvin sign apart from k', "el.setAttribute('\\u212Aey', '1'); return String(el.getAttribute('key')) + '|' + el.getAttributeNames().length;"],
  ['getNamedItem keeps a Kelvin sign apart from k', "el.setAttribute('key', '1'); return String(el.attributes.getNamedItem('\\u212Aey') === null);"],
  ['getElementsByTagName keeps a Kelvin sign apart from k', "el.append(d.createElement('x-k')); return String(el.getElementsByTagName('X-\\u212A').length);"],
  ['an i selector keeps a Kelvin sign apart from k', "el.innerHTML = '<p x=\"\\u212A\"></p><p x=\"K\"></p>'; return String(el.querySelectorAll('[x=\"k\" i]').length);"],
  ['a parsed tag name keeps a Kelvin sign', "el.innerHTML = '<x-\\u212A></x-\\u212A>'; return String(el.firstChild.localName === 'x-\\u212A');"],
  ['a parsed attribute name keeps a Kelvin sign', "el.innerHTML = '<p \\u212Aey=1></p>'; return String(el.firstChild.getAttribute('key'));"],
  ['a textarea after a dotted capital I ends at its own end tag', "el.innerHTML = '<textarea>\\u0130\\u0130</textarea><b>x</b>'; return el.firstChild.value.length + '|' + el.querySelectorAll('b').length;"],
  ['a style after a dotted capital I ends at its own end tag', "el.innerHTML = '<style>\\u0130\\u0130</style><b>x</b>'; return el.firstChild.textContent.length + '|' + el.querySelectorAll('b').length;"],
  ['a raw-text end tag needs its name to end', "el.innerHTML = '<textarea>a</textareax>b</textarea><b>x</b>'; return el.firstChild.value + '|' + el.querySelectorAll('b').length;"],
];

const run = (doc, body) => {
  const el = doc.createElement('div');
  try {
    return String(new Function('el', 'd', body)(el, doc));
  } catch (error) {
    return 'THREW ' + error.name;
  }
};

test('the shim folds case as the engines do', () => {
  const differ = [];
  for (const [name, body] of OPS) {
    const ours = run(shim, body);
    const theirs = run(real, body);
    if (ours !== theirs) differ.push(`${name}: shim ${JSON.stringify(ours)}, engines ${JSON.stringify(theirs)}`);
  }
  assert.deepEqual(differ, []);
});

/** What the browser holds after parsing the server's markup. */
const parsed = (markup) => {
  const host = real.createElement('div');
  host.innerHTML = markup;
  return host;
};

test('a textarea value after a dotted capital I replaces the authored content, and the page after it stays', () => {
  const draw = (value) => html`<textarea .value=${value}>İİold</textarea><b>after</b>`;
  const host = parsed(serializeTemplate(draw('v')));
  assert.equal(host.querySelector('textarea').value, 'v');
  assert.equal(host.querySelectorAll('b').length, 1);
});
