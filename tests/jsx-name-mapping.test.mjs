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
/** Stated HERE as the spec, deliberately not imported from the implementation — a test that
 *  reads the map it verifies out of the code under test pins nothing. */
const NAME_MAP = { className: 'class', htmlFor: 'for' };
const BOOLEAN_ATTRIBUTES = new Set([
  'disabled', 'hidden', 'readonly', 'required', 'open', 'selected', 'multiple',
  'autofocus', 'autoplay', 'controls', 'loop', 'muted', 'playsinline', 'inert', 'reversed',
]);
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
  for (const name of ['id', 'title', 'data-x', 'aria-label', '@click', '.someProp', '?custom'])
    assert.equal(jsxName(name), name, name);
});

/**
 * **`ref` is a BINDING, and the table had no row for it.** Passed through, it reached the attribute
 * sink and `<H ref={r}>` wrote the function's own source text into the DOM as
 * `ref="el => (got = el)"` — under SSR, the closure body shipped to the client — while the
 * identical `<h1 ref={r}>` bound correctly. `@verajs/renderer/spread` has understood `&name` refs
 * all along; nothing named the mapping.
 */
test('ref names the spread ref binding, not an attribute', () => {
  assert.equal(jsxName('ref'), '&ref');
});

/**
 * `onClick` is the one React name `jsxName` may leave alone, and it is worth saying WHY rather than
 * recording the output: `spread` is a THIRD home for that rule and converts `on`+capital to an
 * event binding itself. This test asserted the passthrough for years with no note, which read as
 * coverage of a mapping that does not exist here — and `ref`, which looked identical from the
 * table's point of view, was broken the whole time.
 */
test('onClick passes through because spread, not this table, is its home', async () => {
  assert.equal(jsxName('onClick'), 'onClick');
  const { spread } = await load('renderer/spread');
  assert.equal(typeof spread, 'function', 'the home this test is deferring to must exist');
});

/**
 * THE OTHER HOME. Until 2026-09-12 this suite drove only `jsxName` — the runtime — against a table
 * written in this file, so the COMPILER, which is the half that had drifted, was never executed by
 * the pin meant to keep the two together. A pin that tests one of two homes certifies the drift.
 */
test('the compiler emits, for a written element, what the runtime answers for a component', async () => {
  const { transformJsx } = await load('jsx');
  /** The emitted attribute name for `<div NAME={x}>`, read back out of the template. */
  const compiled = (name) => {
    const out = transformJsx(`const t = <div ${name}={x}/>;`, 'p.jsx', { inject: false });
    return /<div\s+([^=]*)=/.exec(out)?.[1] ?? out;
  };
  for (const [from, to] of Object.entries(NAME_MAP)) assert.equal(compiled(from), to, `compiler: ${from}`);
  for (const name of BOOLEAN_ATTRIBUTES) assert.equal(compiled(name), `?${name}`, `compiler: ${name}`);
  assert.equal(compiled('value'), '.value');
  assert.equal(compiled('checked'), '.checked');
  assert.equal(compiled('defaultValue'), 'value');
  assert.equal(compiled('defaultChecked'), '?checked');
  assert.equal(compiled('onClick'), '@click', 'the compiler DOES map events — spread is the runtime half');
});
