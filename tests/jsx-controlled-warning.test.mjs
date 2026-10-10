/**
 * **A controlled form control nothing keeps in step is said at compile time** (Brian, 2026-10-07, with the change that
 * made JSX `value`/`checked` controlled). `<input value={x}>` with no input handler and no `readOnly` now has its typed
 * text written back by every render, as React's does; React warns at runtime, this compiler warns once, with the file
 * and position, at no runtime cost. It lives in `transformJsx` (vera-5a) so every path sees it — the Vite plugin
 * reports it through Vite, the standalone loader prints it in development (pinned in tests/browser/buildless-loader).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProduction, load } from './dist.mjs';

/** Through dist.mjs — the artifact under test (development, production, or the node build), never a bare resolve. */
const { transformJsx, veraJsx } = await load('jsx');

const warnings = (source) => {
  const said = [];
  transformJsx(source, 'app.tsx', { inject: false, onWarning: (message) => said.push(message) });
  return said;
};

for (const [label, source] of [
  ['an input with a bound value', 'const a = (s) => <input value={s.v} />;'],
  ['a text-typed input', 'const a = (s) => <input type="email" value={s.v} />;'],
  ['a textarea', 'const a = (s) => <textarea value={s.v} />;'],
  ['a select', 'const a = (s) => <select value={s.v}><option value="1">1</option></select>;'],
  ['a checkbox\'s checked', 'const a = (s) => <input type="checkbox" checked={s.on} />;'],
  ['a literal value', 'const a = () => <input value="fixed" />;'],
])
  test(`warns: ${label} with nothing keeping it in step`, () => {
    const said = warnings(source);
    assert.equal(said.length, 1, said.join(' | '));
    if (isProduction) return assert.match(said[0], /^app\.tsx:1:\d+ — https:\/\/verajs\.dev\/e\/jsx-uncontrolled$/);
    assert.match(said[0], /^app\.tsx:1:\d+ — (value|checked)=\{…\} makes this <(input|textarea|select)> controlled/);
    assert.match(said[0], /onInput\/onChange/);
    assert.match(said[0], /default(Value|Checked)/);
  });

test('the position is the attribute\'s: line and column', () => {
  const [said] = warnings('const a = (s) => (\n  <form>\n    <input value={s.v} />\n  </form>\n);');
  assert.match(said, /^app\.tsx:3:12 — /);
});

for (const [label, source] of [
  ['onInput', 'const a = (s) => <input value={s.v} onInput={(e) => (s.v = e.target.value)} />;'],
  ['onChange', 'const a = (s) => <input type="checkbox" checked={s.on} onChange={() => (s.on = !s.on)} />;'],
  ['readOnly', 'const a = (s) => <input value={s.v} readOnly />;'],
  ['defaultValue (uncontrolled)', 'const a = (s) => <input defaultValue={s.v} />;'],
  ['a spread, which may carry the handler', 'const a = (s, p) => <input value={s.v} {...p} />;'],
  ['a bound type, which may make it a checkbox', 'const a = (s, t) => <input type={t} value={s.v} />;'],
  ['a checkbox\'s value (submitted, never typed)', 'const a = (s) => <input type="checkbox" value={s.v} />;'],
  ['a hidden input', 'const a = (s) => <input type="hidden" value={s.v} />;'],
  ['an option', 'const a = (s) => <select value={s.v} onChange={() => {}}><option value={s.o}>o</option></select>;'],
  ['a progress bar', 'const a = (s) => <progress value={s.p} max="1" />;'],
  ['an explicit .value', 'const a = (s) => <input .value={s.v} />;'],
])
  test(`silent: ${label}`, () => {
    assert.deepEqual(warnings(source), []);
  });

test('unset, nothing is said — and the output is the same either way', () => {
  const source = 'const a = (s) => <input value={s.v} />;';
  assert.equal(transformJsx(source, 'app.tsx', { inject: false }), transformJsx(source, 'app.tsx', { inject: false, onWarning: () => {} }));
});

test('the Vite plugin reports it through the bundler\'s own warn', () => {
  const told = [];
  const plugin = veraJsx({ inject: false });
  plugin.transform.call({ warn: (message) => told.push(message) }, 'export const a = (s) => <input value={s.v} />;', '/src/form.tsx?x=1');
  assert.equal(told.length, 1);
  assert.match(told[0], isProduction
    ? /^\/src\/form\.tsx:1:\d+ — https:\/\/verajs\.dev\/e\/jsx-uncontrolled$/
    : /^\/src\/form\.tsx:1:\d+ — value=\{…\} makes this <input> controlled/);
});
