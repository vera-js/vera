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
const CSS = '@keyframes vd-probe { 0% { opacity: 0 } 100% { opacity: 1 } }';

test('the content hash is the same number the browser derives', () => {
  assert.equal(keyframeRegistry.contentHash(CSS), 'fd6bc413',
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
 * `docs/motion-spec/fixtures/hash-vectors.json` carries every vector in two widths — `fnv1a64`
 * (omni's, asserted by its conformance suite) and `fnv1a32` (ours, asserted here). The widths
 * never have to agree with each other — that divergence is recorded in the spec — but each
 * column must keep agreeing with its implementation, and a fixture nobody executes is the drift
 * this repo's docs-recipes rule exists to prevent.
 */
test('every fnv1a32 vector in the shared spec fixture matches the shipping hash', async () => {
  const { readFile } = await import('node:fs/promises');
  const { vectors } = JSON.parse(
    await readFile(new URL('../docs/motion-spec/fixtures/hash-vectors.json', import.meta.url), 'utf8'));
  assert.ok(vectors.length >= 6, 'the CONTROL: the fixture actually loaded and holds the corpus');
  for (const { text, fnv1a32 } of vectors) {
    assert.equal(keyframeRegistry.contentHash(text), fnv1a32, JSON.stringify(text));
  }
});
