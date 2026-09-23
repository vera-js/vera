/**
 * Where a JSX region begins and ends inside ordinary JavaScript.
 *
 * `transformJsx` reads a whole module and finds the JSX in it, which means deciding whether a `<` is
 * a tag or a comparison. That is the classic hazard in a hand-written JSX parser, and the failure is
 * not a crash: it is a *silently miscompiled file*, where `a < b` becomes markup, or a region ends at
 * a `</div>` that was inside a string.
 *
 * `jsx-equivalence` compares what valid JSX compiles *to*. `module-api` pins which file ids the plugin
 * touches. Neither asks where a region starts, and the two properties below are the cheap way to.
 *
 * ## The identity property
 *
 * A source with no JSX in it must come out byte-identical. That needs no oracle and no expected
 * output, and any difference at all is a miscompilation. `.jsx` is a naming convention, so a file
 * under it with no JSX in it is ordinary, and `transformJsx` is exported for direct use besides.
 *
 * ## The adjacency property
 *
 * Every region that is JSX has to transform, and the result has to still be JavaScript. A region that
 * silently fails to transform is caught by the first of those; one that swallows the code after it is
 * caught by the second.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformJsx } from '@verajs/jsx';

const JSX_FREE = [
  ['a plain comparison', 'const ok = a < b;'],
  ['both directions', 'const ok = a < b && c > d;'],
  ['bit shifts', 'const x = a << 2, y = b >> 1;'],
  ['an arrow after a comparison', "const f = (a) => a < 1 ? 'x' : 'y';"],
  ['a tag inside a string', "const s = '<div>hello</div>';"],
  ['a tag in double quotes', 'const s = "<span class=x>y</span>";'],
  ['a tag inside a template', 'const s = `<div>${x}</div>`;'],
  ['a tag in a line comment', '// <div>not jsx</div>\nconst a = 1;'],
  ['a tag in a block comment', '/* <div>not jsx</div> */\nconst a = 1;'],
  ['a regex holding a less-than', 'const r = /a<b/g;'],
  ['a regex holding a tag', 'const r = /<div>/; const y = 2;'],
  ['division that is not a regex', 'const q = a / b / c;'],
  ['a closing tag in a comment before code', '/* </div> */ const z = a < b;'],
  ['a comparison split across lines', 'const t = x <\n  y;'],
  ['an object holding both', "const o = { cmp: a < b, tag: '<p>' };"],
  ['a method that compares', 'class A { m(a, b) { return a < b; } }'],
  ['a curried arrow', 'const g = (a) => (b) => a < b;'],
  ['an escaped quote beside a tag', "const s = 'it\\'s <b>fine</b>';"],
  /**
   * No space before the operand, which is ordinary formatting and the only shape where the
   * expression-position check actually decides. With a space, `< ` fails the character class on its
   * own and the guard is never consulted -- so a corpus of spaced comparisons pins nothing, which is
   * how the first version of this file let that mutation survive.
   */
  ['a tight comparison', 'const ok = a<b;'],
  ['a tight comparison in an if', 'if (a<b) call();'],
  ['a tight comparison in a for', 'for (let i=0; i<len; i++) sum += i;'],
  ['a tight comparison in a while', 'while (i<n) i++;'],
  ['tight, both directions', 'const ok = a<b && c>d;'],
  ['tight inside an arrow', 'const s = arr.filter((x) => x<limit);'],
  ['tight before a ternary', 'const m = count<max ? 1 : 2;'],
  ['what looks like a generic', 'const t = a<b>c;'],
  /**
   * A `}` ends a BLOCK, so what follows it is at statement position — a regex, or a JSX root; an
   * object literal's `}` is mid-expression and its operator is on the same line.
   *
   * **None of these rows can pin that distinction, and saying so is the point.** A JSX-free source
   * has no `<` for the reading to change the meaning of, so the identity property holds either way.
   * Searching for one that does distinguish turns up only programs no engine accepts
   * (`const q = {}<div>x</div>;`). The mutation is carried by `WITH_JSX`'s 'after a block and a
   * regex', which is where a lost root actually shows. These stay as identity coverage for the
   * shapes the `}` entry makes reachable — and every one is valid JavaScript, which an earlier
   * `'function f() {}\n/ 2;'` was not: after a statement-position `}` a `/` opens a regex, so that
   * row named a reading the language does not give it.
   */
  ['an object literal divided', 'const q = { a: 1 } / 2;'],
  ['an object literal compared', 'const q = { a: 1 } < 2;'],
  ['a block then a division', 'function f() {}\nconst q = a / b;'],
  ['a regex after a block', 'function f() {}\n/^a/.test(s);'],
  ['a regex after an arrow body', 'const f = () => {};\n/^a/.test(s);'],
];

const WITH_JSX = [
  ['after a comparison', 'const c = a < b;\nconst v = <div>x</div>;'],
  ['before a comparison', 'const v = <div>x</div>;\nconst c = a < b;'],
  ['holding a closing tag in a string', "const v = <div>{'</div>'}</div>;"],
  ['holding a tag in a template', 'const v = <div>{`<p>${x}</p>`}</div>;'],
  ['holding a comparison', "const v = <div>{a < b ? 'y' : 'n'}</div>;"],
  ['holding a line comment', 'const v = <div>{// note\n x}</div>;'],
  ['holding a block comment with a tag', 'const v = <div>{/* </div> */ x}</div>;'],
  ['two regions around a comparison', 'const a1 = <p>1</p>; const c = x < y; const a2 = <p>2</p>;'],
  ['in a ternary', 'const v = flag ? <a>y</a> : <b>n</b>;'],
  ['an attribute holding a less-than', "const v = <div title='a<b'>x</div>;"],
  ['a map returning elements', 'const v = <ul>{items.map((i) => <li>{i}</li>)}</ul>;'],
  ['followed by a division', 'const v = <p>x</p>; const q = a / b;'],
  /**
   * **A regex at statement position used to lose every root in the file.** `}` was not an expression
   * prefix, so the `/` read as division, the quote inside the regex opened a string that never
   * closed, and `findRoots` returned zero — `transformJsx` then handed the module back untouched and
   * the JSX surfaced as `Unexpected token '<'` wherever the output ran. Silent, and total.
   */
  ['after a block and a regex', 'function f() {}\n/^[\'"]/.test(s);\nconst v = <div>x</div>;'],
  ['after an arrow body and a regex', 'const f = () => {};\n/^a/.test(s);\nconst v = <path d="M0" />;'],
  ['at statement position after a block', 'function f() {}\nconst v = <div>x</div>;'],
  ['an underscore-named component', 'export const v = <_Icon x={1} />;'],
  ['a dollar-named component', 'export const v = <$Icon x={1} />;'],
  ['a divided object then a slash-string', 'const q = { a: 1 } / 2; const p = "a/b";\nconst v = <div>x</div>;'],
  ['a divided object then a comment', 'const q = { a: 1 } / 2; // half\nconst v = <div>x</div>;'],
  /**
   * A property named with an expression KEYWORD. `lastWord` is the run of word characters before the
   * `/`, so `stats.new` and `timings.in` left it holding `new`/`in`, the `/` opened a regex, and the
   * rest of the line went with it — every root in the module, or a binding and then a collision.
   *
   * The root has to sit on the SAME LINE as the division. `skipRegex` bails at a newline "without
   * harm", so a root on the next line survives and the row measures nothing — which is how the first
   * version of these three passed with the fix reverted.
   */
  ['a member named new, divided', 'const s = { new: 4 };\nconst r = s.new / 2, v = <div class="x" />;'],
  ['a member named in, divided', 'const t = { in: 3 };\nconst r = t.in / 2, v = <p class="y" />;'],
  ['a member named delete, divided', 'const m = { delete: 2 };\nconst r = m.delete / 2, v = <b class="z" />;'],
  /**
   * A postfix `++`/`--` ENDS an expression, but `lastChar` sees only the second sign and `+` is an
   * expression prefix. `{n++ / total}` is an ordinary running percentage, and the whole module came
   * back verbatim.
   */
  ['a postfix increment divided', 'let i = 1;\nconst r = i++ / 2, v = <div class="x" />;'],
  ['a postfix decrement divided', 'let i = 9;\nconst r = i-- / 2, v = <p class="y" />;'],
  /**
   * A division *before* the JSX, which is the shape that pins the regex discriminator. Read as a
   * regex, the first `/` scans forward for a closing one and swallows the region on the way, so the
   * JSX is silently never seen. With the division only *after* the JSX there is nothing left to miss,
   * which is why the first version of this corpus could not tell the guard was there.
   */
  ['preceded by a division', 'const q = a / b; const v = <p>x</p>;'],
  ['between two divisions', 'const q = a / b; const v = <p>x</p>; const r = c / d;'],
  /**
   * A COMMENT between the postfix operator and the division. The rule above used to be answered by
   * scanning backwards over whitespace from the `/`, which landed on the closing slash of a block
   * comment and read the comment itself as an operator — so a postfix increment, a block comment and
   * a division lost every root in the module while its neighbour three rows up passed. It is
   * answered forwards now, where comments are already invisible.
   */
  ['a postfix increment, comment, divided', 'let i = 1;\nconst r = i++ /* c */ / 2, v = <div class="x" />;'],
  ['a postfix increment, line comment, divided', 'let i = 1;\nconst r = i++\n// c\n/ 2, v = <div class="x" />;'],
  ['an object literal, comment, divided', 'const o = { a: 1 } /* c */ / 2, v = <p class="y" />;']
];

/**
 * TypeScript rows, kept apart because `new Function` rejects a non-null assertion — the check below
 * strips them before parsing. `.tsx` is a first-class input and had no row here at all.
 */
const WITH_TSX = [
  ['a postfix non-null divided', 'let d = 1;\nconst r = d! / 2, v = <div class="x" />;'],
  ['a non-null member divided', 'const o = { n: 1 };\nconst r = o.n! / 2, v = <p class="y" />;'],
  ['a non-null call divided', 'const f = () => 1;\nconst r = f()! / 2, v = <b class="z" />;'],
  ['a non-null, comment, divided', 'let d = 1;\nconst r = d! /* c */ / 2, v = <i class="w" />;']
];

test('a source with no JSX comes out unchanged', () => {
  const changed = [];
  for (const [name, source] of JSX_FREE) {
    let output;
    try { output = transformJsx(source, 'probe.jsx'); }
    catch (error) { changed.push(`${name}: threw ${error.message.slice(0, 60)}`); continue; }
    if (output !== source) changed.push(`${name}: ${JSON.stringify(source)} became ${JSON.stringify(output).slice(0, 90)}`);
  }
  assert.deepEqual(changed, [], `these were rewritten and should not have been:\n  ${changed.join('\n  ')}`);
});

test('and JSX beside the things that look like it still compiles', () => {
  const problems = [];
  for (const [name, source] of WITH_JSX) {
    let output;
    try { output = transformJsx(source, 'probe.jsx'); }
    catch (error) { problems.push(`${name}: threw ${error.message.slice(0, 70)}`); continue; }

    /** Unchanged here means the region was never recognised, which is the other half of the failure. */
    if (output === source) { problems.push(`${name}: unchanged, so the JSX was not seen`); continue; }

    /** And the result still has to be JavaScript, or the transform corrupted the file. */
    try { new Function(output.replace(/^import .*$/gm, '').replace(/^export /gm, '')); }
    catch (error) { problems.push(`${name}: output does not parse - ${error.message.slice(0, 50)} - ${output.slice(0, 80)}`); }
  }
  assert.deepEqual(problems, [], `region boundaries went wrong:\n  ${problems.join('\n  ')}`);
});

/**
 * The SECOND half of the failure, which "was the region seen" cannot reach. When the `/` is misread
 * the regex runs to the next slash and eats the rest of the line — including the `v = …` binding —
 * so the injected `import { html }` collides with a `const` the scan no longer knows is there. Every
 * row here declares `html` on the eaten line, so a correct scan MUST alias and a broken one will not.
 */
const COLLIDING = [
  ['a postfix non-null', 'let d = 1;\nconst r = d! / 2, html = 1;\nexport const v = <div class="x" />;'],
  ['a non-null member', 'const o = { n: 1 };\nconst r = o.n! / 2, html = 1;\nexport const v = <p class="y" />;'],
  ['a postfix increment, comment', 'let i = 1;\nconst r = i++ /* c */ / 2, html = 1;\nexport const v = <b class="z" />;'],
  ['a member named new', 'const s = { new: 4 };\nconst r = s.new / 2, html = 1;\nexport const v = <i class="w" />;'],
  /**
   * A CLOSED TEMPLATE is a value, so the `/` after it is division. Read as a regex it runs to the
   * next slash and eats the binding, exactly as the member-name rows above do.
   */
  ['a closed template divided', 'const t = `x` / 2, html = 1;\nexport const v = <b class="z" />;'],
  ['a closed string divided', "const q = 'w' / 2, html = 1;\nexport const v = <b class=\"z\" />;"],
  /**
   * An APOSTROPHE inside JSX TEXT, with the binding AFTER the region. The literal scan has to recurse
   * into a child expression's own JSX or the apostrophe opens a fake string and blanks everything
   * after it — and the binding has to sit after the JSX for the row to measure that, which is the
   * defect in the three rows `jsx-name-corpus` already carries: it always appends the body LAST, so
   * the blanked tail held no binding and all three passed with the recursion removed.
   */
  ['an apostrophe in JSX text, binding after', "export const v = ({ x }) => <div>{x && <p>Don't stop</p>}</div>;\nconst html = 1;"],
  ['a backtick in JSX text, binding after', 'export const v = ({ x }) => <div>{x && <p>a ` b</p>}</div>;\nconst html = 1;'],
  ['an apostrophe in an ATTRIBUTE, binding after', "export const v = ({ x }) => <div title={x && <p>it's</p>}>y</div>;\nconst html = 1;"]
];

test('a binding on the divided line is seen, so the injected import aliases around it', () => {
  const problems = [];
  for (const [name, source] of COLLIDING) {
    const output = transformJsx(source, 'probe.tsx');
    if (!/^import \{ html as \$veraHtml \}/m.test(output))
      problems.push(`${name}: expected an aliased import, got ${JSON.stringify((output.match(/^import .*$/m) ?? ['(none)'])[0])}`);
    if (!/\$veraHtml`/.test(output)) problems.push(`${name}: the call site does not use the alias`);
  }
  /** The control: with no colliding binding the SAME shapes must take the plain import, or the rows
   *  above would pass against a compiler that aliased unconditionally. */
  for (const [name, source] of COLLIDING) {
    const output = transformJsx(source.replace(', html = 1', '').replace(/\nconst html = 1;/, ''), 'probe.tsx');
    if (!/^import \{ html \}/m.test(output))
      problems.push(`${name} (no collision): expected a plain import, got ${JSON.stringify((output.match(/^import .*$/m) ?? ['(none)'])[0])}`);
  }
  assert.deepEqual(problems, [], `the eaten-binding half went wrong:\n  ${problems.join('\n  ')}`);
});

test('a parameter that shadows the tag is seen inside an ATTRIBUTE too', () => {
  /**
   * The JS scan runs over an element's ATTRIBUTE expressions as well as its children, and that half
   * has been missing once. `onClick={(html) => r(<b>x</b>)}` emits the template INSIDE an arrow whose
   * own parameter shadows `html`, so the injected import is not the binding at the call site and the
   * handler throws on click — at click time, not at load.
   */
  const shadowed = transformJsx('export const v = ({ r }) => <div onClick={(html) => r(<b>x</b>)}>y</div>;', 'p.jsx');
  assert.match(shadowed, /^import \{ html as \$veraHtml \}/m, shadowed);
  assert.match(shadowed, /\(html\) => r\(\$veraHtml`<b>x<\/b>`\)/, shadowed);
  /** The control: the same shape with an unshadowing parameter name takes the plain import. */
  const plain = transformJsx('export const v = ({ r }) => <div onClick={(q) => r(<b>x</b>)}>y</div>;', 'p.jsx');
  assert.match(plain, /^import \{ html \}/m, plain);
  assert.match(plain, /\(q\) => r\(html`<b>x<\/b>`\)/, plain);
});

test('and the TypeScript rows keep their regions too', () => {
  const problems = [];
  for (const [name, source] of WITH_TSX) {
    let output;
    try { output = transformJsx(source, 'probe.tsx'); }
    catch (error) { problems.push(`${name}: threw ${error.message.slice(0, 70)}`); continue; }
    if (output === source) { problems.push(`${name}: unchanged, so the JSX was not seen`); continue; }
    try { new Function(output.replace(/^import .*$/gm, '').replace(/^export /gm, '').replace(/!/g, '')); }
    catch (error) { problems.push(`${name}: output does not parse - ${error.message.slice(0, 50)}`); }
  }
  assert.deepEqual(problems, [], `TypeScript region boundaries went wrong:\n  ${problems.join('\n  ')}`);
});
