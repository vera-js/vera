/**
 * The shapes `hydrate-roundtrip.test.mjs` serves through `@verajs/ssr` and hydrates: [label, strings, values]. Each
 * strings array is one template on both sides (two arrays are two templates).
 */
export const SHAPES = [
  ['pre with a leading LF', ['<pre>', '</pre>'], ['\nabc']],
  ['textarea text', ['<textarea>', '</textarea>'], ['a<b>&--']],
  ['a whitespace-only value', ['<p>a', 'b</p>'], [' \t\n']],
  ['an attribute holding comment and quote characters', ['<div title="', '">t</div>'], ['--><b>"\'']],
  ['svg title', ['<svg><title>', '</title></svg>'], ['a--b<c']],
  ['style text', ['<div><style>', '</style></div>'], ['a > b { color: red }']],
  ['text holding dashes and references', ['<p>', '</p>'], ['--&#45;&amp;<!--']],
  ['option text', ['<select><option>', '</option></select>'], [' a ']],
  ['a math style held as text', ['<div><math><mi></foreignObject><style><!', '></style></mi></math></div>'], ['a-b']],
  ['noscript text', ['<div><noscript>', '</noscript></div>'], ['<b>x</b>']],
  ['CONTROL: plain text', ['<p>', '</p>'], ['hello']],
];
/**
 * [label, strings, values, hydrated, client]: a comment holding a value, the one deliberate difference. Non-empty on
 * both sides: an empty comment reads like the client's own part marker, which the comparison strips.
 */
export const COMMENTS = [
  /**
   * Written from the rule, not copied from a run: the client drops the value and writes the statics as they are; the
   * server drops it too and leaves ONE space where it was, so `a` and `b` cannot join.
   */
  ['a comment hole', ['<div><!--a', 'b--></div>'], ['x'], '<div><!--a b--></div>', '<div><!--ab--></div>'],
  ['a spaced comment hole', ['<div><!-- ', ' --><b>', '</b></div>'], ['x', 'y'], '<div><!--   --><b>y</b></div>', '<div><!--  --><b>y</b></div>'],
  ['a comment hole in a template', ['<div><template><!-- ', ' --></template>', '</div>'], ['x', 'y'], '<div><template><!--   --></template>y</div>', '<div><template><!--  --></template>y</div>'],
];
export const ALL = [...SHAPES, ...COMMENTS];
