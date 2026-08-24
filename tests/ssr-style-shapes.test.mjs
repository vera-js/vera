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

const { wire } = await import('../examples/kitchen-sink/wiring.js');
wire(null);

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
