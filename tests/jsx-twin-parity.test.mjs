/**
 * Every JSX construct against the tagged template a person would have written instead.
 *
 * `transformJsx` is a hand-written parser — no acorn, deliberately — so the useful question is not
 * "does the output look right" but **"does it render the same DOM as the template it stands in
 * for?"** `tests/kitchen-jsx.test.mjs` already asks that of four whole components; this asks it of
 * each documented mapping on its own, where a failure names the mapping rather than the component.
 *
 * The mappings come from the header of `packages/jsx/src/transform.js`: `className`, `htmlFor`,
 * `onClick`, bound and bare booleans, `value`/`checked` as properties, `defaultValue` as an
 * attribute, `dangerouslySetInnerHTML`, fragments, and the rest.
 *
 * **The second half is the one a hand-written parser is most likely to fail**: source where `<` is
 * not JSX at all. The transform hands back anything it cannot make sense of, precisely so `a < b`
 * survives, so the risk runs the other way — ordinary JavaScript being rewritten.
 *
 * Compiled in memory and imported as a data URL with bare specifiers repointed at the artifacts this
 * run is testing, the same trick `tests/llms-recipes.test.mjs` uses, so nothing is written to disk.
 */
import { load, distUrl } from './dist.mjs';
import { transformJsx } from '@verajs/jsx';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';
import test from 'node:test';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'MouseEvent',
])
  globalThis[key] = dom.window[key];

const { wire } = await load('core');
const { renderer, renderInto } = await load('renderer');
wire([renderer]);

/** Bare specifiers, pointed at the artifacts this run is testing — what the import map does. */
const PACKAGES = {
  '@verajs/core': 'core',
  '@verajs/renderer': 'renderer',
  '@verajs/renderer/keyed': 'renderer/keyed',
  '@verajs/renderer/spread': 'renderer/spread',
};
const repoint = (code) =>
  code.replace(/from ['"](@verajs\/[a-z/]+)['"]/g, (whole, specifier) => {
    assert.ok(PACKAGES[specifier], `tests/jsx-twin-parity: add "${specifier}" to PACKAGES`);
    return `from '${distUrl(PACKAGES[specifier])}'`;
  });

/** The client's own part markers are bookkeeping; the comparison is about rendered content. */
const strip = (host) => host.innerHTML.replace(/<!---->/g, '');

/** `[label, jsx, the tagged template it stands in for]`. */
const PAIRS = [
  ['a plain element', '<p class="a">hi</p>', 'html`<p class="a">hi</p>`'],
  ['a bound attribute', '<p class={v}>hi</p>', 'html`<p class=${v}>hi</p>`'],
  ['an expression child', '<p>{v}</p>', 'html`<p>${v}</p>`'],
  ['text around an expression', '<p>a {v} b</p>', 'html`<p>a ${v} b</p>`'],
  ['className', '<p className={v}>hi</p>', 'html`<p class=${v}>hi</p>`'],
  ['htmlFor', '<label htmlFor={v}>hi</label>', 'html`<label for=${v}>hi</label>`'],
  ['onClick', '<button onClick={fn}>go</button>', 'html`<button @click=${fn}>go</button>`'],
  ['a bound boolean', '<input disabled={v} />', 'html`<input ?disabled=${v} />`'],
  ['a bare boolean', '<input disabled />', 'html`<input disabled />`'],
  ['value is a property', '<input value={v} />', 'html`<input .value=${v} />`'],
  ['checked is a property', '<input type="checkbox" checked={v} />', 'html`<input type="checkbox" .checked=${v} />`'],
  ['defaultValue is an attribute', '<input defaultValue={v} />', 'html`<input value=${v} />`'],
  ['nesting', '<ul><li>{v}</li></ul>', 'html`<ul><li>${v}</li></ul>`'],
  ['siblings', '<div><b>a</b><i>b</i></div>', 'html`<div><b>a</b><i>b</i></div>`'],
  ['a fragment', '<><b>a</b><i>b</i></>', 'html`<b>a</b><i>b</i>`'],
  ['a nested fragment', '<div><><b>a</b></></div>', 'html`<div><b>a</b></div>`'],
  ['self-closing', '<br />', 'html`<br />`'],
  ['an array child', '<ul>{[1, 2].map((n) => <li>{n}</li>)}</ul>', 'html`<ul>${[1, 2].map((n) => html`<li>${n}</li>`)}</ul>`'],
  ['dangerouslySetInnerHTML', '<div dangerouslySetInnerHTML={{ __html: markup }} />', 'html`<div .innerHTML=${markup}></div>`'],
  ['a style string', '<p style="color: red">hi</p>', 'html`<p style="color: red">hi</p>`'],
  ['an entity', '<p>a &amp; b</p>', 'html`<p>a &amp; b</p>`'],
  ['unicode', '<p>héllo 日本 🎉</p>', 'html`<p>héllo 日本 🎉</p>`'],
  ['a sigil the author wrote', '<p .title={v}>hi</p>', 'html`<p .title=${v}>hi</p>`'],
  ['a template literal in an attribute', '<p class={`lead ${v} tail`}>hi</p>', 'html`<p class=${`lead ${v} tail`}>hi</p>`'],
  ['a comment child', '<p>{/* gone */}a</p>', 'html`<p>a</p>`'],
];

const compiled = async (jsx, twin, index) => {
  const source = `
const v = 'VALUE';
const markup = '<em>raw</em>';
const fn = () => {};
export const fromJsx = () => (${jsx});
export const fromTemplate = () => (${twin});
`;
  const output = transformJsx(source, `pair-${index}.jsx`);
  const code = repoint(String(output.code ?? output));
  return import(`data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`);
};

test('every JSX construct renders what its tagged-template twin renders', async () => {
  const differences = [];
  for (const [index, [label, jsx, twin]] of PAIRS.entries()) {
    let module;
    try {
      module = await compiled(jsx, twin, index);
    } catch (error) {
      differences.push(`${label}: the compiled output does not import — ${error.message.slice(0, 100)}`);
      continue;
    }
    const fromJsx = document.createElement('div');
    const fromTemplate = document.createElement('div');
    renderInto(module.fromJsx(), fromJsx);
    renderInto(module.fromTemplate(), fromTemplate);
    if (strip(fromJsx) !== strip(fromTemplate))
      differences.push(`${label}\n      jsx:      ${JSON.stringify(strip(fromJsx))}\n      template: ${JSON.stringify(strip(fromTemplate))}`);
  }
  assert.deepEqual(differences, [], `JSX and its twin disagree:\n${differences.join('\n')}`);
});

/**
 * The other direction. `<` is ambiguous and `a < b` has to survive, so the transform hands back
 * anything it cannot make sense of — which means the failure to guard against is ordinary JavaScript
 * being *rewritten*, not JSX being missed.
 */
test('source where `<` is not JSX comes back byte-identical', () => {
  const mangled = [];
  for (const source of [
    'const r = a < b;',
    'const r = a < b && c > d;',
    'const r = a << 2;',
    'const r = fn < T > (x);',
    'const r = `${a < b}`;',
    "const r = 'a < b';",
    '/* a < b */ const r = 1;',
    'const r = /a<b/.test(s);',
    'const r = (a) => a < 2;',
    'const r = a < b < c;',
  ]) {
    const output = String(transformJsx(source, 'x.js').code ?? transformJsx(source, 'x.js'));
    /** The transform may prepend imports; nothing else may change. */
    const body = output.split('\n').filter((line) => !/^import /.test(line)).join('\n').trim();
    if (body !== source.trim()) mangled.push(`${JSON.stringify(source)} became ${JSON.stringify(body)}`);
  }
  assert.deepEqual(mangled, [], `ordinary JavaScript was rewritten:\n${mangled.join('\n')}`);
});

test('and the mistakes it documents are refused by name', () => {
  assert.throws(
    () => transformJsx('const a = <p></b>;', 'x.jsx'),
    /<p> is closed by <\/b>/,
    'a mismatched close should be named'
  );
  assert.throws(
    () => transformJsx('const a = <p style={{ color: "red" }}>x</p>;', 'x.jsx'),
    /style expects a STRING/,
    'an object style should be named'
  );
});
