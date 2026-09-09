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
