/**
 * **A numeric character reference decodes exactly as a parser decodes it — and never throws.** Three readers in this
 * package decoded references: the scheme check, the node-view parser and the `<select>` value match. Only the first
 * used the parser's rules; the other two called `String.fromCodePoint` directly, which THROWS past U+10FFFF, so
 * `&#1114112;` in trusted markup or in an `<option>` took the whole render down. They now share one decoder, which also
 * maps 0x80–0x9F through Windows-1252 as every parser does (`&#128;` is `€`). parse5 is the oracle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'parse5';
import { decode } from '../packages/ssr/dist/vera/parse.js';
import { serializeTemplate } from '@verajs/ssr';

const browser = (ref) => parse(`<p>${ref}</p>`).childNodes[0].childNodes[1].childNodes[0].childNodes[0]?.value ?? '';
const CODES = [0, 9, 65, 0x7f, ...Array.from({ length: 32 }, (_, i) => 0x80 + i), 0xa0, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xfffd, 0xffff, 0x10000, 0x1f600, 0x10ffff, 0x110000, 0x7fffffff];

test('every edge of the numeric reference range decodes as parse5 decodes it, decimal and hex', () => {
  for (const code of CODES)
    for (const ref of [`&#${code};`, `&#x${code.toString(16)};`]) assert.equal(decode(ref), browser(ref), ref);
  /** Past what a number holds: a parser still answers U+FFFD, and nothing throws. */
  assert.equal(decode('&#99999999999999999999;'), browser('&#99999999999999999999;'));
});

test('an out-of-range reference in an <option> no longer throws, and a C1 one selects the option the browser selects', () => {
  const template = (statics, ...values) => ({ ['_$litType$']: 1, strings: Object.assign([...statics], { raw: [...statics] }), values });
  assert.doesNotThrow(() => serializeTemplate(template(['<select .value=', '><option>&#1114112;</option></select>'], 'x')));
  const served = serializeTemplate(template(['<select .value=', '><option>a</option><option>&#128;</option></select>'], '€'));
  assert.match(served, /<option selected>&#128;<\/option>/, served);
});
