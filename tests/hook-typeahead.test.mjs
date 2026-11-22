/**
 * **@vera-hooks/typeahead, pure** (`createTypeahead`): a letter jumps to the next enabled row with that prefix,
 * starting after the current one; the same letter again cycles its matches; a real prefix narrows in place; disabled
 * rows are passed over; the buffer goes cold half a second after its last character; and `warm` says when Space is a
 * character. The caller's clock is passed in, so no row waits. Runs against both builds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

const { createTypeahead } = await load('vera-hooks/typeahead');
const ROWS = [{ label: 'Apple' }, { label: 'Cherry' }, { label: 'cheese', disabled: true }, { label: 'Chestnut' }, { label: 'Coconut' }];

test('a letter jumps to the next enabled row with that prefix, starting after the current row (CONTROL: no match is -1)', () => {
  const t = createTypeahead();
  assert.equal(t.type('c', 0, ROWS, 0), 1, 'from Apple, c lands on Cherry');
  assert.equal(createTypeahead().type('z', 0, ROWS, 0), -1, 'CONTROL: nothing starts with z');
});

test('the same letter again cycles its matches, passing over a disabled row, and wraps', () => {
  const t = createTypeahead();
  let at = t.type('c', 0, ROWS, 0);
  assert.equal(at, 1, 'Cherry');
  at = t.type('c', 100, ROWS, at);
  assert.equal(at, 3, 'Chestnut: the disabled cheese is passed over');
  at = t.type('c', 200, ROWS, at);
  assert.equal(at, 4, 'Coconut');
  at = t.type('c', 300, ROWS, at);
  assert.equal(at, 1, 'wraps to Cherry');
});

test('a real prefix narrows in place: typing "ches" from Cherry lands on Chestnut, case-insensitively', () => {
  const t = createTypeahead();
  let at = t.type('C', 0, ROWS, 0);
  for (const [i, character] of [...'hes'].entries()) at = t.type(character, 100 * (i + 1), ROWS, at);
  assert.equal(at, 3);
});

test('the buffer goes cold 500 ms after its last character, and warm says so (CONTROL: warm before)', () => {
  const t = createTypeahead();
  t.type('c', 0, ROWS, 0);
  assert.equal(t.warm(499), true, 'CONTROL: warm within the window, so Space is a character');
  assert.equal(t.warm(500), false, 'cold at 500 ms');
  assert.equal(t.type('a', 600, ROWS, 1), 0, 'a fresh buffer: "a" finds Apple, not "ca"');
});
