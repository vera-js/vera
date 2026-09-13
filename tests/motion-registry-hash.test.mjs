/**
 * The server half of the hash contract.
 *
 * `contentHash` exists for one property: the server and the client independently derive the SAME
 * name from the same generated text, or SSR markup carries animation names the client never
 * defines. This file pins the Node side of that agreement against a literal;
 * `tests/browser/motion-registry.test.js` pins the browser side against the SAME literal on the
 * SAME fixture string. Neither may change without the other, which is the point.
 *
 * jsdom-free on purpose — the hash must not depend on anything an environment provides.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from './dist.mjs';

const { keyframeRegistry } = await load('directives/motion');

/** Byte-identical to the browser suite's fixture. */
const CSS = '@keyframes vm-probe { 0% { opacity: 0 } 100% { opacity: 1 } }';

test('the content hash is the same number the browser derives', () => {
  assert.equal(keyframeRegistry.contentHash(CSS), '1ykmer807ltjw9',
    'the SSR contract: server-rendered names must be re-derivable client-side, byte for byte');
});

test('the hash is pure string math — no environment in it', () => {
  /** Same input twice, and inputs differing by one byte diverge: the two properties eviction
   *  and dedup rest on. A hash that collided trivially would merge two animations silently. */
  assert.equal(keyframeRegistry.contentHash(CSS), keyframeRegistry.contentHash(CSS));
  assert.notEqual(keyframeRegistry.contentHash(CSS), keyframeRegistry.contentHash(CSS + ' '));
});

/**
 * The cross-repo half: the shared vector file both engines pin their column of.
 *
 * `docs/motion-spec/fixtures/hash-vectors.json` carries every vector in two widths. As of
 * 2026-09-13 BOTH engines compute `fnv1a64` — vera's rule name widened from 32 bits to 64 so that
 * two distinct animations cannot derive one name, and the cheapest way to carry 64 bits was to stop
 * spending its characters on hex. So the FUNCTION column is now shared and this asserts the same
 * one omni's conformance suite does; only the ENCODING differs (they spell the 64 bits as 16 hex,
 * we as two 7-character base36 halves), and the engines never share generated rules, so the names
 * were already distinct by ratified decision.
 *
 * The `fnv1a32` column is kept as history rather than deleted — it is what this engine shipped
 * before the widening, and a vector file is the one place that record costs nothing.
 *
 * **The name is DECODED here rather than asked for in hex, and that is deliberate twice over.**
 * A `contentHashHex` existed for exactly this assertion and shipped in `vera-motion.min.js` and
 * `vera-motion-client.min.js` — verification-only code in every user's bundle. Decoding also tests
 * strictly more: a hex twin shares the hash function but bypasses the ENCODING, so a bug that spelled
 * the 64 bits wrongly would pass here while every generated name was wrong. This route fails on
 * either.
 */

/** `contentHash` writes the LOW 32 bits first, then the high — seven base36 digits each, because
 *  36^7 > 2^32 > 36^6. */
const decodeToHex = (name) => {
  assert.equal(name.length, 14, `a rule name is fourteen base36 characters, got '${name}'`);
  const half = (text) => {
    const value = Number.parseInt(text, 36);
    assert.ok(Number.isFinite(value), `'${text}' is not base36`);
    return value.toString(16).padStart(8, '0');
  };
  return half(name.slice(7)) + half(name.slice(0, 7));
};

test('every fnv1a64 vector in the shared spec fixture matches the shipping hash', async () => {
  const { readFile } = await import('node:fs/promises');
  const { vectors } = JSON.parse(
    await readFile(new URL('../docs/motion-spec/fixtures/hash-vectors.json', import.meta.url), 'utf8'));
  assert.ok(vectors.length >= 6, 'the CONTROL: the fixture actually loaded and holds the corpus');
  for (const { text, fnv1a64 } of vectors) {
    assert.equal(decodeToHex(keyframeRegistry.contentHash(text)), fnv1a64, JSON.stringify(text));
  }
});

/**
 * The control for the decoder above: it must be capable of DISAGREEING. A decode that silently
 * returned the same string for every input would satisfy the whole corpus if the corpus were ever
 * reduced to one row, and would certify a broken encoder.
 */
test('the decoder distinguishes names', () => {
  assert.notEqual(decodeToHex(keyframeRegistry.contentHash('a')), decodeToHex(keyframeRegistry.contentHash('b')));
  assert.equal(decodeToHex('0'.repeat(14)), '0'.repeat(16), 'the all-zero name decodes to zero');
});
