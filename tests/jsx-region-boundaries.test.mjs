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
  ['what looks like a generic', 'const t = a<b>c;']
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
   * A division *before* the JSX, which is the shape that pins the regex discriminator. Read as a
   * regex, the first `/` scans forward for a closing one and swallows the region on the way, so the
   * JSX is silently never seen. With the division only *after* the JSX there is nothing left to miss,
   * which is why the first version of this corpus could not tell the guard was there.
   */
  ['preceded by a division', 'const q = a / b; const v = <p>x</p>;'],
  ['between two divisions', 'const q = a / b; const v = <p>x</p>; const r = c / d;']
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
