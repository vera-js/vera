/**
 * Every JSX spelling against the template it claims to compile to.
 *
 * `@verajs/jsx` exists to be a *notation* for the same tagged templates people write by hand — one
 * JSX call site is one `html` call site, nested markup is inline statics, and the runtime is
 * unchanged. That claim is only worth anything if the two spellings produce the same template, so
 * this states it as the invariant and generates the cases: each pair is rendered through the same
 * serializer and must come out byte-identical.
 *
 * The hand-written suite beside this one checks the compiler's *output text* for the sigils it
 * should emit. This checks the *result*, which is what a component author actually sees, and it
 * catches the mappings nobody wrote a case for — the transform's table has twenty entries and its
 * tests had nine.
 *
 * Tests BUILT artifacts, development AND production (see ./dist.mjs).
 */
import { execFileSync } from 'node:child_process';
import { transformJsx } from '../packages/jsx/src/index.js';

/**
 * `jsx` is an expression; `tpl` is the template literal it must equal. Both are evaluated against
 * the same `s`, so a case says nothing about values — only about shape.
 */
const CASES = {
  'a text child': ['<b>{s.str}</b>', 'html`<b>${s.str}</b>`'],
  'two adjacent expressions': ['<b>{s.str}{s.num}</b>', 'html`<b>${s.str}${s.num}</b>`'],
  'static text': ['<b>hello</b>', 'html`<b>hello</b>`'],
  'text around an expression': ['<b>a {s.str} b</b>', 'html`<b>a ${s.str} b</b>`'],
  'a bound attribute': ['<b title={s.str}>x</b>', 'html`<b title=${s.str}>x</b>`'],
  'a static attribute': ['<b title="v">x</b>', 'html`<b title="v">x</b>`'],
  'className': ['<b className={s.str}>x</b>', 'html`<b class=${s.str}>x</b>`'],
  'className, static': ['<b className="v">x</b>', 'html`<b class="v">x</b>`'],
  'htmlFor': ['<label htmlFor="a">x</label>', 'html`<label for="a">x</label>`'],
  'value is a property': ['<input value={s.str} />', 'html`<input .value=${s.str} />`'],
  'checked is a property': ['<input checked={s.t} />', 'html`<input .checked=${s.t} />`'],
  'defaultValue is the attribute': ['<input defaultValue="dv" />', 'html`<input value="dv" />`'],
  'defaultChecked is the boolean': ['<input defaultChecked={s.t} />', 'html`<input ?checked=${s.t} />`'],
  'a bound boolean': ['<button disabled={s.t}>x</button>', 'html`<button ?disabled=${s.t}>x</button>`'],
  'a bound boolean, false': ['<button disabled={s.f}>x</button>', 'html`<button ?disabled=${s.f}>x</button>`'],
  'a bare boolean stays an attribute': ['<button disabled>x</button>', 'html`<button disabled>x</button>`'],
  'an event': ['<b onClick={s.fn}>x</b>', 'html`<b @click=${s.fn}>x</b>`'],
  'an event with a compound name': ['<b onPointerDown={s.fn}>x</b>', 'html`<b @pointerdown=${s.fn}>x</b>`'],
  'dangerouslySetInnerHTML': [
    '<b dangerouslySetInnerHTML={{ __html: s.str }} />',
    'html`<b .innerHTML=${s.str} />`',
  ],
  'a ref': ['<b ref={s.ref}>x</b>', 'html`<b ${s.ref}>x</b>`'],
  'a spread': ['<b {...s.props}>x</b>', 'html`<b ${spread(s.props)}>x</b>`'],
  'a spread beside a static': ['<b title="v" {...s.props}>x</b>', 'html`<b title="v" ${spread(s.props)}>x</b>`'],
  'a key on the root': ['<li key={s.num}>x</li>', 'keyed(s.num, html`<li>x</li>`)'],
  'nesting is inline statics': ['<div><b>{s.str}</b><i>y</i></div>', 'html`<div><b>${s.str}</b><i>y</i></div>`'],
  'a fragment': ['<><b>a</b><i>b</i></>', 'html`<b>a</b><i>b</i>`'],
  'a self-closing void element': ['<br />', 'html`<br />`'],
  'a self-closing custom element': ['<my-comp />', 'html`<my-comp />`'],
  'a dashed tag with a bound attribute': ['<my-comp foo={s.str} />', 'html`<my-comp foo=${s.str} />`'],
  'a dashed tag with children': ['<my-comp>{s.str}</my-comp>', 'html`<my-comp>${s.str}</my-comp>`'],
  'a dashed tag with a dashed child': [
    '<my-comp><my-kid a="1" /></my-comp>',
    'html`<my-comp><my-kid a="1" /></my-comp>`',
  ],
  'a tag with several dashes': ['<a-b-c>x</a-b-c>', 'html`<a-b-c>x</a-b-c>`'],
  'a dashed tag with a slot': ['<my-comp slot="a">x</my-comp>', 'html`<my-comp slot="a">x</my-comp>`'],
  'a list': ['<ul>{s.arr.map((n) => <li>{n}</li>)}</ul>', 'html`<ul>${s.arr.map((n) => html`<li>${n}</li>`)}</ul>`'],
  'a keyed list': [
    '<ul>{s.arr.map((n) => <li key={n}>{n}</li>)}</ul>',
    'html`<ul>${s.arr.map((n) => keyed(n, html`<li>${n}</li>`))}</ul>`',
  ],
  'a conditional': ["<b>{s.t ? 'y' : 'n'}</b>", "html`<b>${s.t ? 'y' : 'n'}</b>`"],
  'a false conditional': ['<b>{s.f && <i>x</i>}</b>', 'html`<b>${s.f && html`<i>x</i>`}</b>`'],
  'data and aria attributes': [
    '<b data-x={s.str} aria-label={s.str}>x</b>',
    'html`<b data-x=${s.str} aria-label=${s.str}>x</b>`',
  ],
  'style as a string': ['<b style={s.str}>x</b>', 'html`<b style=${s.str}>x</b>`'],
  'a backtick in static text': ['<b>a `tick` b</b>', 'html`<b>a \\`tick\\` b</b>`'],
  'adjacent expression and text': ['<b>{"literal"} and {"more"} done</b>', 'html`<b>${"literal"} and ${"more"} done</b>`'],
  /**
   * A dollar-brace cannot occur in JSX *text* — `{` always opens an expression container — so the
   * only way it reaches a static is through a quoted attribute value, where JSX takes the text raw.
   * Both it and a backtick have to survive being placed inside a template literal.
   */
  'a dollar-brace in an attribute': ['<b title="a ${x} b">y</b>', 'html`<b title="a \\${x} b">y</b>`'],
  'a backtick in an attribute': ['<b title="a `t` b">y</b>', 'html`<b title="a \\`t\\` b">y</b>`'],
  'a backslash in an attribute': ['<b title="a \\ b">y</b>', 'html`<b title="a \\\\ b">y</b>`'],
  'an svg element': ['<svg viewBox="0 0 1 1"><circle r={s.num} /></svg>', 'html`<svg viewBox="0 0 1 1"><circle r=${s.num} /></svg>`'],
  'an expression holding an element': ['<div>{<b>x</b>}</div>', 'html`<div>${html`<b>x</b>`}</div>`'],
  'nested lists': [
    '<ul>{s.arr.map((n) => <li><b>{n}</b></li>)}</ul>',
    'html`<ul>${s.arr.map((n) => html`<li><b>${n}</b></li>`)}</ul>`',
  ],
};

/* ── the multi-line cases, where whitespace collapsing is the whole question ─────────────────── */
const MULTILINE = {
  'indented children collapse': [
    `<div>
      <b>{s.str}</b>
      <i>y</i>
    </div>`,
    'html`<div><b>${s.str}</b><i>y</i></div>`',
  ],
  'a wrapped text run keeps one space': [
    `<p>
      hello
      world
    </p>`,
    'html`<p>hello world</p>`',
  ],
  'attributes on their own lines': [
    `<b
      title={s.str}
      className="v"
    >x</b>`,
    'html`<b title=${s.str} class="v">x</b>`',
  ],
};

const ALL = { ...CASES, ...MULTILINE };

/**
 * Compiled as one module so the transform sees the same shape a real file gives it, then run in a
 * child process from the repo root — the emitted code imports bare specifiers, which only resolve
 * there.
 */
const jsxModule = `export const VIEWS = {\n${Object.entries(ALL)
  .map(([name, [jsx]]) => `  ${JSON.stringify(name)}: (s) => (${jsx}),`)
  .join('\n')}\n};\n`;

const compiled = transformJsx(jsxModule, 'cases.jsx', { inject: false });

const script = `
import { serializeTemplate } from '@verajs/ssr/vera';
const { html } = await import('@verajs/core');
const { keyed } = await import('@verajs/renderer');
const { spread } = await import('@verajs/renderer/spread');

${compiled}

const s = {
  str: 'v', num: 3, t: true, f: false,
  arr: [1, 2],
  fn: () => {},
  ref: { current: null },
  props: { title: 'p', '?hidden': false },
};

const TEMPLATES = {
${Object.entries(ALL).map(([name, [, tpl]]) => `  ${JSON.stringify(name)}: (s) => (${tpl}),`).join('\n')}
};

const out = {};
for (const name of Object.keys(TEMPLATES)) {
  out[name] = { jsx: serializeTemplate(VIEWS[name](s)), tpl: serializeTemplate(TEMPLATES[name](s)) };
}
process.stdout.write(JSON.stringify(out));
`;

const results = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })
);

let pass = 0;
const failures = [];
for (const name of Object.keys(ALL)) {
  const { jsx, tpl } = results[name];
  if (jsx === tpl) pass++;
  else failures.push(`${name}\n      jsx:      ${jsx}\n      template: ${tpl}`);
}

if (failures.length) {
  console.log(`\n  ${failures.length} JSX spelling(s) that do not compile to the template they claim:\n`);
  for (const f of failures) console.log(`    ${f}\n`);
  process.exit(1);
}
console.log(`jsx equivalence: ${pass} spellings compile to the template they claim`);
