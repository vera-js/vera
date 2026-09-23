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
  assert.equal(compile('const a = <x-el .rows={d} />;'), 'const a = html`<x-el .rows=${d}></x-el>`;');
  assert.equal(compile('const a = <p ?hidden={f}>x</p>;'), 'const a = html`<p ?hidden=${f}>x</p>`;');
  assert.equal(compile('const a = <p @click={f}>x</p>;'), 'const a = html`<p @click=${f}>x</p>`;');
  assert.equal(compile('const a = <p &={r}>x</p>;'), 'const a = html`<p &=${r}>x</p>`;');
});

test('a sigil the author wrote is not guessed at a second time', () => {
  /** `hidden` is in the boolean table and `onClick` is an event, and neither rule may fire twice. */
  assert.equal(compile('const a = <p ?hidden={f}>x</p>;'), 'const a = html`<p ?hidden=${f}>x</p>`;');
  assert.equal(compile('const a = <p .value={v} />;'), 'const a = html`<p .value=${v}></p>`;');
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

test('an empty attribute expression is reported, and an empty child is not', () => {
  /**
   * `<div x={}/>` compiled to a template hole containing nothing — a syntax error in code the author
   * never wrote, with nothing naming the `{}` responsible. An empty CHILD container stays legal and
   * vanishes, which is what JSX does, so this is a pair rather than a single rule.
   */
  assert.throws(() => transformJsx('const a = <div x={} />;', 'app.tsx'), /app\.tsx:1:18 — x=\{\} has no value/);
  assert.throws(() => transformJsx('const a = <div x={ /* c */ } />;', 'app.tsx'), /x=\{\} has no value/);
  assert.equal(compile('const a = <div>{}</div>;'), 'const a = html`<div></div>`;');
  assert.equal(compile('const a = <div x={1} />;'), 'const a = html`<div x=${1}></div>`;');
  /**
   * The same emptiness, spelled three more ways, each of which emitted code that does not parse: a
   * LINE comment (every copy of the test stripped only block comments), a spread of nothing, and an
   * `__html` key with no value. A line comment in a CHILD vanishes like a block one.
   */
  assert.throws(() => transformJsx('const a = <div x={// note\n} />;', 'app.tsx'), /app\.tsx:1:18 — x=\{\} has no value/);
  assert.throws(() => transformJsx('const a = <Card {...} />;', 'app.tsx'), /app\.tsx:1:17 — \{\.\.\.\} has no value/);
  assert.throws(() => transformJsx('const a = <Card {.../* c */} />;', 'app.tsx'), /\{\.\.\.\} has no value/);
  assert.throws(
    () => transformJsx('const a = <div dangerouslySetInnerHTML={{ __html: }} />;', 'app.tsx'),
    /__html: \}\} has no value/
  );
  assert.equal(compile('const a = <div>{// note\n}</div>;'), 'const a = html`<div></div>`;');
  /** The controls: a comment BESIDE a value, and a real spread and `__html`, are all still values. */
  assert.equal(compile('const a = <div x={1 // note\n} />;'), 'const a = html`<div x=${1 // note\n}></div>`;');
  assert.match(compile('const a = <Card {...p} />;'), /Card\(\{ \.\.\.p \}\)/);
  assert.match(compile('const a = <div dangerouslySetInnerHTML={{ __html: s }} />;'), /\.innerHTML=\$\{s\}/);
});

test('a hashbang stays on line one', () => {
  /** Only line 1 makes `#!` a hashbang, so an injected import above it is a syntax error at byte 0. */
  const out = transformJsx('#!/usr/bin/env node\nconst a = <p>y</p>;', 'app.tsx');
  assert.match(out, /^#!\/usr\/bin\/env node\nimport \{ html \}/, out.slice(0, 80));
  /** The control: with nothing to inject the file is untouched, so the row above measures the move. */
  assert.match(transformJsx('#!/usr/bin/env node\nconst a = <p>y</p>;', 'app.tsx', { inject: false }), /^#!/);
});

test('only the FIRST fault is reported, whichever kind comes first', () => {
  /** After one fault the walker's idea of the source is already wrong, so a later complaint is a
   *  consequence of it — and naming it buries the cause. Both orders, since each channel has its own
   *  "only if nothing yet" guard. */
  assert.throws(() => transformJsx('const a = <div x={} />;\nconst b = <p>x</span>;', 'app.tsx'), /app\.tsx:1:18 — x=\{\} has no value/);
  assert.throws(() => transformJsx('const b = <p>x</span>;\nconst a = <div x={} />;', 'app.tsx'), /<p> is closed by <\/span>/);
});

test('a boolean attribute set to the empty string is TRUE', () => {
  /**
   * `hidden=""` is what the PLATFORM serialises a set boolean to, so reading it as false inverted
   * every attribute on markup round-tripped through the DOM. `tests/hydrate-parity.test.mjs` already
   * recorded `<b hidden="">` as `?hidden=${true}` on the renderer side, so this half disagreed with
   * the repo's own fixture. `hidden="false"` staying false is the one deliberate divergence.
   */
  assert.equal(compile('const a = <div hidden="" />;'), 'const a = html`<div ?hidden=${true}></div>`;');
  assert.equal(compile('const a = <button disabled="" />;'), 'const a = html`<button ?disabled=${true}></button>`;');
  assert.equal(compile('const a = <div hidden="false" />;'), 'const a = html`<div ?hidden=${false}></div>`;');
  assert.equal(compile('const a = <div hidden="y" />;'), 'const a = html`<div ?hidden=${true}></div>`;');
  /**
   * The rule's second home: a literal `checked` is a PROPERTY binding, and passed through as a string
   * the property coerced it backwards — `""` unchecked, `"false"` checked. `value` is the control: a
   * literal there is a string and must stay one.
   */
  assert.equal(compile('const a = <input checked="" />;'), 'const a = html`<input .checked=${true} />`;');
  assert.equal(compile('const a = <input checked="false" />;'), 'const a = html`<input .checked=${false} />`;');
  assert.equal(compile('const a = <input value="" />;'), 'const a = html`<input .value=${""} />`;');
});

test('a mixed-case void element still self-closes', () => {
  /** Tag names are case-insensitive in HTML and the emitter keeps the author's spelling, so the void
   *  list has to be asked in lowercase — otherwise `<bR/>` emits an end tag no void element may have. */
  assert.equal(compile('const a = <div><bR /></div>;'), 'const a = html`<div><bR /></div>`;');
  assert.equal(compile('const a = <div><iMg src="a" /></div>;'), 'const a = html`<div><iMg src="a" /></div>`;');
  /** The control: a non-void element in the same position DOES get its end tag. */
  assert.equal(compile('const a = <div><sPan /></div>;'), 'const a = html`<div><sPan></sPan></div>`;');
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
