/**
 * Every shape `static styles` accepts, through the server.
 *
 * The documented surface is "an object with `styleSheet` and `cssText`, an array of those, or a
 * string" — and the array form is the one a component reaches for the moment it shares a base
 * stylesheet with a sibling. Server-side each becomes a `<style vera-styles>` in the shadow root,
 * because markup cannot carry a constructed sheet; a shape that silently contributed nothing would
 * ship a component with half its CSS and look perfectly fine doing it.
 */
import { renderToString } from '@verajs/ssr/vera';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { wireApp } = await import('../examples/kitchen-sink/wiring.js');
wireApp(null);

const dir = mkdtempSync(new URL('./.styles-', import.meta.url).pathname);
let results;
try {
  writeFileSync(
    `${dir}/shapes.js`,
    `import { init, render, html, css } from '@verajs/core';
const KINDS = {
  'shape-result': css\`.a { color: red }\`,
  'shape-array': [css\`.a { color: red }\`, css\`.b { color: blue }\`],
  'shape-string': '.a { color: green }',
  'shape-mixed': [css\`.a { color: red }\`, '.b { color: blue }'],
  'shape-empty-array': [],
  'shape-none': undefined,
  /** A value interpolated into CSS that closes the element it lands in. */
  'shape-hostile': css\`.a { content: "\${'</style><script>alert(1)</script>'}" }\`,
};
for (const [tag, styles] of Object.entries(KINDS)) {
  customElements.define(tag, class extends HTMLElement {
    static styles = styles;
    connectedCallback() { init(this, { mode: 'open' }); render(() => html\`<p>\${tag}</p>\`); }
  });
}
export default customElements.get('shape-result');
`
  );

  results = {};
  for (const tag of [
    'shape-result',
    'shape-array',
    'shape-string',
    'shape-mixed',
    'shape-empty-array',
    'shape-none',
    'shape-hostile',
  ]) {
    const { html: markup } = await renderToString(new URL(`file://${dir}/shapes.js`), { tag });
    results[tag] = [...markup.matchAll(/<style vera-styles>([\s\S]*?)<\/style>/g)].map(([, css]) =>
      css.replace(/\s+/g, ' ').trim()
    );
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

let pass = 0;
const failures = [];
const check = (name, condition, extra = '') => (condition ? pass++ : failures.push(`${name} — ${extra}`));

check('a single css result becomes one sheet', results['shape-result'].length === 1, JSON.stringify(results['shape-result']));
check(
  'an array becomes one sheet per entry, in order',
  results['shape-array'].join('|') === '.a { color: red }|.b { color: blue }',
  JSON.stringify(results['shape-array'])
);
check('a plain string becomes one sheet', results['shape-string'].join('') === '.a { color: green }', JSON.stringify(results['shape-string']));
check(
  'an array mixing a css result and a string keeps both',
  results['shape-mixed'].length === 2,
  JSON.stringify(results['shape-mixed'])
);
/**
 * **And emits the string first, which is not the order it was written in.**
 *
 * On the client the two arrive by different mechanisms: a constructed sheet is adopted, a string
 * becomes a `<style>` in the shadow root, and the platform applies `adoptedStyleSheets` *after* the
 * root's own tree-order sheets — measured in Chromium, the adopted rule wins against an
 * identical-specificity rule from a `<style>` no matter which comes first in the markup. Here both
 * are `<style>` elements, so the cascade is document order and the last one wins.
 *
 * Emitting sheets first therefore inverted the cascade: the string won on the server and lost in
 * the browser, so the page changed appearance as it hydrated — in the one direction nothing else
 * compares, since markup, node identity and every property value matched.
 */
check(
  'and puts the string before the sheet, so the cascade matches the browser',
  results['shape-mixed'].join('|') === '.b { color: blue }|.a { color: red }',
  JSON.stringify(results['shape-mixed'])
);
check('an empty array contributes nothing', results['shape-empty-array'].length === 0);
check('no styles at all contributes nothing', results['shape-none'].length === 0);

/**
 * `<style>` is a raw-text element: the tokenizer looks only for its end tag, so a value carrying
 * one closes the element and everything after it parses as markup. `<\/style` is valid CSS and
 * renders identically, which is why the escape costs nothing.
 */
check(
  'a value that closes the style element is neutralised',
  results['shape-hostile'].join('').includes('<\\/style') && !results['shape-hostile'].join('').includes('</style>'),
  JSON.stringify(results['shape-hostile'])
);

if (failures.length) {
  console.log(`\n  ${failures.length} style-shape failure(s):\n`);
  for (const failure of failures) console.log('    ' + failure);
}
console.log(`ssr style shapes: ${pass} checks across every form static styles accepts`);
assert.equal(failures.length, 0);

/**
 * **The value axis on the sheet itself.** Everything above hands `replaceSync` a string, which is
 * what `adoptStyles` does — but a component may call it directly, and the platform's argument is a
 * `USVString`. Assigning it straight through left whatever it was given on `cssText`, so a number
 * or a plain object reached the `<style>` block by concatenation, producing wrong text a long way
 * from the call that caused it, and a symbol was accepted where every engine throws.
 *
 * jsdom has no `CSSStyleSheet.replaceSync` at all, so this rule could only be measured in a real
 * engine — `tests/browser/dom-string-coercion.test.js` records it on Chromium, Firefox and WebKit.
 */
test('a stylesheet always holds text, and refuses a symbol as the engines do', () => {
  for (const value of [undefined, null, 0, false, {}, [1, 2]]) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(value);
    assert.equal(typeof sheet.cssText, 'string', `replaceSync(${String(value)}) left a non-string`);
  }

  assert.throws(() => new CSSStyleSheet().replaceSync(Symbol('s')), TypeError,
    'a symbol was accepted where every engine throws');

  /** `replace` is the async spelling of the same thing and must not have its own rule. */
  const sheet = new CSSStyleSheet();
  return sheet.replace(7).then(() => {
    assert.equal(sheet.cssText, '7', 'replace() coerces the way replaceSync does');
  });
});

/**
 * **CSS that varies per request is dropped, and now says so.**
 *
 * A tag's stylesheets are established once per class for the life of the process — whichever render
 * reaches it first sets them, and every later request serves those. That rule is deliberate: it is
 * what stops a per-class sheet being emitted once per instance. What was wrong is that a component
 * whose CSS depends on the request had that variation discarded in silence, so the second visitor
 * got the first visitor's colours with nothing anywhere to explain it.
 *
 * Found while building the concurrency gate for the async-render work: a fixture written to make a
 * hoist leak visible could not, *because* this rule had already thrown the difference away.
 */
test('hoisting different CSS for the same tag warns and keeps the first', async () => {
  const { renderToString: render } = await import('@verajs/ssr/vera');
  const fixture = new URL('./fixtures/ssr/head-style-ssr.js', import.meta.url);

  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let first, second, third;
  try {
    first = await render(fixture, { tag: 'head-style-ssr', attributes: { tone: 'teal' } });
    second = await render(fixture, { tag: 'head-style-ssr', attributes: { tone: 'coral' } });
    third = await render(fixture, { tag: 'head-style-ssr', attributes: { tone: 'coral' } });
  } finally {
    console.warn = original;
  }

  assert.match(first.styles, /teal/, 'the first render establishes the sheet');
  assert.match(second.styles, /teal/, 'and a later one still serves it');
  assert.doesNotMatch(second.styles, /coral/, 'the varying CSS is dropped, as the rule says');

  const drift = warnings.filter((line) => /hoisted different CSS/.test(line));
  assert.equal(drift.length, 1, 'warned once, not once per render');
  assert.match(drift[0], /^\[vera\] ssr:/, 'with the framework prefix');
  assert.match(drift[0], /head-style-ssr/, 'naming the component');
  assert.ok(third, 'a third render still succeeds');
});
