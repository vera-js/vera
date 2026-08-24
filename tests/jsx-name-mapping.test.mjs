/**
 * The JSX name table exists twice, and the two must agree.
 *
 * `@verajs/jsx` maps React's names when it compiles a written element — `className` to `class`,
 * `value` to `.value`, a bound boolean to `?attr`. `@verajs/renderer/tag` has to apply the same
 * mapping at runtime, because a tag used in JSX arrives as a *component call* and the compiler
 * passes component props through raw.
 *
 * They are deliberately not shared through a package: one is build-time and one is runtime, and the
 * dependency edge would cost more than the duplication. This is the drift protection instead — and
 * it is not cosmetic. Passed through unmapped, `disabled={false}` becomes the attribute
 * `disabled="false"`, which disables the control, and `className` lands as `classname`.
 *
 * Tests BUILT artifacts, development AND production (see ./dist.mjs).
 */
import { load } from './dist.mjs';
import { NAME_MAP, BOOLEAN_ATTRIBUTES } from '../packages/jsx/src/transform.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { jsxName, BOOLEAN_ATTRIBUTES: runtimeBooleans } = await load('renderer/tag');

test('every name the compiler rewrites, the runtime rewrites the same way', () => {
  for (const [from, to] of Object.entries(NAME_MAP)) {
    assert.equal(jsxName(from), to, `${from} must map to ${to}`);
  }
});

test('the boolean attribute lists are identical', () => {
  assert.deepEqual(
    [...runtimeBooleans].sort(),
    [...BOOLEAN_ATTRIBUTES].sort(),
    'a boolean the compiler knows and the runtime does not becomes a plain attribute, and any ' +
      'value at all — `false` included — then applies it'
  );
  for (const name of BOOLEAN_ATTRIBUTES) assert.equal(jsxName(name), `?${name}`, name);
});

test('the controlled-input names map to properties, and the default* names to markup', () => {
  assert.equal(jsxName('value'), '.value');
  assert.equal(jsxName('checked'), '.checked');
  assert.equal(jsxName('defaultValue'), 'value');
  assert.equal(jsxName('defaultChecked'), '?checked');
});

test('anything else passes through untouched', () => {
  for (const name of ['id', 'title', 'data-x', 'aria-label', 'onClick', '@click', '.someProp', '?custom'])
    assert.equal(jsxName(name), name, name);
});
