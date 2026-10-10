/**
 * **Every jsx compile refusal and the compile warning, by code, in both builds** (code-system phase 3; 3d, Brian,
 * 2026-10-09). DEVELOPMENT — the build Node and Vite load, through the package's `node` condition — says the whole
 * thing: `file:line:col — sentence … (code)`, the code ENDING it (a line that merely quotes a code, mislabeled as
 * another, does not count). PRODUCTION — the compiler a buildless page fetches — says exactly `file:line:col —
 * https://verajs.dev/e/<code>`: no sentence, because every page that compiles would pay for them. Two codes are shared
 * with the renderer's `tag()` (`void-children`, `style-object`): same fact, the emitter's own example and fate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { isProduction, load } from './dist.mjs';

const { transformJsx } = await load('jsx');

/** [code, source, a fragment of the sentence that names this mistake] */
const REFUSALS = [
  ['jsx-tag-mismatch', 'const a = <p>y</b>;', '<p> is closed by </b>'],
  ['jsx-unclosed-comment', 'const a = <p class="a" /* oops>x</p>;', 'a comment among the attributes is never closed'],
  ['jsx-empty-expression', 'const a = <div x={} />;', 'x={} has no value'],
  ['jsx-empty-expression', 'const a = <Card {...} />;', '{...} has no value'],
  ['jsx-key-placement', 'const a = <ul><li key={1}>x</li></ul>;', 'key belongs on the JSX root'],
  ['void-children', 'const a = <input>{label}</input>;', '<input> is a void element'],
  ['jsx-inner-html-shape', 'const a = <div dangerouslySetInnerHTML={html} />;', 'expects {{ __html: expr }} — this is another shape'],
  ['jsx-inner-html-shape', 'const a = <div dangerouslySetInnerHTML={{ __html: }} />;', '{{ __html: }} has no value'],
  ['style-object', 'const a = <div style={{ color: c }} />;', 'Build the string: style={`color:${c}`}'],
  ['jsx-sigil-value', 'const a = <p .rows />;', '.rows needs a value'],
];

for (const [code, source, fragment] of REFUSALS)
  test(`${code}: ${source}`, () => {
    let message = '';
    try {
      transformJsx(source, 'app.tsx');
    } catch (error) {
      message = error.message;
    }
    assert.ok(message !== '', 'CONTROL: the compiler refused it');
    if (isProduction) return assert.match(message, new RegExp(`^app\\.tsx:1:\\d+ — https://verajs\\.dev/e/${code}$`));
    assert.ok(message.startsWith('app.tsx:1:'), `the position first: ${message}`);
    assert.ok(message.includes(fragment), `the sentence: ${message}`);
    assert.ok(message.endsWith(`(${code})`), `the code ends it: ${message}`);
  });

test('jsx-uncontrolled: a controlled value with nothing keeping it in step is warned about, by code', () => {
  const told = [];
  transformJsx('const a = <input value={v} />;', 'app.tsx', { onWarning: (message) => told.push(message) });
  assert.equal(told.length, 1, told.join(' | '));
  if (isProduction) return assert.match(told[0], /^app\.tsx:1:\d+ — https:\/\/verajs\.dev\/e\/jsx-uncontrolled$/);
  assert.match(told[0], /^app\.tsx:1:\d+ — value=\{…\} makes this <input> controlled[\s\S]*defaultValue[\s\S]*\(jsx-uncontrolled\)$/);
});

/**
 * **The build Node and Vite load says the whole sentence** — `dist/node/vera-jsx.js`, which the package's `node`
 * condition maps (minified, `__DEV__` kept true: measured tied with the production compiler cold and steady, where the
 * unminified development file cost 1–1.5% cold). A third program, so pinned by itself, in every run.
 */
test('the node build (the `node` export condition) refuses with the sentence and the code', async () => {
  const file = fileURLToPath(new URL('../packages/jsx/dist/node/vera-jsx.js', import.meta.url));
  const { transformJsx: compile } = await import(file);
  let message = '';
  try {
    compile('const a = <p>y</b>;', 'app.tsx');
  } catch (error) {
    message = error.message;
  }
  assert.equal(message, 'app.tsx:1:15 — <p> is closed by </b>. End <p> with </p>, before </b>. (jsx-tag-mismatch)');
});
