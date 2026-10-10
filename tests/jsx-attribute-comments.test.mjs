/**
 * **A comment among a JSX element's attributes is dropped, as TypeScript, Babel and esbuild drop it.**
 *
 * Reported from Content Flow (2026-10-01): `<button type="button" /* note *\/ class="x">` — or, the common form, a `//`
 * line above one attribute of a long element — left THAT element as raw JSX, with no warning, and Vite then failed on
 * it with an unrelated `PARSE_ERROR Unexpected token`. The attribute loop skipped only whitespace, so the comment's `/`
 * ended the tag and the parser answered "never JSX". Each row compares the output with the same source written without
 * the comment: the comment must change nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './dist.mjs';
import { jsxLine } from './jsx-line.mjs';

/** Through dist.mjs — the artifact under test (development, production, or the node build), never a bare resolve. */
const { transformJsx } = await load('jsx');

const compile = (source) => transformJsx(source, 'app.tsx', { namespaces: false }).replace(/^import .*\n/gm, '').trim();

for (const [label, withComment, without] of [
  ['an inline block comment (the report)', 'const B = () => <button type="button" /* note */ class="x">Hi</button>;', 'const B = () => <button type="button" class="x">Hi</button>;'],
  [
    'a line comment above one attribute (the common form)',
    'const B = ({ busy, save }) => <button\n  type="button"\n  // Why this one is disabled\n  disabled={busy}\n  onClick={save}\n>\n  Save\n</button>;',
    'const B = ({ busy, save }) => <button\n  type="button"\n  disabled={busy}\n  onClick={save}\n>\n  Save\n</button>;',
  ],
  ['comments beside `=`', 'const B = () => <p title /* a */ = /* b */ "t">x</p>;', 'const B = () => <p title = "t">x</p>;'],
  ['a comment right before `>`', 'const B = () => <p class="a" /* end */>x</p>;', 'const B = () => <p class="a">x</p>;'],
  ['a comment right before `/>`', 'const B = () => <input value="v" /* end */ />;', 'const B = () => <input value="v" />;'],
  ['a comment holding `>` and `/>`', 'const B = () => <p /* a > b, c /> */ class="a">x</p>;', 'const B = () => <p class="a">x</p>;'],
  ['a line comment holding a closing tag', 'const B = () => <p\n  // see </div> and <b>\n  class="a">x</p>;', 'const B = () => <p\n  class="a">x</p>;'],
  ['a comment before a spread', 'const B = (p) => <p /* rest */ {...p}>x</p>;', 'const B = (p) => <p {...p}>x</p>;'],
])
  test(`${label}: dropped, the element compiled as without it`, () => {
    const out = compile(withComment);
    assert.equal(out, compile(without));
    assert.doesNotMatch(out.replace(/html`[^`]*`/g, ''), /</, `CONTROL: no raw JSX left outside the templates: ${out}`);
    assert.match(out, /html`/, 'compiled to a template');
  });

test('only the element with the comment was affected before: its siblings in the same file compile too', () => {
  const out = compile('export const A = () => <p class="a">One</p>;\nexport const B = () => <button type="button" /* note */ class="x">Hi</button>;\nexport const C = () => <span>{/* fine */}Three</span>;');
  assert.equal((out.match(/html`/g) ?? []).length, 3, out);
  assert.doesNotMatch(out, /\/\* note \*\//, 'the comment is gone');
});

test('an unterminated comment among the attributes is reported, naming the file and position — never passed through', () => {
  assert.throws(() => transformJsx('const a = <p class="a" /* oops>x</p>;', 'app.tsx'), jsxLine('jsx-unclosed-comment', 'a comment among the attributes is never closed', 'app.tsx:1:24'));
});

test('CONTROL: non-JSX `<` followed by a comment is left untouched', () => {
  const source = 'const lt = (a: number, b: number) => a < b // compare\n  ;';
  assert.equal(transformJsx(source, 'app.tsx', { namespaces: false }).trim(), source.trim());
});
