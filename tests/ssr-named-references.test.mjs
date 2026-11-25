/**
 * **Named character references, as the HTML tokenizer reads them.** A name `Object.prototype` holds is no reference
 * (2026-11-25): the lookup was a plain object, so `&constructor;` read back as a function's source text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { decode } = await import('../packages/ssr/dist/vera/parse.js');
await import('@verajs/ssr');

test("a name `Object.prototype` holds is no reference: it stays as written, in text and in an attribute value", () => {
  const names = '&constructor; &valueOf; &hasOwnProperty; &toString; &__proto__; &constructor';
  assert.equal(decode(names), names, 'decode read a prototype name as a reference');
  assert.equal(decode('&amp;'), '&', 'CONTROL: a real name still decodes');
  const host = document.createElement('div');
  host.innerHTML = `<p title="x${names}">${names}</p>`;
  assert.equal(host.firstChild.textContent, names, 'parsed text read a prototype name as a reference');
  assert.equal(host.firstChild.getAttribute('title'), `x${names}`, 'a parsed attribute read a prototype name as a reference');
});
