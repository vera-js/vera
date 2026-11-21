/**
 * **<vera-input>'s pure decisions, read from source: when clear shows, when Escape clears, what a default input copies
 * from the host, and which development warnings fire.** No DOM: each row hands values in and reads the answer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { clearShown, escapeClears, COPIED, copiedFrom, warnings } = await import(
  '../packages/components/input/src/input/decide.ts'
);

const at = (over = {}) => ({ value: 'hello', disabled: false, readOnly: false, expanded: null, ...over });

test('clear shows for a value the user may clear, and for nothing else', () => {
  assert.equal(clearShown(at()), true, 'a value on an editable input');
  assert.equal(clearShown(at({ value: '' })), false, 'an empty input');
  assert.equal(clearShown(at({ disabled: true })), false, 'a disabled input (a fieldset[disabled] included)');
  assert.equal(clearShown(at({ readOnly: true })), false, 'a read-only input');
  assert.equal(clearShown(at({ expanded: 'true' })), false, "a composite's open list owns clearing");
  assert.equal(clearShown(at({ expanded: 'false' })), true, 'a closed list does not');
  assert.equal(clearShown(at({ value: ' ' })), true, 'a space is a value');
});

test('Escape clears only a search input that clear would show on', () => {
  assert.equal(escapeClears('search', at()), true);
  assert.equal(escapeClears('SEARCH', at()), true, 'type is read case-insensitively, as the platform does');
  assert.equal(escapeClears('text', at()), false, 'a text input keeps Escape');
  assert.equal(escapeClears('search', at({ value: '' })), false, 'nothing to clear');
  assert.equal(escapeClears('search', at({ expanded: 'true' })), false, 'an open list keeps Escape for closing');
});

test('a default input copies only the listed host attributes, in a fixed order, values as written', () => {
  assert.deepEqual([...COPIED], ['name', 'type', 'value', 'placeholder', 'autocomplete']);
  const host = { autocomplete: 'email', name: 'q', onclick: 'x()', style: 'color:red', value: '"><img src=x onerror=1>' };
  const read = (name) => (Object.hasOwn(host, name) ? host[name] : null);
  assert.deepEqual(copiedFrom(read), [
    ['name', 'q'],
    ['value', '"><img src=x onerror=1>'],
    ['autocomplete', 'email'],
  ]);
  assert.deepEqual(copiedFrom(() => null), [], 'a bare host copies nothing');
  assert.deepEqual(copiedFrom((name) => (name === 'value' ? '' : null)), [['value', '']], 'an empty value is present');
});

test('each development warning fires for its cause, and none on a well-made input', () => {
  const ok = { named: true, reveal: false, type: 'text', sizeOnHost: false };
  assert.deepEqual(warnings(ok), []);
  assert.deepEqual(warnings({ ...ok, named: false }), ['input-no-name']);
  assert.deepEqual(warnings({ ...ok, reveal: true }), ['input-reveal-not-password']);
  assert.deepEqual(warnings({ ...ok, reveal: true, type: 'PASSWORD' }), [], 'reveal on a password input is the use');
  assert.deepEqual(warnings({ ...ok, sizeOnHost: true }), ['input-size-on-host']);
  assert.deepEqual(warnings({ named: false, reveal: true, type: 'text', sizeOnHost: true }), [
    'input-no-name',
    'input-reveal-not-password',
    'input-size-on-host',
  ]);
});
