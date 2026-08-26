/**
 * **Two ways JSX failed by staying quiet.**
 *
 * The parser answers `null` for everything it cannot make sense of, and it has to: `<` is ambiguous,
 * so `a < b` must survive a file being run through this transform. The cost is that a real mistake
 * is emitted verbatim and surfaces later as `Unexpected token '<'` from whatever runs the output —
 * pointing at JSX the author believes was compiled.
 *
 * - `<x-el .rows={data} />` was not an attribute name at all, so **the whole file came out
 *   untransformed**: every other component in it stopped compiling, and the error came from
 *   somewhere else entirely. It is also the only way to hand a custom element structured data —
 *   `rows={data}` is an attribute, and an attribute carries a string, so an array arrives as
 *   `"1,2,3"`. The renderer's four sigils now mean in JSX what they mean in `html`.
 * - A closing tag naming a different element is **the one structural failure that cannot be a
 *   comparison**: reaching it means a whole open tag and its children were already consumed. So it
 *   is reported with file, line and column, like every other JSX mistake here, instead of shrugged
 *   at. Everything still genuinely ambiguous — an unclosed `<p>x` at end of file — is still left
 *   alone, and this file asserts that too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformJsx } from '@verajs/jsx';

const compile = (source) => transformJsx(source, 'app.tsx').replace(/^import .*\n/gm, '').trim();

test('the renderer sigils mean the same thing in JSX', () => {
  assert.equal(compile('const a = <x-el .rows={d} />;'), 'const a = html`<x-el .rows=${d} />`;');
  assert.equal(compile('const a = <p ?hidden={f}>x</p>;'), 'const a = html`<p ?hidden=${f}>x</p>`;');
  assert.equal(compile('const a = <p @click={f}>x</p>;'), 'const a = html`<p @click=${f}>x</p>`;');
  assert.equal(compile('const a = <p &={r}>x</p>;'), 'const a = html`<p &=${r}>x</p>`;');
});

test('a sigil the author wrote is not guessed at a second time', () => {
  /** `hidden` is in the boolean table and `onClick` is an event, and neither rule may fire twice. */
  assert.equal(compile('const a = <p ?hidden={f}>x</p>;'), 'const a = html`<p ?hidden=${f}>x</p>`;');
  assert.equal(compile('const a = <p .value={v} />;'), 'const a = html`<p .value=${v} />`;');
  /** And the guessing still happens for names written without one. */
  assert.equal(compile('const a = <p hidden={f}>x</p>;'), 'const a = html`<p ?hidden=${f}>x</p>`;');
  assert.equal(compile('const a = <p onClick={f}>x</p>;'), 'const a = html`<p @click=${f}>x</p>`;');
});

test('a sigil with no value is refused, with a position', () => {
  assert.throws(() => transformJsx('const a = <p .rows />;', 'app.tsx'), /app\.tsx:1:14 — \.rows needs a value/);
});

test('a lone sigil is a name only for the ref', () => {
  /** `&=` is how the renderer spells an explicit ref; `.=`, `?=` and `@=` mean nothing. */
  for (const source of ['const a = <p .={v} />;', 'const a = <p ?={v} />;', 'const a = <p @={v} />;'])
    assert.equal(compile(source), source, `${source} should be left alone, not half-compiled`);
});

test('a mismatched closing tag is reported where it is', () => {
  assert.throws(() => transformJsx('const a = <p>y</b>;', 'app.tsx'), /app\.tsx:1:15 — <p> is closed by <\/b>/);
  assert.throws(() => transformJsx('const a = <ul><li>1</ul>;', 'app.tsx'), /<li> is closed by <\/ul>/);
  assert.throws(
    () => transformJsx('const first = <p>ok</p>;\nconst second = <p>y</b>;', 'app.tsx'),
    /app\.tsx:2:20/,
    'the position is the closing tag, not the start of the file'
  );
});

test('what is genuinely ambiguous is still left exactly as it was', () => {
  for (const source of [
    'const a = x < y;',
    'const a = f<number>(1);',
    'const a = 1 << 2;',
    'const a = a.b < c;',
    'const a = <p>y;',
    '// <div>not jsx</div>\nconst a = 1;',
  ])
    assert.equal(transformJsx(source, 'app.tsx'), source, source);
});
