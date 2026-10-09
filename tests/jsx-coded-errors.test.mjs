/**
 * **Every jsx compile refusal and the compile warning, by code — in EVERY build** (code-system phase 3, 2026-10-09).
 * The compiler keeps its words in production (Vite and Node load the production compiler by default, and a compile
 * error is a build tool's only output), so each message is pinned whole-shape: `file:line:col — sentence … (code)`,
 * the code ENDING it — a line that merely quotes a code, mislabeled as another, does not count. Two codes are shared
 * with the renderer's `tag()` (`void-children`, `style-object`): same fact, the emitter's own example and fate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';

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
    assert.ok(message.startsWith('app.tsx:1:'), `the position first: ${message}`);
    assert.ok(message.includes(fragment), `the sentence: ${message}`);
    assert.ok(message.endsWith(`(${code})`), `the code ends it: ${message}`);
  });

test('jsx-uncontrolled: a controlled value with nothing keeping it in step is warned about, by code', () => {
  const told = [];
  transformJsx('const a = <input value={v} />;', 'app.tsx', { onWarning: (message) => told.push(message) });
  assert.equal(told.length, 1, told.join(' | '));
  assert.match(told[0], /^app\.tsx:1:\d+ — value=\{…\} makes this <input> controlled[\s\S]*defaultValue[\s\S]*\(jsx-uncontrolled\)$/);
});
