/**
 * **`thrownMessage` exists twice on purpose, and this test is its second address.** The client packages share the one
 * in `@verajs/shared-utils` (inlined into each bundle); `@verajs/ssr` is compiled per file with no bundling, so it
 * cannot import that private, unpublished package at run time and keeps its own in `escaping.ts`. One table of thrown
 * values runs against both, so a fix to one that misses the other turns this red. Each must describe any thrown value
 * and never throw itself — a value from author code that crashed the error path replaced the real failure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thrownMessage as shared } from '@verajs/shared-utils';
import { thrownMessage as server } from '../packages/ssr/dist/vera/escaping.js';

const trap = () => {
  throw new Error('trap');
};
const ROWS = [
  [null, 'null'],
  [undefined, 'undefined'],
  ['plain', 'plain'],
  [42, '42'],
  [Symbol('s'), 'Symbol(s)'],
  [new Error('m'), 'm'],
  [new TypeError('typed'), 'typed'],
  [{ message: 'shaped' }, 'shaped'],
  [Object.create(null), '[unprintable value thrown]'],
  [{ toString: trap }, '[unprintable value thrown]'],
  [{ get message() { return trap(); } }, '[unprintable value thrown]'],
  [new Proxy({}, { get: trap, getPrototypeOf: trap }), '[unprintable value thrown]'],
  [(() => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; })(), '[unprintable value thrown]'],
];

for (const [label, thrownMessage] of [['@verajs/shared-utils', shared], ['@verajs/ssr', server]])
  test(`${label}: every thrown value is described, and the formatter never throws`, () => {
    for (const [value, expected] of ROWS) assert.equal(thrownMessage(value), expected);
  });
